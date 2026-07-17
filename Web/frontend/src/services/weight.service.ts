import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { WeightResponse } from "@/types/api";

/** GET /api/weight?from&to — actual-vs-charged scatter, slab histogram, summary. */
export function useWeight() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["weight", from, to],
    queryFn: async () => (await api.get<WeightResponse>("/weight", { params: { from, to } })).data,
  });
}
