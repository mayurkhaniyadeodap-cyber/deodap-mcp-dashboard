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
  // Discrepancies
  flagged: { accent: "red", icon: AlertTriangle },
  weight_disc: { accent: "purple", icon: Scale },
  at_risk: { accent: "amber", icon: Wallet },
  resolved: { accent: "green", icon: CheckCircle2 },
};

function formatValue(kpi: Kpi): string {
  // No data in the selected window → "N/A" (never a misleading ₹0/0).
  if (kpi.unavailable) return "N/A";
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
  const actionNeeded = kpi.key === "pending_recon" && kpi.value > 0;

  return (
    <div
      className={cn(
        // Keep ONLY the top accent bar + icon chip. No coloured outline/glow —
        // that was decoration. EXCEPTION: a red border when Pending Reconciliation
        // needs action (a semantic signal, not noise).
        "group relative overflow-hidden rounded-xl border bg-surface-gradient p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        actionNeeded ? "border-destructive/60" : "border-border hover:border-border/80",
      )}
    >
      {/* Top accent bar */}
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: `linear-gradient(90deg, ${hex}, ${accentAlpha(accent, 0.35)})` }}
      />

      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {kpi.label}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <SourceBadge status={source} />
          <span
            className="grid size-9 place-items-center rounded-md"
            style={{ background: accentAlpha(accent, 0.12), color: hex }}
          >
            <Icon className="size-5" />
          </span>
        </div>
      </div>

      <div className={cn("mt-3 text-[36px] font-extrabold leading-none tracking-tight", kpi.unavailable && "text-muted-foreground")}>
        {formatValue(kpi)}
      </div>

      {/* Data basis — which date_field + window this value covers. Always shown so
          nobody misreads a partial-day / short-window number as broken. */}
      {basis ? (
        <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <CalendarDays className="size-3 shrink-0" />
          <span className="truncate">{basis}</span>
        </div>
      ) : null}

      {kpi.subtitle ? (
        <div className="mt-2 text-[12px] leading-snug text-muted-foreground">{kpi.subtitle}</div>
      ) : null}

      {/* Delta line: "Action Needed" for pending, a real delta when we have one,
          otherwise nothing (never a fabricated 0%). */}
      {actionNeeded ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 font-semibold text-destructive">
            <AlertTriangle className="size-3" /> Action Needed
          </span>
        </div>
      ) : kpi.has_delta ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span className={cn("inline-flex items-center gap-0.5 font-semibold", toneClass)}>
            <DeltaArrow className="size-3.5" />
            {formatPercent(Math.abs(kpi.delta))}
          </span>
          <span className="text-muted-foreground">vs last period</span>
        </div>
      ) : null}
    </div>
  );
}
