import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/services/meta.service";
import type { CacheState } from "@/utils/source";

const CACHE_LABEL: Record<CacheState, string> = {
  cached: "Cached",
  refreshing: "Refreshing",
  "cached-refreshing": "Cached • Refreshing",
};

/**
 * Live / Sample provenance badge for a card or chart header. Status is always
 * driven by GET /api/_meta/sources (never hardcoded per-component). While the
 * metadata is loading `status` is undefined and the badge renders nothing, so
 * there is no layout jump.
 *
 * `cache` (optional) overrides the label for WARM-CACHE endpoints, showing
 * Cached / Refreshing / Cached • Refreshing derived from the response's existing
 * computing/recalculating flags (see utils/source.cacheState). No API change.
 */
export function SourceBadge({
  status,
  className,
  cache,
}: {
  status?: SourceStatus;
  className?: string;
  cache?: CacheState;
}) {
  if (cache) {
    const refreshing = cache !== "cached";
    return (
      <Badge
        variant="muted"
        className={cn("gap-1.5", className)}
        title="Served from the warm cache (background scheduler refresh)."
      >
        <span aria-hidden className={cn("size-1.5 rounded-full bg-muted-foreground/60", refreshing && "animate-pulse")} />
        {CACHE_LABEL[cache]}
      </Badge>
    );
  }
  if (!status) return null;
  if (status === "unavailable") {
    return (
      <Badge variant="warning" className={cn("gap-1.5", className)} title="Live data unavailable — Ship MCP unreachable">
        <span aria-hidden className="size-1.5 rounded-full bg-warning" />
        Unavailable
      </Badge>
    );
  }
  const live = status === "live";
  return (
    <Badge
      variant={live ? "success" : "muted"}
      className={cn("gap-1.5", className)}
      title={live ? "Live MCP data" : "Sample data\nNo live source currently exists."}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-muted-foreground/60")}
      />
      {live ? "LIVE" : "Sample"}
    </Badge>
  );
}
