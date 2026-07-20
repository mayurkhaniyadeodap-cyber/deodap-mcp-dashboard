import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type { ZonesResponse } from "@/types/api";
import { pollWhileUnavailable } from "@/utils/source";

/** GET /api/zones?from&to — zone stats + zone×courier cost heatmap. */
export function useZones() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["zones", from, to],
    queryFn: async () => (await api.get<ZonesResponse>("/zones", { params: { from, to } })).data,
    refetchInterval: (q) => pollWhileUnavailable(q.state.data?.source),
  });
}
