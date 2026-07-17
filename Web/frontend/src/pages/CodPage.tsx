import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageError } from "@/components/shared/PageError";
import { BillingTabs } from "@/components/shared/PageTabs";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Card } from "@/components/ui/card";
import { useCod } from "@/services/cod.service";
import { useDateRange } from "@/store/dateRange.store";
import { CHART_AXIS, CHART_COLORS } from "@/config/chart";
import type { CodCourier } from "@/types/api";
import { formatCurrencyINR, formatCurrencyINRCompact, formatNumber } from "@/utils/format";
import { basisLabel } from "@/utils/provenance";

const COLUMNS: Column<CodCourier>[] = [
  { key: "courier", header: "Courier", cell: (r) => <span className="font-medium">{r.courier}</span> },
  { key: "orders", header: "Orders", align: "right", cell: (r) => <span className="tabular-nums">{formatNumber(r.orders)}</span> },
  { key: "cod_value", header: "COD Value", align: "right", cell: (r) => <span className="font-medium tabular-nums">{formatCurrencyINR(r.cod_value)}</span> },
];

export default function CodPage() {
  const { data, isLoading, isError, refetch } = useCod();
  if (isError) return <PageError onRetry={() => refetch()} />;

  // Provenance drives the badges and flips to Sample automatically on MCP fallback.
  const badge = data?.source === "live" ? "live" : "sample";
  const df = data?.date_field ?? "order_date";
  const { preset, from, to } = useDateRange();
  const byCourier = data?.reconciliation ?? [];
  const weekly = data?.weekly ?? [];

  return (
    <div className="space-y-6">
      <BillingTabs />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading || !data
          ? Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-[130px] animate-pulse" />)
          : data.kpis.map((k) => (
              <KpiCard key={k.key} kpi={k} source={badge} basis={basisLabel(df, preset, from, to)} />
            ))}
      </div>

      {/* Two charts side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="COD Collection vs Remittance"
          description={`Weekly · by ${df} · remittance lags a few days (recent weeks read low)`}
          loading={isLoading}
          height={320}
          action={<SourceBadge status={badge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly} margin={{ left: 8, right: 8, top: 8 }} barGap={4}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="week" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={64} />
              <Tooltip cursor={{ fill: "#ffffff08" }} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="collected" name="COD Value (collected)" fill={CHART_COLORS.green} radius={[4, 4, 0, 0]} />
              <Bar dataKey="remitted" name="COD Remitted" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="COD value by courier"
          description={`COD value booked per courier · by ${df}`}
          loading={isLoading}
          height={320}
          action={<SourceBadge status={badge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byCourier} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} horizontal={false} />
              <XAxis type="number" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} />
              <YAxis type="category" dataKey="courier" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} width={84} />
              <Tooltip cursor={{ fill: "#ffffff08" }} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Bar dataKey="cod_value" name="COD Value" fill={CHART_COLORS.amber} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Detail table */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            COD by Courier
          </h2>
          <SourceBadge status={badge} />
        </div>
        <DataTable columns={COLUMNS} data={byCourier} getRowId={(r) => r.courier} loading={isLoading} />
      </div>
    </div>
  );
}
