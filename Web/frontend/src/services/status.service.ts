import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { SchedulersResponse, StatusResponse } from "@/types/api";

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

/**
 * GET /api/_status/schedulers — ADMIN-ONLY warm-cache scheduler telemetry (cache
 * age / next refresh) from the backend's existing timestamps. Cheap (no MCP probe),
 * so it refreshes every 15s while the Debug Panel is open. `enabled` gates it so it
 * never runs for non-admins.
 */
export function useSchedulers(enabled = true) {
  return useQuery({
    queryKey: ["mcp-schedulers"],
    queryFn: async () => (await api.get<SchedulersResponse>("/_status/schedulers")).data,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
    enabled,
  });
}
