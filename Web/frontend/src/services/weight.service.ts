import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { WeightResponse } from "@/types/api";
import { pollWhileUnavailable } from "@/utils/source";

/** GET /api/weight?from&to — actual-vs-charged scatter, slab histogram, summary.
 *  keepPreviousData: charts stay visible during a Retry/date change (same values). */
export function useWeight() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["weight", from, to],
    queryFn: async () => (await api.get<WeightResponse>("/weight", { params: { from, to } })).data,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => pollWhileUnavailable(q.state.data?.source),
  });
}
