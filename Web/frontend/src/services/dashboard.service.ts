import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { ClaimableRateResponse, CourierBillingResponse, DashboardResponse } from "@/types/api";
import { pollWhileUnavailable } from "@/utils/source";

/** GET /api/dashboard?from&to — KPIs, courier billing, distribution, state cost (fast, ~6s). */
export function useDashboard() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["dashboard", from, to],
    queryFn: async () => (await api.get<DashboardResponse>("/dashboard", { params: { from, to } })).data,
    refetchInterval: (q) => pollWhileUnavailable(q.state.data?.source),
  });
}

/**
 * GET /api/disputes/claimable-rate?from&to — the honest "Claimable Rate Difference"
 * KPI. Paginates the whole ≥₹50 dispute population and keeps only rows with an
 * applied rate; slow on cold cache (30-min server cache), so it's fetched with its
 * own skeleton and never blocks the fast KPIs.
 */
export function useClaimableRate() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["claimable-rate", from, to],
    queryFn: async () => (await api.get<ClaimableRateResponse>("/disputes/claimable-rate", { params: { from, to } })).data,
    staleTime: 25 * 60 * 1000, // mirror the 30-min server cache
    // While the background job is still computing (or recalculating a freshly-picked
    // range), poll so the KPI flips to the real figure the moment it's warm.
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.computing || d.recalculating) ? 15_000 : false;
    },
  });
}

/**
 * GET /api/dashboard/courier-billing?from&to — per-courier billing broken into
 * Base Freight / GST / COD Charges / RTO from a ~2,500-order sample of
 * rate_summary. Separate (needs the sample) so the dashboard stays fast.
 */
export function useDashboardCourierBilling() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["dashboard-courier-billing", from, to],
    queryFn: async () => (await api.get<CourierBillingResponse>("/dashboard/courier-billing", { params: { from, to } })).data,
    refetchInterval: (q) => pollWhileUnavailable(q.state.data?.source),
  });
}
