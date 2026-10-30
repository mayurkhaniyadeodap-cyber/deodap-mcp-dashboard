import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  HandCoins,
  Info,
  type LucideIcon,
  Package,
  Percent,
  PiggyBank,
  Receipt,
  RefreshCw,
  Scale,
  Wallet,
  WifiOff,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useId } from "react";
import { Freshness } from "@/components/shared/Freshness";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/services/meta.service";
import type { Kpi } from "@/types/api";
import { formatCurrencyINR, formatNumberCompact, formatPercent } from "@/utils/format";

/** KPI key → icon. Falls back to Wallet for unknown keys. */
const KPI_ICON: Record<string, LucideIcon> = {
  // Dashboard
  total_billing: Wallet,
  total_shipments: Package,
  average_cost: Receipt,
  total_cod: Banknote,
  pending_recon: Clock,
  claimable: HandCoins,
  savings: PiggyBank,
  rate_diff: Wallet,
  on_time: CheckCircle2,
  overdue: Clock,
  // COD
  collected: Banknote,
  cod_value: Banknote,
  remitted: PiggyBank,
  cod_records: Package,
  pending: Clock,
  recon_rate: Percent,
  // COD Intelligence
  cod_share: Percent,
  avg_cod_value: Banknote,
  remittance_rate: Percent,
  overdue_rate: Percent,
  overdue_amount: AlertTriangle,
  outstanding_cod: Wallet,
  settlement_tat: Clock,
  // Discrepancies
  flagged: AlertTriangle,
  weight_disc: Scale,
  at_risk: Wallet,
  resolved: CheckCircle2,
};

const kpiIcon = (key: string): LucideIcon => KPI_ICON[key] ?? Wallet;

/** Per-KPI accent: icon tile classes + sparkline colour. Unlisted keys use the brand teal. */
interface Tone {
  tile: string;
  line: string;
}
const BRAND: Tone = { tile: "bg-primary/10 text-primary dark:bg-primary/15", line: "hsl(var(--primary))" };
const KPI_TONE: Record<string, Tone> = {
  total_billing: BRAND,
  total_shipments: { tile: "bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300", line: "#0ea5e9" },
  average_cost: { tile: "bg-violet-500/10 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300", line: "#8b5cf6" },
  total_cod: { tile: "bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300", line: "#f59e0b" },
  pending_recon: { tile: "bg-rose-500/10 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300", line: "#f43f5e" },
};
const kpiTone = (key: string): Tone => KPI_TONE[key] ?? BRAND;

/** True when the KPI has no trustworthy number to show (never rendered as ₹0/0). */
function isMissing(kpi: Kpi): boolean {
  // Intl.NumberFormat.format(undefined) yields "NaN", so guard before formatting.
  return kpi.unavailable || !Number.isFinite(kpi.value);
}

/** Full Indian-format value (₹68,39,727) — exact, never abbreviated. */
function formatValue(kpi: Kpi): string {
  if (isMissing(kpi)) return "N/A";
  switch (kpi.format) {
    case "currency":
      return formatCurrencyINR(kpi.value);
    case "percent":
      return formatPercent(kpi.value);
    default:
      return formatNumberCompact(kpi.value);
  }
}

/** Staggered entrance (CSS animation; disabled by prefers-reduced-motion). */
function stagger(index?: number): CSSProperties | undefined {
  return index === undefined ? undefined : { animationDelay: `${Math.min(index, 8) * 45}ms` };
}

const SHELL = "group relative flex min-h-[172px] min-w-0 flex-col rounded-xl border bg-card p-4 shadow-card animate-fade-up";

/** Tiny trend line from a REAL series (no axes; a visual summary of the data). */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const gid = useId();
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 26 - ((v - min) / span) * 22] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg aria-hidden viewBox="0 0 100 28" preserveAspectRatio="none" className="mt-2 h-8 w-full overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L100,28 L0,28 Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface KpiCardProps {
  kpi: Kpi;
  icon?: LucideIcon;
  /** Live/Sample provenance. Optional. */
  source?: SourceStatus;
  /** Data basis, e.g. "Order date · Last 30 days" (in the ⓘ tooltip; shown in the
   *  footer when there is no updatedAt). */
  basis?: string;
  /** Short explanation for a metric that is easy to misread (ⓘ tooltip). */
  hint?: string;
  /** A legitimate recalculation is running: badge says so and the value is dimmed. */
  recalculating?: boolean;
  /** Amber explanatory line (e.g. why a figure isn't for the selected range yet). */
  note?: ReactNode;
  /** Real series for the same range (sparkline). Omitted → no sparkline. */
  trend?: number[];
  /** What the sparkline covers (hover text), e.g. "7 equal periods of the range". */
  trendLabel?: string;
  /** The series is still loading → a placeholder in the sparkline slot. */
  trendLoading?: boolean;
  /** Why there is no sparkline (shown small in its slot). */
  trendNote?: string;
  /** When this value was received (epoch ms) → "Updated 2m ago". */
  updatedAt?: number;
  /** Position in its grid — drives the entrance stagger. */
  index?: number;
}

export function KpiCard({ kpi, icon, source, basis, hint, recalculating, note, trend, trendLabel, trendLoading, trendNote, updatedAt, index }: KpiCardProps) {
  const Icon = icon ?? kpiIcon(kpi.key);
  const missing = isMissing(kpi);
  const value = formatValue(kpi);

  // Arrow follows the SIGN (did it go up/down); color follows the MEANING
  // (delta_tone: good = green, bad = red) — a cost increase is red even though ↑.
  const DeltaArrow = kpi.delta >= 0 ? ArrowUpRight : ArrowDownRight;
  const toneClass =
    kpi.delta_tone === "positive" ? "text-success" : kpi.delta_tone === "negative" ? "text-destructive" : "text-muted-foreground";
  // Pending Reconciliation status (approved design): live amount > 0 → "Action
  // Needed"; live amount exactly 0 → "No Pending Reconciliation". Neither shows when
  // the value is unavailable (the tile renders N/A instead).
  const actionNeeded = kpi.key === "pending_recon" && !missing && kpi.value > 0;
  const noPending = kpi.key === "pending_recon" && !missing && kpi.value === 0;
  // What explains the figure lives in the ⓘ tooltip: hint, subtitle, basis.
  const details = [hint, kpi.subtitle, basis ? `Basis: ${basis}` : undefined].filter(Boolean) as string[];

  return (
    <article
      aria-label={kpi.label}
      style={stagger(index)}
      className={cn(
        SHELL,
        "transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover",
        actionNeeded ? "border-destructive/50" : "border-border hover:border-primary/30",
      )}
    >
      <KpiHeader label={kpi.label} icon={Icon} tone={kpiTone(kpi.key)} details={details}>
        <SourceBadge status={source} recalculating={recalculating} />
      </KpiHeader>

      {/* Exact value. Keyed on the value so only a real change fades in. */}
      <div
        key={String(kpi.value)}
        title={missing ? "No value for this range" : value}
        className={cn(
          "mt-1 animate-fade-in truncate whitespace-nowrap text-[clamp(1.25rem,1.55vw,1.6rem)] font-bold leading-tight tracking-tight tabular-nums",
          missing && "text-muted-foreground",
          recalculating && "opacity-60",
        )}
      >
        {value}
      </div>

      {/* Trend (↑/↓ % vs previous month) or the Pending Reconciliation status; nothing
          when there's no real delta (never a fabricated 0%). */}
      <div className="mt-1.5 flex min-h-[18px] flex-wrap items-center gap-1 text-xs">
        {missing ? (
          <span className="text-muted-foreground">No value for this range</span>
        ) : actionNeeded ? (
          <span className="inline-flex items-center gap-1 font-semibold text-destructive">
            <AlertTriangle className="size-3.5" /> Action Needed
          </span>
        ) : noPending ? (
          <span className="inline-flex items-center gap-1 font-medium text-success">
            <CheckCircle2 className="size-3.5" /> No Pending Reconciliation
          </span>
        ) : kpi.has_delta ? (
          <>
            <span className={cn("inline-flex items-center font-semibold tabular-nums", toneClass)}>
              <DeltaArrow className="size-3.5" />
              {formatPercent(Math.abs(kpi.delta))}
            </span>
            <span className="text-muted-foreground">vs previous month</span>
          </>
        ) : null}
      </div>

      {note ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-warning">
          <RefreshCw className="mt-px size-3 shrink-0" />
          <span>{note}</span>
        </p>
      ) : null}

      {missing ? null : trend && trend.length > 1 ? (
        <div title={trendLabel}>
          <Sparkline values={trend} color={kpiTone(kpi.key).line} />
        </div>
      ) : trendLoading ? (
        <Skeleton aria-label="Loading trend" className="mt-2 h-8 w-full opacity-60" />
      ) : trendNote ? (
        <p className="mt-2 flex h-8 items-end text-[11px] leading-tight text-muted-foreground">{trendNote}</p>
      ) : null}

      <div className="mt-auto pt-2">
        {updatedAt ? (
          <Freshness updatedAt={updatedAt} />
        ) : basis ? (
          <span className="block truncate text-[11px] text-muted-foreground">{basis}</span>
        ) : null}
      </div>
    </article>
  );
}

/** Header shared by every KPI state: icon tile + badge on top, label (+ ⓘ) below. */
function KpiHeader({
  label,
  icon: Icon,
  tone = BRAND,
  details,
  children,
}: {
  label: string;
  icon: LucideIcon;
  tone?: Tone;
  details?: string[];
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-lg", tone.tile)}>
          <Icon className="size-5" />
        </span>
        <div className="shrink-0">{children}</div>
      </div>
      <div className="relative mt-3 flex items-center gap-1 text-[13px] font-medium leading-tight text-muted-foreground">
        <span className="line-clamp-2 min-w-0" title={label}>
          {label}
        </span>
        {details && details.length > 0 ? (
          <span className="group/hint shrink-0">
            <button
              type="button"
              aria-label={`About ${label}: ${details.join(" ")}`}
              className="grid place-items-center rounded text-muted-foreground/60 hover:text-foreground"
            >
              <Info className="size-3.5" />
            </button>
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute inset-x-0 top-full z-30 mt-1.5 space-y-1 rounded-lg border border-border bg-popover p-2.5 text-[11px] font-normal leading-snug text-popover-foreground opacity-0 shadow-card-hover transition-opacity duration-150 group-focus-within/hint:visible group-focus-within/hint:opacity-100 group-hover/hint:visible group-hover/hint:opacity-100"
            >
              {details.map((d) => (
                <span key={d} className="block">
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Loading placeholder with the same footprint as a KPI card (no layout shift). */
export function KpiCardSkeleton({
  label,
  kpiKey,
  index,
  message,
  badge,
}: {
  label?: string;
  kpiKey?: string;
  index?: number;
  message?: string;
  /** Status badge for a known state (e.g. Recalculating) while the value loads. */
  badge?: ReactNode;
}) {
  return (
    <div aria-busy="true" aria-label={label ? `${label} loading` : "Loading"} style={stagger(index)} className={cn(SHELL, "border-border")}>
      {label ? (
        <KpiHeader label={label} icon={kpiIcon(kpiKey ?? "")} tone={kpiTone(kpiKey ?? "")}>
          {badge}
        </KpiHeader>
      ) : (
        <Skeleton className="h-16 w-40" />
      )}
      <Skeleton className="mt-2 h-7 w-32" />
      <Skeleton className="mt-2 h-3.5 w-28" />
      {message ? <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{message}</p> : <Skeleton className="mt-3 h-8 w-full" />}
    </div>
  );
}

/** Whole-endpoint failure: an explicit unavailable state (never ₹0) with Retry. */
export function KpiCardUnavailable({
  label,
  kpiKey,
  onRetry,
  retrying,
  index,
}: {
  label: string;
  kpiKey: string;
  onRetry?: () => void;
  retrying?: boolean;
  index?: number;
}) {
  return (
    <article aria-label={label} style={stagger(index)} className={cn(SHELL, "border-border")}>
      <KpiHeader label={label} icon={kpiIcon(kpiKey)} tone={kpiTone(kpiKey)}>
        <SourceBadge status="unavailable" />
      </KpiHeader>
      <div className="mt-2 flex items-center gap-2 text-muted-foreground">
        <WifiOff className="size-5 shrink-0" />
        <span className="text-lg font-semibold">Unavailable</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Live value could not be loaded. No number is shown.</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-auto inline-flex w-fit items-center gap-1.5 pt-2 text-xs font-semibold text-primary hover:underline disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", retrying && "animate-spin")} />
          {retrying ? "Retrying…" : "Retry"}
        </button>
      ) : null}
    </article>
  );
}
