import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { CourierBillingResponse, DashboardResponse, RateDiffKpi } from "@/types/api";

/** GET /api/dashboard?from&to — KPIs, courier billing, distribution, state cost (fast, ~6s). */
export function useDashboard() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["dashboard", from, to],
    queryFn: async () => (await api.get<DashboardResponse>("/dashboard", { params: { from, to } })).data,
  });
}

/**
 * GET /api/dashboard/rate-diff?from&to — the slow "Rate Diff to Investigate" KPI
 * (weight_reconciliation ~9s). Fetched separately with its own skeleton so it
 * never delays or breaks the landing page.
 */
export function useDashboardRateDiff() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["dashboard-rate-diff", from, to],
    queryFn: async () => (await api.get<RateDiffKpi>("/dashboard/rate-diff", { params: { from, to } })).data,
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
  });
}
