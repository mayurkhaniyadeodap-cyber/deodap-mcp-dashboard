import { SourceBadge } from "@/components/shared/SourceBadge";
import { relTime } from "@/utils/format";

/** Key for the status badges used on every card (what Live / Sample / Unavailable mean). */
export function DataStatusLegend({ updatedAt }: { updatedAt?: number }) {
  return (
    <aside
      aria-label="Data status legend"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-card"
    >
      <span className="font-semibold text-foreground">Data status</span>
      <span className="flex items-center gap-2">
        <SourceBadge status="live" /> Live Ship MCP data{updatedAt ? ` · last updated ${relTime(updatedAt)}` : ""}
      </span>
      <span className="flex items-center gap-2">
        <SourceBadge status="sample" /> Illustrative demo data, never live
      </span>
      <span className="flex items-center gap-2">
        <SourceBadge status="unavailable" /> Could not load · no number shown, retry
      </span>
    </aside>
  );
}
