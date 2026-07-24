import type { SourceStatus } from "@/services/meta.service";

/**
 * Map an API response `source` field to a badge status. Three honest states:
 * "live" (real MCP data), "unavailable" (MCP unreachable — NO numbers shown), and
 * "sample" (dev-only fixtures behind USE_MOCK_FALLBACK; never in production).
 */
export function badgeFromSource(source?: string | null): SourceStatus | undefined {
  if (source === "live") return "live";
  if (source === "unavailable") return "unavailable";
  if (source === "mock") return "sample";
  return undefined;
}

/** True when a response is the honest "Ship MCP unreachable" state. */
export function isUnavailable(source?: string | null): boolean {
  return source === "unavailable";
}

/**
 * react-query `refetchInterval` value: poll every ~20s while a response is
 * "unavailable" so panels populate the moment the MCP returns (and stop otherwise).
 * Usage: `refetchInterval: (q) => pollWhileUnavailable(q.state.data?.source)`.
 */
export const UNAVAILABLE_POLL_MS = 20_000;
export function pollWhileUnavailable(source?: string | null): number | false {
  return source === "unavailable" ? UNAVAILABLE_POLL_MS : false;
}

export type CacheState = "cached" | "refreshing" | "cached-refreshing";

/**
 * Derive a cache badge state from a WARM-CACHE endpoint's existing response flags
 * (`computing` / `recalculating` — already on RecoveryResponse & ClaimableRateResponse).
 * Only pass this for warm-cache endpoints; other endpoints omit it so their badge
 * stays the normal LIVE/Sample/Unavailable.
 *   computing              → "refreshing"        (building; nothing cached yet)
 *   live + recalculating   → "cached-refreshing" (serving last-good while rebuilding)
 *   live (fresh warm)      → "cached"
 * Returns undefined when no flags are supplied or the source isn't live.
 */
export function cacheState(
  source?: string | null,
  flags?: { computing?: boolean; recalculating?: boolean },
): CacheState | undefined {
  if (!flags) return undefined;
  if (flags.computing) return "refreshing";
  if (source === "live" && flags.recalculating) return "cached-refreshing";
  if (source === "live") return "cached";
  return undefined;
}
