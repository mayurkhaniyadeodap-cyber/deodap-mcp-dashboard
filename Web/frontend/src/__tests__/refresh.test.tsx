/**
 * Automatic live-data refresh → panels (useRefreshSync / refresh.service). There is no
 * refresh UI in the navbar; the hook only refetches panels while the server's
 * 30-minute refresh runs:
 *   - only SUCCEEDED datasets are refetched (failed ones keep their last good data),
 *     each as soon as it finishes, once per job;
 *   - never for a run that had finished before the page loaded; it never starts one.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRefreshSync } from "@/hooks/useRefreshSync";
import { api } from "@/services/api";
import { queryKeysToRefetch, REFRESH_STATUS_KEY } from "@/services/refresh.service";
import { useDateRangeStore } from "@/store/dateRange.store";
import type { RefreshDatasetStatus, RefreshStatus } from "@/types/api";

const RANGE = { from: "2026-09-01", to: "2026-09-30" };

function ds(key: string, status: RefreshDatasetStatus["status"], extra: Partial<RefreshDatasetStatus> = {}): RefreshDatasetStatus {
  return {
    key, label: key, module: "M", query_keys: [key], date_from: RANGE.from, date_to: RANGE.to,
    status, error: status === "failed" ? `${key} failed — previous data kept` : null, duration_ms: 10, ...extra,
  };
}

function job(over: Partial<RefreshStatus> = {}): RefreshStatus {
  return {
    job_id: 0, state: "idle", running: false, trigger: null, triggered_by: null,
    date_from: null, date_to: null, started_at: null, finished_at: null,
    total: 0, completed: 0, failed: 0, datasets: [],
    last_attempt_at: null, last_success_at: null, last_success_from: null, last_success_to: null,
    last_error: null, auto_refresh_enabled: true, interval_hours: 0.5,
    mcp_requests: 0, mcp_round_trips: 0, mcp_deduplicated: 0,
    next_scheduled_at: "2026-10-29T12:00:00Z", ...over,
  };
}

function Probe() {
  useRefreshSync();
  return null;
}

function setup(initial: RefreshStatus = job()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: initial });
  const post = vi.spyOn(api, "post");
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  return { qc, get, post, invalidate, view };
}

function invalidations(spy: { mock: { calls: unknown[][] } }, key: string): number {
  return spy.mock.calls.filter(([arg]) => JSON.stringify(arg) === JSON.stringify({ queryKey: [key] })).length;
}

beforeEach(() => {
  useDateRangeStore.setState({ preset: "custom", customFrom: RANGE.from, customTo: RANGE.to });
});

afterEach(() => {
  cleanup();
});

describe("queryKeysToRefetch", () => {
  const finished = job({
    job_id: 2, state: "partial", date_from: RANGE.from, date_to: RANGE.to,
    datasets: [
      ds("cod", "success"),
      ds("weight", "failed"),
      ds("dispute-lines", "success", { query_keys: ["dispute-lines", "dispute-invoices"],
                                       date_from: "2026-09-01", date_to: "2026-09-30" }),
    ],
  });

  it("refetches only succeeded datasets for the range on screen", () => {
    expect(queryKeysToRefetch(finished, RANGE).sort()).toEqual(["cod", "dispute-invoices", "dispute-lines"]);
  });

  it("skips window-bound datasets when the user is viewing another range, but keeps own-window ones", () => {
    const other = { ...finished, datasets: [
      ds("cod", "success"),
      ds("dispute-lines", "success", { date_from: "2026-08-01", date_to: "2026-08-31" }),
    ] };
    expect(queryKeysToRefetch(other, { from: "2026-01-01", to: "2026-01-31" })).toEqual(["dispute-lines"]);
  });

  it("refetches nothing when every dataset failed (last good data stays on screen)", () => {
    const failed = { ...finished, state: "failed" as const, datasets: [ds("cod", "failed"), ds("weight", "failed")] };
    expect(queryKeysToRefetch(failed, RANGE)).toEqual([]);
  });
});

describe("useRefreshSync", () => {
  it("renders nothing, only polls the status, and never starts a refresh", async () => {
    const { get, post, view } = setup();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/refresh/status"));
    expect(view.container.innerHTML).toBe("");
    expect(post).not.toHaveBeenCalled();
  });

  it("refetches each panel as soon as its dataset succeeds, once per job, never a failed one", async () => {
    const { qc, invalidate } = setup();
    await waitFor(() => expect(qc.getQueryData(REFRESH_STATUS_KEY)).toBeTruthy());

    // A poll mid-run of the automatic refresh: COD done, Zones running, Weight failed.
    act(() => {
      qc.setQueryData(REFRESH_STATUS_KEY, job({
        job_id: 1, state: "running", running: true, trigger: "scheduled", total: 3, completed: 2,
        date_from: RANGE.from, date_to: RANGE.to,
        datasets: [ds("cod", "success"), ds("zones", "running"), ds("weight", "failed")],
      }));
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["cod"] }));
    expect(invalidations(invalidate, "zones")).toBe(0);

    // Run finished: Zones now refetched; COD not again; Weight (failed) never.
    act(() => {
      qc.setQueryData(REFRESH_STATUS_KEY, job({
        job_id: 1, state: "partial", trigger: "scheduled", total: 3, completed: 3, failed: 1,
        date_from: RANGE.from, date_to: RANGE.to,
        datasets: [ds("cod", "success"), ds("zones", "success"), ds("weight", "failed")],
      }));
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["zones"] }));
    expect(invalidations(invalidate, "cod")).toBe(1);
    expect(invalidations(invalidate, "weight")).toBe(0);
  });

  it("does not refetch for a run that had already finished when the page loaded", async () => {
    const done = job({
      job_id: 5, state: "success", trigger: "scheduled", total: 1, completed: 1,
      date_from: RANGE.from, date_to: RANGE.to, datasets: [ds("cod", "success")],
    });
    const { qc, invalidate } = setup(done);
    await waitFor(() => expect(qc.getQueryData(REFRESH_STATUS_KEY)).toBeTruthy());
    act(() => {
      qc.setQueryData(REFRESH_STATUS_KEY, { ...done });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
