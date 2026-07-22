import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { SlaResponse } from "@/types/api";
import { pollWhileUnavailable } from "@/utils/source";

/**
 * GET /api/sla-performance?from&to — live Delivery SLA (sla_performance): delivered,
 * on-time vs late (vs promised EDD), overdue-in-transit, and average delay. Own 60s
 * server cache; polls only while the source is "unavailable".
 */
export function useSla() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["sla-performance", from, to],
    queryFn: async () => (await api.get<SlaResponse>("/sla-performance", { params: { from, to } })).data,
    refetchInterval: (q) => pollWhileUnavailable(q.state.data?.source),
  });
}
