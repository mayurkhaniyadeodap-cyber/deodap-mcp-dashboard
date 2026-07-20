import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { PageError } from "@/components/shared/PageError";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { UnavailableBanner } from "@/components/shared/Unavailable";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SourceStatus } from "@/services/meta.service";
import { useWeight } from "@/services/weight.service";
import { CHART_AXIS, CHART_COLORS } from "@/config/chart";
import { formatCurrencyINR, formatNumber } from "@/utils/format";
import { badgeFromSource } from "@/utils/source";

export default function WeightPage() {
  const { data, isLoading, isError, refetch } = useWeight();
  if (isError) return <PageError onRetry={() => refetch()} />;

  const unavailable = data?.source === "unavailable";
  const badge: SourceStatus | undefined = badgeFromSource(data?.source);
  const s = data?.summary;
  const hasRecon = s?.has_recon ?? true;
  const n = data?.sample_size ?? 0;
  const sampleLabel = data?.is_full
    ? `all ${formatNumber(n)}`
    : `${formatNumber(n)} of ${formatNumber(data?.total_matched ?? 0)}, sampled across the range`;
  const scatter = data?.scatter ?? [];
  const histogram = data?.histogram ?? [];
  const maxW = Math.max(1, ...scatter.flatMap((p) => [p.actual, p.charged]));

  return (
    <div className="space-y-6">
      <UnavailableBanner show={unavailable} onRetry={() => refetch()} retrying={isLoading} />
      {/* Reconciliation KPIs (reconciliation lines ≈ 2/order, by reconciliation_at — lags) */}
      {!isLoading && s && !hasRecon ? (
        <Card className="p-5 text-sm text-muted-foreground">
          No reconciliation lines in this date range yet. Courier reconciliation posts a few days
          later (filtered by <span className="font-medium">reconciliation_at</span>) — widen the range
          to see weight-dispute figures.
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Reconciliation Lines" value={s ? formatNumber(s.reconciliation_lines) : "—"} loading={isLoading} source={badge} />
          <StatCard label="Weight-Overcharged Lines" value={s ? formatNumber(s.weight_overcharged) : "—"} loading={isLoading} tone="warning" source={badge} />
          <StatCard label="Extra Weight" value={s ? `${formatNumber(Math.round(s.weight_diff_kg))} kg` : "—"} loading={isLoading} tone="warning" source={badge} />
          <StatCard label="Forward Rate Difference to Investigate" value={s ? formatCurrencyINR(s.fwd_rate_diff) : "—"} loading={isLoading} tone="danger" source={badge} />
        </div>
      )}
      {!isLoading && data && data.missing_weight_count > 0 && (
        <p className="-mt-4 text-xs text-muted-foreground">
          {data.missing_weight_pct}% of shipments ({formatNumber(data.missing_weight_count)} of {formatNumber(data.sampled_rows)} sampled ≈{" "}
          {formatNumber(Math.round((data.missing_weight_pct / 100) * (data.total_matched || 0)))} of {formatNumber(data.total_matched)}) have no recorded
          actual weight — these <span className="font-medium">cannot be weight-audited</span> (a dispute needs an actual weight).
        </p>
      )}
      {!isLoading && s && hasRecon && (
        <p className="-mt-4 text-xs text-muted-foreground">
          Reconciliation lines (~2 per order: forward + RTO legs) · by reconciliation_at · lags a few days.
          Only the forward rate difference is shown (RTO/net legs are often un-invoiced).
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Actual vs Charged Weight"
          description={`${sampleLabel} shipments · by ${data?.sample_date_field ?? "order_date"} · points above the line are under-charged on weight`}
          loading={isLoading}
          unavailable={unavailable}
          onRetry={() => refetch()}
          height={320}
          action={<SourceBadge status={badge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} />
              <XAxis type="number" dataKey="actual" name="Actual" unit="kg" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} domain={[0, Math.ceil(maxW)]} />
              <YAxis type="number" dataKey="charged" name="Charged" unit="kg" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} domain={[0, Math.ceil(maxW)]} width={44} />
              <ZAxis range={[40, 40]} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: Math.ceil(maxW), y: Math.ceil(maxW) }]} stroke={CHART_AXIS.stroke} strokeDasharray="4 4" />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(2)} kg`} />} />
              <Scatter data={scatter} fill={CHART_COLORS.blue} fillOpacity={0.7} />
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Weight Slab Distribution"
          description={`${sampleLabel} shipments · by ${data?.sample_date_field ?? "order_date"}`}
          loading={isLoading}
          unavailable={unavailable}
          onRetry={() => refetch()}
          height={320}
          action={<SourceBadge status={badge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histogram} margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="bucket" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} allowDecimals={false} width={36} />
              <Tooltip cursor={{ fill: "#ffffff10" }} content={<ChartTooltip valueFormatter={(v) => `${v} shipments`} />} />
              <Bar dataKey="count" name="Shipments" fill={CHART_COLORS.purple} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

const TONE = { default: "text-foreground", warning: "text-warning", danger: "text-destructive" } as const;

function StatCard({
  label,
  value,
  loading,
  tone = "default",
  source,
}: {
  label: string;
  value: string;
  loading: boolean;
  tone?: keyof typeof TONE;
  source?: SourceStatus;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-muted-foreground">{label}</div>
        <SourceBadge status={source} />
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-24" />
      ) : (
        <div className={`mt-2 text-2xl font-semibold tracking-tight ${TONE[tone]}`}>{value}</div>
      )}
    </Card>
  );
}
