import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { PageError } from "@/components/shared/PageError";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useZones } from "@/services/zones.service";
import { CHART_AXIS, CHART_COLORS } from "@/config/chart";
import type { StateRow } from "@/types/api";
import { formatCurrencyINR, formatCurrencyINRCompact, formatNumber, formatPercent } from "@/utils/format";

const dash = <span className="text-muted-foreground">—</span>;

const COLUMNS: Column<StateRow>[] = [
  { key: "state", header: "State", cell: (s) => <span className="font-medium">{s.state}</span> },
  { key: "orders", header: "Orders", align: "right", cell: (s) => <span className="tabular-nums">{formatNumber(s.orders)}</span> },
  { key: "total_cost", header: "Total Cost", align: "right", cell: (s) => formatCurrencyINR(s.total_cost) },
  { key: "avg_cost", header: "Avg Cost", align: "right", cell: (s) => formatCurrencyINR(s.avg_cost) },
  { key: "delivery_rate_pct", header: "Delivery %", align: "right", cell: (s) => (s.joined ? formatPercent(s.delivery_rate_pct) : dash) },
  { key: "rto_rate_pct", header: "RTO %", align: "right", cell: (s) => (s.joined ? formatPercent(s.rto_rate_pct) : dash) },
  { key: "ndr_rate_pct", header: "NDR %", align: "right", cell: (s) => (s.joined ? formatPercent(s.ndr_rate_pct) : dash) },
  { key: "avg_delivery_days", header: "Avg Days", align: "right", cell: (s) => (s.joined ? `${s.avg_delivery_days.toFixed(1)} d` : dash) },
];

// Metric-aware heatmap columns: goodHigh=true means a high value is GOOD (green).
const HEAT_METRICS = [
  { key: "avg_cost", label: "Avg Cost", goodHigh: false, fmt: (v: number) => formatCurrencyINRCompact(v) },
  { key: "delivery_rate_pct", label: "Delivery %", goodHigh: true, fmt: (v: number) => `${v.toFixed(0)}%` },
  { key: "rto_rate_pct", label: "RTO %", goodHigh: false, fmt: (v: number) => `${v.toFixed(1)}%` },
  { key: "ndr_rate_pct", label: "NDR %", goodHigh: false, fmt: (v: number) => `${v.toFixed(1)}%` },
  { key: "avg_delivery_days", label: "Avg Days", goodHigh: false, fmt: (v: number) => `${v.toFixed(1)}d` },
] as const;

export default function ZonesPage() {
  const { data, isLoading, isError, refetch } = useZones();
  if (isError) return <PageError onRetry={() => refetch()} />;

  const badge = data?.source === "live" ? "live" : "sample";
  const df = data?.date_field ?? "order_date";
  const states = data?.states ?? [];
  const topByCost = [...states].sort((a, b) => b.total_cost - a.total_cost).slice(0, 12);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Shipping Cost by State"
          description={`Total courier cost per state · by ${df}`}
          loading={isLoading}
          action={<SourceBadge status={badge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topByCost} margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="state" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={64} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={64} />
              <Tooltip cursor={{ fill: "#ffffff10" }} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Bar dataKey="total_cost" name="Total Cost" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>State × Metric Heatmap</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Green = good, red = bad (per-metric scale)</p>
            </div>
            <SourceBadge status={badge} />
          </CardHeader>
          <CardContent className="flex-1 overflow-x-auto">
            {isLoading ? <Skeleton className="h-[280px] w-full" /> : <Heatmap states={topByCost} />}
          </CardContent>
        </Card>
      </div>

      <DataTable columns={COLUMNS} data={states} getRowId={(s) => s.state} loading={isLoading} emptyTitle="No states" emptyMessage="No state data for this range." />

      {data && (data.unmapped_count > 0 || data.unjoined.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {data.unjoined.length > 0 && <>Blank metrics (present in one tool only): {data.unjoined.join(", ")}. </>}
          {data.unmapped_count > 0 && (
            <>{formatNumber(data.unmapped_count)} raw label(s) didn't resolve to a state and rolled into "Unknown" (e.g. {data.unmapped.slice(0, 5).join(", ")}).</>
          )}
        </p>
      )}
    </div>
  );
}

/** Metric-aware heatmap: each column scaled independently; hue red→green by "goodness". */
function Heatmap({ states }: { states: StateRow[] }) {
  const ranges = HEAT_METRICS.map((m) => {
    const vals = states.map((s) => Number((s as unknown as Record<string, number>)[m.key]));
    return { min: Math.min(...vals), max: Math.max(...vals) };
  });

  return (
    <table className="w-full border-separate border-spacing-1 text-xs">
      <thead>
        <tr>
          <th className="p-1" />
          {HEAT_METRICS.map((m) => (
            <th key={m.key} className="p-1 text-center font-medium text-muted-foreground">{m.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {states.map((s) => (
          <tr key={s.state}>
            <td className="whitespace-nowrap pr-2 font-medium text-muted-foreground">{s.state}</td>
            {HEAT_METRICS.map((m, i) => {
              const v = Number((s as unknown as Record<string, number>)[m.key]);
              const { min, max } = ranges[i];
              const norm = max > min ? (v - min) / (max - min) : 0.5;
              const goodness = m.goodHigh ? norm : 1 - norm; // 0 = bad(red), 1 = good(green)
              const hue = Math.round(120 * goodness);
              const ext = Math.abs(2 * goodness - 1); // strong at extremes, faint mid
              const blank = !s.joined && m.key !== "avg_cost";
              return (
                <td
                  key={m.key}
                  className="rounded p-1 text-center tabular-nums"
                  style={
                    blank
                      ? { color: "#64748b" }
                      : { background: `hsl(${hue} 68% 45% / ${0.14 + 0.55 * ext})`, color: ext > 0.4 ? "#f8fafc" : "#cbd5e1" }
                  }
                >
                  {blank ? "—" : m.fmt(v)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
