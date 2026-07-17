import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { StatusResponse } from "@/types/api";

/**
 * GET /api/_status — one live-vs-mock snapshot across every dashboard endpoint.
 * Server probes them concurrently and caches 60s; it's slow cold (~1min), so we
 * never auto-refetch — the Configuration page drives it with an explicit refresh.
 * `includeSlow` also probes savings-opportunity + trend-recovery.
 */
export function useMCPStatus(includeSlow: boolean) {
  return useQuery({
    queryKey: ["mcp-status", includeSlow],
    queryFn: async () =>
      (await api.get<StatusResponse>("/_status", { params: { include_slow: includeSlow } })).data,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
