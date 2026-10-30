import { useMemo, useState } from "react";
import { ChartCard } from "@/components/shared/ChartCard";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { INDIA_STATE_PATHS, INDIA_VIEWBOX } from "@/config/indiaMap";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/services/meta.service";
import type { StateCostRow } from "@/types/api";
import { formatCurrencyINR } from "@/utils/format";

/** "Jammu And Kashmir" / "Jammu & Kashmir" / "jammu and kashmir" → one key. */
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

const MAP_STATES = Object.entries(INDIA_STATE_PATHS).map(([name, d]) => ({ name, key: norm(name), d }));

interface Props {
  rows: StateCostRow[] | undefined;
  loading: boolean;
  unavailable: boolean;
  onRetry: () => void;
  source?: SourceStatus;
  updatedAt?: number;
  className?: string;
}

/**
 * States ranked by courier cost: a choropleth of India (the listed states shaded by
 * cost; darker = higher) beside the ranked list (exact ₹ + share). Hovering a state
 * on the map or in the list highlights it in both. Share is of the states LISTED —
 * the API returns the top N — and says so.
 */
export function StateCostCard({ rows, loading, unavailable, onRetry, source, updatedAt, className }: Props) {
  const list = useMemo(() => rows ?? [], [rows]);
  const total = list.reduce((s, r) => s + r.total_cost, 0);
  const max = Math.max(0, ...list.map((r) => r.total_cost));
  const costByKey = useMemo(() => new Map(list.map((r) => [norm(r.state), r])), [list]);
  const [active, setActive] = useState<string | null>(null); // normalized state key
  const activeRow = active ? costByKey.get(active) : undefined;
  const activeName = active ? (activeRow?.state ?? MAP_STATES.find((s) => s.key === active)?.name) : undefined;

  return (
    <ChartCard
      title="State-wise Cost"
      description={list.length ? `Top ${list.length} states by courier cost` : "Courier cost by state"}
      loading={loading}
      unavailable={unavailable}
      onRetry={onRetry}
      empty={!loading && list.length === 0}
      emptyMessage="No state cost for this range."
      height={250}
      endpoint="/api/dashboard"
      action={<SourceBadge status={source} />}
      updatedAt={updatedAt}
      className={className}
    >
      <div className="grid h-full grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3">
        {/* Map */}
        <div className="relative min-h-0">
          <svg viewBox={INDIA_VIEWBOX} className="size-full" role="img" aria-label="Map of India shaded by courier cost for the listed states">
            {MAP_STATES.map((s) => {
              const row = costByKey.get(s.key);
              const ratio = row && max > 0 ? row.total_cost / max : 0;
              const isActive = active === s.key;
              return (
                <path
                  key={s.name}
                  d={s.d}
                  onMouseEnter={() => setActive(s.key)}
                  onMouseLeave={() => setActive(null)}
                  className="transition-[fill-opacity] duration-150"
                  style={{
                    fill: row ? "hsl(var(--primary))" : "hsl(var(--muted))",
                    fillOpacity: row ? 0.28 + 0.72 * ratio : 1,
                    stroke: isActive ? "hsl(var(--foreground))" : "hsl(var(--card))",
                    strokeWidth: isActive ? 2 : 0.8,
                    strokeLinejoin: "round",
                  }}
                >
                  <title>{row ? `${s.name}: ${formatCurrencyINR(row.total_cost)}` : `${s.name}: not in the top ${list.length}`}</title>
                </path>
              );
            })}
          </svg>
          {/* Hover readout (also announced for screen readers). */}
          <div aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-0 text-center">
            {activeName ? (
              <span className="inline-block max-w-full truncate rounded-md border border-border bg-popover px-2 py-0.5 text-[11px] font-medium text-popover-foreground shadow-card">
                {activeName}: {activeRow ? formatCurrencyINR(activeRow.total_cost) : `not in top ${list.length}`}
              </span>
            ) : null}
          </div>
        </div>

        {/* Ranked list */}
        <div className="flex min-h-0 flex-col">
          <div className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>State</span>
            <span>Cost · Share*</span>
          </div>
          <ol className="scrollbar-thin flex flex-1 flex-col justify-between overflow-y-auto">
            {list.map((r) => {
              const key = norm(r.state);
              return (
                <li
                  key={r.state}
                  tabIndex={0}
                  onMouseEnter={() => setActive(key)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(key)}
                  onBlur={() => setActive(null)}
                  className={cn(
                    "flex cursor-default items-baseline gap-2 rounded px-1 py-0.5 text-[12.5px] transition-colors focus-visible:ring-offset-0",
                    active === key && "bg-primary/10",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{r.state}</span>
                  <span className="font-semibold tabular-nums">{formatCurrencyINR(r.total_cost)}</span>
                  <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
                    {total > 0 ? Math.round((r.total_cost / total) * 100) : 0}%
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-1 text-[10px] text-muted-foreground">* Share of the {list.length} states listed · Map: DataMeet</p>
        </div>
      </div>
    </ChartCard>
  );
}
