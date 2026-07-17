import { courierStyle } from "@/config/couriers";
import { hexAlpha } from "@/config/tokens";
import type { Courier } from "@/types/api";
import { formatCurrencyINR, formatPercent } from "@/utils/format";

interface CourierScorecardProps {
  courier: Courier;
  /** Largest shipment count across couriers (drives the progress bar width). */
  maxShipments: number;
  /** Total shipments across couriers (drives the "% of Delivery volume" text). */
  totalShipments: number;
}

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** One reusable per-courier scorecard: code chip, stat rows, volume bar. */
export function CourierScorecard({ courier, maxShipments, totalShipments }: CourierScorecardProps) {
  const style = courierStyle(courier.name);
  const color = style.color;
  const barWidth = pct(courier.shipments, maxShipments);
  const volumePct = pct(courier.shipments, totalShipments);

  // Only honest, live per-courier values. Removed: COD Charges % (was a
  // hardcoded ~1.7% freight×0.02 constant on every courier) and COD Remitted
  // (per-courier remitted doesn't exist — cod_remittance_summary is global-only).
  const rows: { label: string; value: string }[] = [
    { label: "Cost (our rate card)", value: formatCurrencyINR(courier.freight + courier.rto) },
    { label: "Cost / Shipment", value: formatCurrencyINR(courier.avg_cost) },
    { label: "RTO Rate", value: formatPercent(courier.rto_pct) },
    { label: "COD Value", value: formatCurrencyINR(courier.cod_value) },
  ];

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface-gradient p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ boxShadow: `0 10px 30px -18px ${hexAlpha(color, 0.5)}` }}
    >
      {/* Colored top border */}
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${color}, ${hexAlpha(color, 0.35)})` }}
      />

      {/* Header */}
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 min-w-9 place-items-center rounded-md px-2 text-xs font-bold tracking-wide"
          style={{ background: hexAlpha(color, 0.14), color }}
        >
          {style.code}
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold tracking-tight">{courier.name}</div>
          <div className="text-xs text-muted-foreground">{courier.shipments} shipments</div>
        </div>
      </div>

      {/* Stat rows */}
      <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="font-semibold tabular-nums" style={{ color }}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Footer: volume bar */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: hexAlpha(color, 0.15) }}>
          <div className="h-full rounded-full" style={{ width: `${barWidth}%`, background: color }} />
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {volumePct.toFixed(1)}% of delivery volume
        </div>
      </div>
    </div>
  );
}
