import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { DiscrepancyResponse, SavingsResponse } from "@/types/api";

/** GET /api/discrepancies?from&to — fast panels: rate difference, weight aggregate, RTO, NDR. */
export function useDiscrepancies() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["discrepancies", from, to],
    queryFn: async () => (await api.get<DiscrepancyResponse>("/discrepancies", { params: { from, to } })).data,
  });
}

/**
 * GET /api/savings-opportunity?from&to — SLOW (pincode_serviceability sample,
 * ~30s first load, 30-min server cache). Fetched separately so it never blocks
 * the Discrepancies page; its own loading skeleton renders while it computes.
 */
export function useSavingsOpportunity() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["savings-opportunity", from, to],
    queryFn: async () => (await api.get<SavingsResponse>("/savings-opportunity", { params: { from, to } })).data,
    staleTime: 30 * 60 * 1000, // matches the server's 30-min cache
    gcTime: 30 * 60 * 1000,
  });
}
