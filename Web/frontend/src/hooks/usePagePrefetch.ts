import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { NAV_GROUPS } from "@/config/nav";
import { PAGE_QUERIES, prefetchPage } from "@/services/prefetch";
import { useDateRange } from "@/store/dateRange.store";

/** Quiet time after the open page finishes loading before prefetching starts. */
const IDLE_MS = 2_000;

/**
 * Once the page that's open has finished loading, quietly load the OTHER sidebar
 * pages' data for the selected range (background lane, one page at a time), so
 * opening them is instant. Runs once per date range; a range change starts over.
 */
export function usePagePrefetch(): void {
  const qc = useQueryClient();
  const { pathname } = useLocation();
  const { from, to } = useDateRange();
  const busy = useIsFetching() > 0;
  const done = useRef<string | null>(null);

  useEffect(() => {
    const rangeKey = `${from}|${to}`;
    if (busy || done.current === rangeKey) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      done.current = rangeKey;
      const pages = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.path)).filter(
        (p) => p !== pathname && PAGE_QUERIES[p],
      );
      for (const path of pages) {
        if (cancelled) return;
        await prefetchPage(qc, path, { from, to }, { background: true });
      }
    }, IDLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [busy, from, to, pathname, qc]);
}
