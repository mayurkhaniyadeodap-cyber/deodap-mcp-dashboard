import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";

/**
 * Page data prefetching, so opening a page shows data at once instead of a skeleton.
 *
 * Each entry mirrors the page's own hooks EXACTLY (same query key + URL — see the
 * services; __tests__/prefetch.test.tsx checks they match), so a prefetched result is
 * the very cache entry the page reads. Background prefetches send "X-Prefetch: 1", so
 * the backend runs their MCP calls in its background lane — they never slow the page
 * that is actually open. A hover prefetch (the user is about to click) goes at normal
 * priority. Nothing is fabricated: it is the same live request, made a little earlier.
 */
interface PageQuery {
  key: (from: string, to: string) => unknown[];
  url: string;
}

const q = (root: string, url: string): PageQuery => ({ key: (from, to) => [root, from, to], url });

export const PAGE_QUERIES: Record<string, PageQuery[]> = {
  "/couriers": [q("couriers", "/couriers")],
  "/discrepancies": [q("couriers", "/couriers"), q("reconciliation", "/discrepancies/reconciliation")],
  "/cod": [q("cod", "/cod"), q("cod-pending", "/cod/pending"), q("cod-intelligence", "/cod/intelligence")],
  "/zones": [q("zones", "/zones")],
  "/weight": [q("weight", "/weight")],
  "/trends": [q("trend", "/trend"), q("trend-recovery", "/trend-recovery")],
  "/delivery-performance": [q("sla-performance", "/sla-performance")],
};

/** Same freshness window as the app's default queries (main.tsx). */
const PREFETCH_STALE_MS = 60_000;

export function prefetchPage(
  qc: QueryClient,
  path: string,
  range: { from: string; to: string },
  opts: { background?: boolean } = {},
): Promise<unknown> {
  const headers = opts.background ? { "X-Prefetch": "1" } : undefined;
  return Promise.all(
    (PAGE_QUERIES[path] ?? []).map((pq) =>
      // prefetchQuery skips anything already cached and fresh, and never throws.
      qc.prefetchQuery({
        queryKey: pq.key(range.from, range.to),
        queryFn: async () => (await api.get(pq.url, { params: { from: range.from, to: range.to }, headers })).data,
        staleTime: PREFETCH_STALE_MS,
      }),
    ),
  );
}
