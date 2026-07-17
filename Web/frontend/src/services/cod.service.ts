import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { CodResponse } from "@/types/api";

/** GET /api/cod?from&to — COD KPIs + per-courier reconciliation. */
export function useCod() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["cod", from, to],
    queryFn: async () => (await api.get<CodResponse>("/cod", { params: { from, to } })).data,
  });
}
