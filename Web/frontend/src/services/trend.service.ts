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
 * GET /api/trend-recovery?from&to — SLOW cumulative "rate difference identified"
 * (7× weight_reconciliation ≈ 27s, 10-min server cache). Separate so the fast
 * Trend charts render immediately; renders with its own skeleton.
 */
export function useRecovery() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["trend-recovery", from, to],
    queryFn: async () => (await api.get<RecoveryResponse>("/trend-recovery", { params: { from, to } })).data,
    staleTime: 10 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
