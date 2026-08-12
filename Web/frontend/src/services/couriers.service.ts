import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { Courier } from "@/types/api";

/** GET /api/couriers?from&to — per-courier stats (LIVE via MCP for this range).
 *  keepPreviousData: the courier cards/chart stay visible during a Retry/date change
 *  while this (6-tool) live fetch refreshes — same values, no skeleton flash. */
export function useCouriers() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["couriers", from, to],
    queryFn: async () => (await api.get<Courier[]>("/couriers", { params: { from, to } })).data,
    placeholderData: keepPreviousData,
  });
}
