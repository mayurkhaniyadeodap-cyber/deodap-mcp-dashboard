import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { queryKeysToRefetch, useRefreshStatus } from "@/services/refresh.service";
import { useDateRange } from "@/store/dateRange.store";

/**
 * Keeps the open panels in step with the server's automatic live-data refresh
 * (every 30 min). No UI: it watches GET /api/refresh/status and, while a refresh
 * runs, refetches each panel as soon as ITS dataset succeeds (and only when it was
 * fetched for the range on screen). A failed dataset is never refetched, so it keeps
 * showing its last good data.
 */
export function useRefreshSync(): void {
  const { from, to } = useDateRange();
  const { data: status } = useRefreshStatus();
  const qc = useQueryClient();

  // Jobs already reflected on screen. Seeded from the first status we see so a
  // refresh that finished before this page loaded doesn't refetch again.
  const handledJob = useRef<number | null>(null);
  // Query roots already refetched for the job in progress.
  const refetched = useRef<{ job: number; keys: Set<string> }>({ job: -1, keys: new Set() });

  useEffect(() => {
    if (!status) return;
    if (handledJob.current === null) {
      handledJob.current = status.running ? (status.job_id ?? 1) - 1 : (status.job_id ?? 0);
      return;
    }
    const jobId = status.job_id ?? 0;
    if (jobId <= handledJob.current) return;

    // Refetch as soon as each dataset succeeds (polled every 2s while the job runs),
    // not only when the whole job ends: the fresh result sits in the server's 60s
    // cache, so the panel gets exactly what the refresh fetched — a full run can take
    // 10+ minutes, and waiting would make the page fetch it from the MCP again.
    if (refetched.current.job !== jobId) refetched.current = { job: jobId, keys: new Set() };
    for (const key of queryKeysToRefetch(status, { from, to })) {
      if (refetched.current.keys.has(key)) continue;
      refetched.current.keys.add(key);
      void qc.invalidateQueries({ queryKey: [key] });
    }
    if (!status.running) handledJob.current = jobId;
  }, [status, from, to, qc]);
}
