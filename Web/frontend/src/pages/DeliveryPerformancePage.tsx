import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageError } from "@/components/shared/PageError";
import { BillingTabs } from "@/components/shared/PageTabs";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { PanelUnavailable, UnavailableBanner } from "@/components/shared/Unavailable";
import { Card } from "@/components/ui/card";
import { useSla } from "@/services/sla.service";
import { useDateRange } from "@/store/dateRange.store";
import { CHART_COLORS } from "@/config/chart";
import type { Kpi } from "@/types/api";
import { formatNumber, formatPercent } from "@/utils/format";
import { basisLabel } from "@/utils/provenance";
import { badgeFromSource } from "@/utils/source";

type MetricRow = { metric: string; value: string } & Record<string, unknown>;

const SUMMARY_COLS: Column<MetricRow>[] = [
  { key: "metric", header: "Metric", cell: (r) => <span className="font-medium">{r.metric}</span> },
  { key: "value", header: "Value", align: "right", cell: (r) => <span className="tabular-nums">{r.value}</span> },
];

export default function DeliveryPerformancePage() {
  const { data, isLoading, isError, refetch } = useSla();
  if (isError) return <PageError onRetry={() => refetch()} />;

  const unavailable = data?.source === "unavailable";
  const badge = badgeFromSource(data?.source);
  const df = data?.date_field ?? "order_date";
  const { preset, from, to } = useDateRange();
  const basis = basisLabel(df, preset, from, to);

  // KPI cards — all live from sla_performance. neutral (no delta) like the other
  // lagged operational metrics.
  const kpi = (key: string, label: string, value: number, format: Kpi["format"]): Kpi => ({
    key, label, value, format, delta: 0, delta_tone: "neutral", has_delta: false, unavailable: false,
  });
  const kpis: Kpi[] = data
    ? [
        kpi("on_time", "On-Time %", data.on_time_pct, "percent"),
        kpi("flagged", "Late Deliveries", data.late, "number"),
        kpi("total_shipments", "Delivered Orders", data.delivered, "number"),
        kpi("overdue", "Overdue In Transit", data.overdue_in_transit, "number"),
        kpi("at_risk", "Average Delay (Days)", data.avg_delay_days, "number"),
      ]
    : [];

  // Donut — On Time / Late / Overdue.
  const donut = data
    ? [
        { name: "On Time", value: data.on_time, fill: CHART_COLORS.green },
        { name: "Late", value: data.late, fill: CHART_COLORS.amber },
        { name: "Overdue", value: data.overdue_in_transit, fill: CHART_COLORS.red },
      ]
    : [];
  const donutTotal = donut.reduce((s, d) => s + d.value, 0);

  // Summary table — Metric / Value.
  const summaryRows: MetricRow[] = data
    ? [
        { metric: "Delivered", value: formatNumber(data.delivered) },
        { metric: "On Time", value: formatNumber(data.on_time) },
        { metric: "Late", value: formatNumber(data.late) },
        { metric: "Overdue", value: formatNumber(data.overdue_in_transit) },
        { metric: "Average Delay", value: `${formatNumber(data.avg_delay_days)} days` },
        { metric: "On-Time %", value: formatPercent(data.on_time_pct) },
      ]
    : [];

  return (
    <div className="space-y-6">
      <BillingTabs />
      <UnavailableBanner show={unavailable} onRetry={() => refetch()} retrying={isLoading} />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {isLoading || !data
          ? Array.from({ length: 5 }).map((_, i) => <Card key={i} className="h-[130px] animate-pulse" />)
          : unavailable
          ? Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="h-[130px]">
                <PanelUnavailable onRetry={() => refetch()} />
              </Card>
            ))
          : kpis.map((k) => <KpiCard key={k.key} kpi={k} source={badge} basis={basis} />)}
      </div>

      {/* Donut + Summary table side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Delivery SLA Split"
          description={`On-time vs late vs overdue · by ${df}`}
          loading={isLoading}
          unavailable={unavailable}
          onRetry={() => refetch()}
          height={340}
          action={<SourceBadge status={badge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={78} outerRadius={125} paddingAngle={2} stroke="none">
                {donut.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip total={donutTotal} hideLabel valueFormatter={(v) => formatNumber(v)} />} />
              <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[22px] font-semibold leading-tight tracking-tight">SLA Summary</h3>
              <SourceBadge status={badge} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Delivery SLA metrics · by {df}</p>
          </div>
          <DataTable
            columns={SUMMARY_COLS}
            data={summaryRows}
            getRowId={(r) => r.metric}
            loading={isLoading}
            zebra
            className="rounded-none border-0"
            emptyTitle="No SLA data"
            emptyMessage="No delivery SLA data for this range."
          />
        </Card>
      </div>
    </div>
  );
}
