import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";

/** Data provenance for a single panel. */
export type SourceStatus = "live" | "sample";

/**
 * Per-page → per-panel provenance map from GET /api/_meta/sources. Typed loosely
 * (string keys) on purpose: this is additive UI metadata, NOT a generated API
 * contract, so panels can be added server-side without a frontend type change.
 */
export type SourcesMeta = Record<string, Record<string, SourceStatus>>;

/**
 * Fetch the Live/Sample provenance map. Static server-side, so it's cached hard
 * and never refetched on focus — badges must never hardcode state in components.
 */
export function useSourceMeta() {
  return useQuery({
    queryKey: ["source-meta"],
    queryFn: async () => (await api.get<SourcesMeta>("/_meta/sources")).data,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
