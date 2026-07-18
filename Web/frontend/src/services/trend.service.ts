import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { RecoveryResponse, TrendResponse } from "@/types/api";

/** GET /api/trend?from&to — daily orders/value + monthly per-courier billing (fast). */
export function useTrend() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["trend", from, to],
    queryFn: async () => (await api.get<TrendResponse>("/trend", { params: { from, to } })).data,
  });
}

/**
 * GET /api/trend-recovery?from&to — cumulative "rate difference identified"
 * (7× weight_reconciliation ≈ 27s to compute, but served INSTANTLY from a warm
 * background refresh — never computed on the request path). Separate hook so the
 * fast Trend charts render immediately.
 */
export function useRecovery() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["trend-recovery", from, to],
    queryFn: async () => (await api.get<RecoveryResponse>("/trend-recovery", { params: { from, to } })).data,
    staleTime: 10 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    // While the background job is still computing (or recalculating a freshly-picked
    // range), poll so the chart flips to the real series the moment it's warm.
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.computing || d.recalculating) ? 15_000 : false;
    },
  });
}
