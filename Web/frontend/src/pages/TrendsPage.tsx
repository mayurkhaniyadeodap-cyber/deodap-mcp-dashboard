import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Freshness } from "@/components/shared/Freshness";
import { PageError } from "@/components/shared/PageError";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { PanelUnavailable, UnavailableBanner } from "@/components/shared/Unavailable";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecovery, useTrend } from "@/services/trend.service";
import { CHART_AXIS, CHART_COLORS, CHART_SERIES } from "@/config/chart";
import { formatCurrencyINR, formatCurrencyINRCompact, formatNumber } from "@/utils/format";
import { badgeFromSource, cacheState } from "@/utils/source";

export default function TrendsPage() {
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useTrend();
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
      <div className="flex items-center justify-end">
        <Freshness updatedAt={dataUpdatedAt} />
      </div>
      {/* Cumulative rate difference identified — the biggest money signal, up top */}
      <ChartCard
        title="Cumulative Rate Difference Identified"
        description="Identified (courier over-invoiced vs applied), NOT recovered · by reconciliation_at · true recovery needs dispute-outcome tracking (Phase 3)"
        loading={false}
        height={280}
        action={
          <SourceBadge
            status={badgeFromSource(rec?.source)}
            cache={cacheState(rec?.source, { computing: rec?.computing, recalculating: rec?.recalculating })}
          />
        }
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
        ) : (rec?.points?.length ?? 0) === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No rate difference identified for this range yet.
          </div>
        ) : (
          // Bar chart reads clearly even with low / single-point data (a lone month is
          // a visible bar, where an area/line was near-empty). Same data source
          // (rec.points), same dataKey/label, ₹ formatting. Partial/gap months render
          // as faded bars (they were hollow dots before).
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rec?.points ?? []} margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="month" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={96} />
              <Tooltip cursor={{ fill: "#ffffff08" }} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Bar dataKey="cumulative" name="Identified (cumulative)" fill={CHART_COLORS.amber} radius={[4, 4, 0, 0]} maxBarSize={72}>
                {(rec?.points ?? []).map((p, i) => (
                  <Cell key={i} fill={CHART_COLORS.amber} fillOpacity={p.partial || p.gap ? 0.4 : 1} />
                ))}
              </Bar>
            </BarChart>
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
          Faded bars = partial/incomplete months (reconciliation lags — those months flatten because data is still arriving, not because they're resolved).
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
            {/* One smooth line per courier — same data (byMonth) & keys (couriers).
                Markers on each point; names preserved for tooltip + legend. */}
            {couriers.map((c, i) => {
              const color = CHART_SERIES[i % CHART_SERIES.length];
              return (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  name={c}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
