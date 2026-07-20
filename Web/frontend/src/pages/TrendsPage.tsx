import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { PageError } from "@/components/shared/PageError";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { PanelUnavailable, UnavailableBanner } from "@/components/shared/Unavailable";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecovery, useTrend } from "@/services/trend.service";
import { CHART_AXIS, CHART_COLORS, CHART_SERIES } from "@/config/chart";
import { formatCurrencyINR, formatCurrencyINRCompact, formatNumber } from "@/utils/format";
import { badgeFromSource } from "@/utils/source";

export default function TrendsPage() {
  const { data, isLoading, isError, refetch } = useTrend();
  const recovery = useRecovery();
  if (isError) return <PageError onRetry={() => refetch()} />;

  const unavailable = data?.source === "unavailable";
  const badge = badgeFromSource(data?.source);
  const daily = data?.daily ?? [];
  const byMonth = data?.by_month ?? [];
  const couriers = data?.couriers ?? [];
  const partial = data?.partial_months ?? [];
  const rec = recovery.data;
  const recUnavailable = rec?.source === "unavailable";

  return (
    <div className="space-y-6">
      <UnavailableBanner show={unavailable || recUnavailable} onRetry={() => { refetch(); recovery.refetch(); }} retrying={isLoading} />
      {/* Cumulative rate difference identified — the biggest money signal, up top */}
      <ChartCard
        title="Cumulative Rate Difference Identified"
        description="Identified (courier over-invoiced vs applied), NOT recovered · by reconciliation_at · true recovery needs dispute-outcome tracking (Phase 3)"
        loading={false}
        height={280}
        action={<SourceBadge status={badgeFromSource(rec?.source)} />}
      >
        {recovery.isLoading ? (
          <div className="flex h-full flex-col justify-center gap-2 px-2">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : recUnavailable ? (
          <PanelUnavailable onRetry={() => recovery.refetch()} retrying={recovery.isFetching} />
        ) : rec?.computing ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            Computing the per-month series… (first calculation in progress)
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rec?.points ?? []} margin={{ left: 8, right: 8 }}>
              <defs>
                <linearGradient id="recFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.amber} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={CHART_COLORS.amber} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="month" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={96} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Area
                type="monotone"
                dataKey="cumulative"
                name="Identified (cumulative)"
                stroke={CHART_COLORS.amber}
                strokeWidth={2}
                fill="url(#recFill)"
                dot={(props) => {
                  const p = rec?.points?.[props.index];
                  const hollow = p?.partial || p?.gap;
                  return <circle key={props.index} cx={props.cx} cy={props.cy} r={hollow ? 4 : 3} fill={hollow ? "transparent" : CHART_COLORS.amber} stroke={CHART_COLORS.amber} strokeWidth={hollow ? 2 : 0} />;
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      {rec?.recalculating && (
        <p className="-mt-4 text-xs text-muted-foreground">
          Recalculating for this range — showing the last computed series.
        </p>
      )}
      {rec && rec.points.some((p) => p.partial || p.gap) && (
        <p className="-mt-4 text-xs text-muted-foreground">
          Hollow markers = partial/incomplete months (reconciliation lags — the curve flattens because data is still arriving, not because it's resolved).
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Daily orders + value */}
        <ChartCard title="Daily Order Value" description={`Order value per day · by ${data?.date_field ?? "order_date"}`} loading={isLoading} unavailable={unavailable} onRetry={() => refetch()} height={300} className="lg:col-span-2" action={<SourceBadge status={badge} />}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily} margin={{ left: 8, right: 8 }}>
              <defs>
                <linearGradient id="dayFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.blue} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="day" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 10 }} minTickGap={24} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={96} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Area type="monotone" dataKey="order_value" name="Order Value" stroke={CHART_COLORS.blue} strokeWidth={2} fill="url(#dayFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Daily order volume */}
        <ChartCard title="Daily Orders" description={`Order count per day · ${formatNumber(daily.reduce((s, d) => s + d.orders, 0))} total`} loading={isLoading} unavailable={unavailable} onRetry={() => refetch()} height={300} action={<SourceBadge status={badge} />}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={daily} margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="day" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 10 }} minTickGap={24} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} width={44} />
              <Tooltip content={<ChartTooltip valueFormatter={(v) => `${formatNumber(v)} orders`} />} />
              <Line type="monotone" dataKey="orders" name="Orders" stroke={CHART_COLORS.green} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Monthly billing by courier */}
      <ChartCard
        title="Monthly Billing by Courier"
        description={`Courier cost per month · ${data?.window ?? ""}${partial.length ? ` · ${partial.join(", ")} partial (data still arriving)` : ""}`}
        loading={isLoading}
        unavailable={unavailable}
        onRetry={() => refetch()}
        height={320}
        action={<SourceBadge status={badge} />}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={byMonth} margin={{ left: 8, right: 8 }}>
            <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
            <XAxis dataKey="month" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} />
            <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={96} />
            <Tooltip content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {couriers.map((c, i) => (
              <Line key={c} type="monotone" dataKey={c} stroke={CHART_SERIES[i % CHART_SERIES.length]} strokeWidth={1.75} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
