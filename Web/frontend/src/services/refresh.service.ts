import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { RefreshStatus } from "@/types/api";

export const REFRESH_STATUS_KEY = ["refresh-status"] as const;

/** Poll fast while a refresh runs (live progress), slowly otherwise (to notice the
 *  automatic 30-minute run and keep "last refreshed" current). */
export const REFRESH_POLL_RUNNING_MS = 2_000;
export const REFRESH_POLL_IDLE_MS = 60_000;

/**
 * GET /api/refresh/status — progress of the current/last full live-data refresh
 * (automatic, every 30 min), with last attempt / last success times.
 */
export function useRefreshStatus() {
  return useQuery({
    queryKey: REFRESH_STATUS_KEY,
    queryFn: async () => (await api.get<RefreshStatus>("/refresh/status")).data,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.running ? REFRESH_POLL_RUNNING_MS : REFRESH_POLL_IDLE_MS),
  });
}

/**
 * The TanStack Query roots to refetch after a finished refresh: only datasets that
 * SUCCEEDED (a failed one keeps showing its last good data), and only when they were
 * fetched for the range on screen — or for their own fixed window (dispute lines),
 * which doesn't follow the date picker.
 */
export function queryKeysToRefetch(status: RefreshStatus, range: { from: string; to: string }): string[] {
  const viewingJobWindow = status.date_from === range.from && status.date_to === range.to;
  const keys = new Set<string>();
  for (const d of status.datasets ?? []) {
    if (d.status !== "success") continue;
    const ownWindow = d.date_from !== status.date_from || d.date_to !== status.date_to;
    if (viewingJobWindow || ownWindow) (d.query_keys ?? []).forEach((k) => keys.add(k));
  }
  return [...keys];
}
