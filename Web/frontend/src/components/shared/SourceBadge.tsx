import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/services/meta.service";

/**
 * Live / Sample provenance badge for a card or chart header. Status is always
 * driven by GET /api/_meta/sources (never hardcoded per-component). While the
 * metadata is loading `status` is undefined and the badge renders nothing, so
 * there is no layout jump.
 */
export function SourceBadge({ status, className }: { status?: SourceStatus; className?: string }) {
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
