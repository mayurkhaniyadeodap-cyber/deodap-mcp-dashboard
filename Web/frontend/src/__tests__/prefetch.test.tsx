/**
 * Page prefetching: every prefetch entry must hit the SAME cache entry its page's hook
 * reads (same key + URL), otherwise the page would fetch again and nothing is gained.
 * Background prefetches are marked "X-Prefetch: 1" (the backend's background lane).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCod, useCodIntelligence, useCodPending } from "@/services/cod.service";
import { useCouriers } from "@/services/couriers.service";
import { useReconciliation } from "@/services/discrepancies.service";
import { api } from "@/services/api";
import { PAGE_QUERIES, prefetchPage } from "@/services/prefetch";
import { useSla } from "@/services/sla.service";
import { useRecovery, useTrend } from "@/services/trend.service";
import { useWeight } from "@/services/weight.service";
import { useZones } from "@/services/zones.service";
import { useDateRangeStore } from "@/store/dateRange.store";

const RANGE = { from: "2026-09-01", to: "2026-09-30" };

function AllPageHooks() {
  useCouriers();
  useReconciliation();
  useCod();
  useCodPending();
  useCodIntelligence();
  useZones();
  useWeight();
  useTrend();
  useRecovery();
  useSla();
  return null;
}

beforeEach(() => {
  useDateRangeStore.setState({ preset: "custom", customFrom: RANGE.from, customTo: RANGE.to });
});

afterEach(() => {
  cleanup();
});

describe("prefetchPage", () => {
  it("fills exactly the cache entries the pages read — opening them makes no new request", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { source: "live" } });
    for (const path of Object.keys(PAGE_QUERIES)) await prefetchPage(qc, path, RANGE, { background: true });
    const prefetched = get.mock.calls.length;
    expect(prefetched).toBe(10); // couriers once (shared by two pages) + 9 others

    render(
      <QueryClientProvider client={qc}>
        <AllPageHooks />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(get.mock.calls.length).toBe(prefetched);
  });

  it("marks background prefetches for the backend's background lane, not hover prefetches", async () => {
    const qc = new QueryClient();
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { source: "live" } });
    await prefetchPage(qc, "/zones", RANGE, { background: true });
    await prefetchPage(qc, "/weight", RANGE);
    expect(get.mock.calls[0][1]).toMatchObject({ headers: { "X-Prefetch": "1" }, params: RANGE });
    expect(get.mock.calls[1][1]).toMatchObject({ params: RANGE });
    expect((get.mock.calls[1][1] as { headers?: unknown }).headers).toBeUndefined();
  });

  it("never re-fetches data that is already cached and fresh", async () => {
    const qc = new QueryClient();
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { source: "live" } });
    await prefetchPage(qc, "/zones", RANGE, { background: true });
    await prefetchPage(qc, "/zones", RANGE, { background: true });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
