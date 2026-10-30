import type { ReactNode } from "react";

/**
 * Shared tooltip for every Recharts chart. Used via the Recharts `content` prop
 * (`content={<ChartTooltip valueFormatter={…} />}`) so we fully control colours —
 * the default <Tooltip> renders item text in the series colour, which is unreadable
 * on our surfaces. Themed with the popover tokens, so it follows dark/light mode.
 *
 * Recharts injects `active` / `payload` / `label`; the rest are our own props.
 */
interface TooltipItem {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  fill?: string;
  payload?: { fill?: string } & Record<string, unknown>;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  /** Format each row's value (currency, "N shipments", "N kg", …). */
  valueFormatter?: (value: number, name: string, item: TooltipItem) => ReactNode;
  /** Grand total — when set, each row also shows its share of it (the donut). */
  total?: number;
  /** Hide the header row (pie slices have no meaningful axis label). */
  hideLabel?: boolean;
}

export function ChartTooltip({ active, payload, label, valueFormatter, total, hideLabel }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="animate-fade-in rounded-lg border border-border bg-popover px-3.5 py-2.5 text-[13px] leading-relaxed text-popover-foreground shadow-card-hover">
      {!hideLabel && (label || label === 0) ? <div className="mb-1.5 font-semibold">{label}</div> : null}
      <div className="flex flex-col gap-1">
        {payload.map((item, i) => {
          const name = String(item.name ?? item.dataKey ?? "");
          const raw = Number(item.value ?? 0);
          const color = item.color ?? item.payload?.fill ?? item.fill ?? "#64748b";
          const formatted = valueFormatter ? valueFormatter(raw, name, item) : item.value;
          const pct = total && total > 0 ? ` (${((raw / total) * 100).toFixed(1)}%)` : "";
          return (
            <div key={`${name}-${i}`} className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-sm" style={{ background: color }} />
              <span className="text-muted-foreground">{name}:</span>
              <span className="font-semibold tabular-nums">
                {formatted}
                {pct}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
