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
