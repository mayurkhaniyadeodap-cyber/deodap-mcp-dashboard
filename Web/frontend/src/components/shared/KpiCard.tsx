import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock,
  type LucideIcon,
  Package,
  Percent,
  PiggyBank,
  Receipt,
  Scale,
  Wallet,
} from "lucide-react";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { cn } from "@/lib/utils";
import { type Accent, ACCENT_HEX, accentAlpha } from "@/config/tokens";
import type { SourceStatus } from "@/services/meta.service";
import type { Kpi } from "@/types/api";
import { formatCurrencyINRCompact, formatNumberCompact, formatPercent } from "@/utils/format";

/** KPI key → accent + icon. Falls back to blue/Wallet for unknown keys. */
const KPI_META: Record<string, { accent: Accent; icon: LucideIcon }> = {
  // Dashboard
  total_billing: { accent: "blue", icon: Wallet },
  total_shipments: { accent: "cyan", icon: Package },
  average_cost: { accent: "purple", icon: Receipt },
  total_cod: { accent: "amber", icon: Banknote },
  pending_recon: { accent: "red", icon: Clock },
  savings: { accent: "green", icon: PiggyBank },
  rate_diff: { accent: "amber", icon: Wallet },
  on_time: { accent: "green", icon: CheckCircle2 },
  overdue: { accent: "red", icon: Clock },
  // COD
  collected: { accent: "blue", icon: Banknote },
  cod_value: { accent: "amber", icon: Banknote },
  remitted: { accent: "green", icon: PiggyBank },
  cod_records: { accent: "cyan", icon: Package },
  pending: { accent: "red", icon: Clock },
  recon_rate: { accent: "cyan", icon: Percent },
  // COD Intelligence
  cod_share: { accent: "amber", icon: Percent },
  avg_cod_value: { accent: "blue", icon: Banknote },
  remittance_rate: { accent: "green", icon: Percent },
  overdue_rate: { accent: "red", icon: Percent },
  overdue_amount: { accent: "red", icon: AlertTriangle },
  outstanding_cod: { accent: "amber", icon: Wallet },
  settlement_tat: { accent: "purple", icon: Clock },
  // Discrepancies
  flagged: { accent: "red", icon: AlertTriangle },
  weight_disc: { accent: "purple", icon: Scale },
  at_risk: { accent: "amber", icon: Wallet },
  resolved: { accent: "green", icon: CheckCircle2 },
};

function formatValue(kpi: Kpi): string {
  // No data in the selected window, or a missing/non-numeric value → "N/A" (never a
  // misleading ₹0/0, and never "₹NaN" — Intl.NumberFormat.format(undefined) yields
  // "NaN", so guard before it reaches the formatter).
  if (kpi.unavailable || !Number.isFinite(kpi.value)) return "N/A";
  switch (kpi.format) {
    case "currency":
      return formatCurrencyINRCompact(kpi.value);
    case "percent":
      return formatPercent(kpi.value);
    default:
      return formatNumberCompact(kpi.value);
  }
}

interface KpiCardProps {
  kpi: Kpi;
  /** Override the derived accent/icon if needed. */
  accent?: Accent;
  icon?: LucideIcon;
  /** Live/Sample provenance (from /api/_meta/sources). Optional. */
  source?: SourceStatus;
  /** Data basis line, e.g. "Order date · Today (partial)". Always shown so the
   *  active window is unmissable. */
  basis?: string;
}

export function KpiCard({ kpi, accent: accentProp, icon: iconProp, source, basis }: KpiCardProps) {
  const meta = KPI_META[kpi.key] ?? { accent: "blue" as Accent, icon: Wallet };
  const accent = accentProp ?? meta.accent;
  const Icon = iconProp ?? meta.icon;
  const hex = ACCENT_HEX[accent];

  // Arrow follows the SIGN (did it go up/down); color follows the MEANING
  // (delta_tone: good = green, bad = red) — a cost increase is red even though ↑.
  const DeltaArrow = kpi.delta >= 0 ? ArrowUpRight : ArrowDownRight;
  const toneClass =
    kpi.delta_tone === "positive" ? "text-success"
    : kpi.delta_tone === "negative" ? "text-destructive"
    : "text-muted-foreground";
  // Pending Reconciliation status pill (approved design): live amount > 0 → "Action
  // Needed"; live amount exactly 0 → "No Pending Reconciliation". Neither shows when
  // the value is unavailable (the tile renders N/A instead).
  const actionNeeded = kpi.key === "pending_recon" && !kpi.unavailable && kpi.value > 0;
  const noPending = kpi.key === "pending_recon" && !kpi.unavailable && kpi.value === 0;

  return (
    <div
      className={cn(
        // Clean modern tile: top accent bar + subtle icon chip. Red border only when
        // Pending Reconciliation needs action (a semantic signal, not decoration).
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-surface-gradient p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        actionNeeded ? "border-destructive/60" : "border-border hover:border-border/80",
      )}
    >
      {/* Top accent bar */}
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${hex}, ${accentAlpha(accent, 0.35)})` }}
      />

      {/* 1. Title (+ icon chip, right) */}
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
          {kpi.label}
        </span>
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg"
          style={{ background: accentAlpha(accent, 0.12), color: hex }}
        >
          <Icon className="size-4" />
        </span>
      </div>

      {/* 2. LIVE badge */}
      {source ? (
        <div className="mt-2.5">
          <SourceBadge status={source} />
        </div>
      ) : null}

      {/* 3. Large value — full Indian format, tabular for alignment */}
      <div
        className={cn(
          "mt-3 text-[30px] font-bold leading-none tracking-tight tabular-nums",
          kpi.unavailable && "text-muted-foreground",
        )}
      >
        {formatValue(kpi)}
      </div>

      {/* 4. Date line — which date_field + window this value covers */}
      {basis ? (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <CalendarDays className="size-3.5 shrink-0" />
          <span className="truncate">{basis}</span>
        </div>
      ) : null}

      {/* 5 + 6. Trend (↑/↓ %) + "vs previous month". "Action Needed" for pending;
          nothing when there's no real delta (never a fabricated 0%). */}
      {actionNeeded ? (
        <div className="mt-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
            <AlertTriangle className="size-3" /> Action Needed
          </span>
        </div>
      ) : noPending ? (
        <div className="mt-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
            <CheckCircle2 className="size-3" /> No Pending Reconciliation
          </span>
        </div>
      ) : kpi.has_delta ? (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <span className={cn("inline-flex items-center gap-0.5 font-semibold", toneClass)}>
            <DeltaArrow className="size-3.5" />
            {formatPercent(Math.abs(kpi.delta))}
          </span>
          <span className="text-muted-foreground">vs previous month</span>
        </div>
      ) : null}

      {/* Supplementary context (e.g. excluded breakdown) — below the required order. */}
      {kpi.subtitle ? (
        <div className="mt-3 border-t border-border/60 pt-3 text-[11px] leading-snug text-muted-foreground">
          {kpi.subtitle}
        </div>
      ) : null}
    </div>
  );
}
