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
 * Live / Sample / Unavailable provenance badge for a card or chart header. Each
 * state carries its own text, so the meaning never depends on colour alone. Status is always
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
  recalculating,
}: {
  status?: SourceStatus;
  className?: string;
  cache?: CacheState;
  /** A legitimate recalculation is in progress (warm-cache endpoints): the label says
   *  so instead of "Live", so a figure that is being rebuilt is never read as final. */
  recalculating?: boolean;
}) {
  if (recalculating) {
    return (
      <Badge
        variant="warning"
        className={cn("gap-1.5", className)}
        title="Recalculating for the selected range — the figure will update when it finishes."
      >
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-warning" />
        Recalculating
      </Badge>
    );
  }
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
      <Badge variant="danger" className={cn("gap-1.5", className)} title="Live data unavailable — Ship MCP unreachable">
        <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
        Unavailable
      </Badge>
    );
  }
  const live = status === "live";
  return (
    <Badge
      variant={live ? "success" : "warning"}
      className={cn("gap-1.5", className)}
      title={live ? "Live MCP data" : "Sample data — illustrative only, not live.\nNo live source currently exists."}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-warning")} />
      {live ? "Live" : "Sample"}
    </Badge>
  );
}
