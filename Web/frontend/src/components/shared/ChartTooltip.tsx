import type { ReactNode } from "react";

/**
 * Shared dark-theme tooltip for every Recharts chart. Used via the Recharts
 * `content` prop (`content={<ChartTooltip valueFormatter={…} />}`) so we fully
 * control colors — the default <Tooltip> renders item text in the series color,
 * which is unreadable on our dark surface.
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
    <div
      style={{
        background: "#1a2236",
        border: "1px solid #334155",
        borderRadius: 10,
        padding: "11px 15px",
        color: "#f1f5f9",
        fontSize: 13,
        lineHeight: 1.55,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
      }}
    >
      {!hideLabel && (label || label === 0) ? (
        <div style={{ marginBottom: 6, fontWeight: 600, color: "#f1f5f9" }}>{label}</div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {payload.map((item, i) => {
          const name = String(item.name ?? item.dataKey ?? "");
          const raw = Number(item.value ?? 0);
          const color = item.color ?? item.payload?.fill ?? item.fill ?? "#64748b";
          const formatted = valueFormatter ? valueFormatter(raw, name, item) : item.value;
          const pct = total && total > 0 ? ` (${((raw / total) * 100).toFixed(1)}%)` : "";
          return (
            <div key={`${name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ color: "#cbd5e1" }}>{name}:</span>
              <span style={{ color: "#f1f5f9", fontWeight: 600 }}>
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
