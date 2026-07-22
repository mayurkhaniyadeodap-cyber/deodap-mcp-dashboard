import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { CodIntelligenceResponse, CodPendingResponse, CodResponse } from "@/types/api";
import { pollWhileUnavailable } from "@/utils/source";

/** GET /api/cod?from&to — COD KPIs + per-courier reconciliation. */
export function useCod() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["cod", from, to],
    queryFn: async () => (await api.get<CodResponse>("/cod", { params: { from, to } })).data,
    refetchInterval: (q) => pollWhileUnavailable(q.state.data?.source),
  });
}

/** GET /api/cod/pending?from&to — per-courier COD aging (cod_remittance_aging). */
export function useCodPending() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["cod-pending", from, to],
    queryFn: async () => (await api.get<CodPendingResponse>("/cod/pending", { params: { from, to } })).data,
    staleTime: 60_000,
    refetchInterval: (q) => pollWhileUnavailable(q.state.data?.source),
  });
}

/**
 * GET /api/cod/intelligence?from&to — COD Intelligence KPIs (order_analytics
 * payment_type + cod_remittance_aging): COD share, avg COD order value, remittance
 * & overdue rates, outstanding/overdue amounts, settlement TAT, plus the COD vs
 * Prepaid split and the list of metrics the MCP cannot provide. Own 60s server
 * cache; polls only while the source is "unavailable".
 */
export function useCodIntelligence() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["cod-intelligence", from, to],
    queryFn: async () => (await api.get<CodIntelligenceResponse>("/cod/intelligence", { params: { from, to } })).data,
    staleTime: 60_000,
    refetchInterval: (q) => pollWhileUnavailable(q.state.data?.source),
  });
}
