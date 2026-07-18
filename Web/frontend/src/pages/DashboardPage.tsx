import { AlertTriangle } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { CourierBillsTable } from "@/components/shared/CourierBillsTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { courierStyle } from "@/config/couriers";
import { useCouriers } from "@/services/couriers.service";
import { useClaimableRate, useDashboard, useDashboardCourierBilling } from "@/services/dashboard.service";
import { useSavingsOpportunity } from "@/services/discrepancies.service";
import { useDateRange } from "@/store/dateRange.store";
import { CHART_AXIS, CHART_COLORS } from "@/config/chart";
import { formatCurrencyINR, formatCurrencyINRCompact, formatNumber } from "@/utils/format";
import { basisLabel } from "@/utils/provenance";

// Population per-courier cost — Forward + RTO, BOTH from shipping_cost_summary
// (group_by=courier), so they share the same population and the same scale.
const COST_SERIES = [
  { key: "freight", label: "Forward Cost", color: CHART_COLORS.blue },
  { key: "rto", label: "RTO Cost", color: CHART_COLORS.red },
] as const;

// Forward cost BREAKDOWN — sampled from list_orders rate_summary (a different
// population from the cost chart above, so it lives in its own card). Fuel/other
// are always ₹0 and folded into the all-inclusive base freight → never their own
// series (there's no live Fuel source).
const BREAKDOWN_SEGMENTS = [
  { key: "base_freight", label: "Base Freight", color: CHART_COLORS.blue },
  { key: "gst", label: "GST", color: CHART_COLORS.amber },
  { key: "cod_charges", label: "COD Charges", color: CHART_COLORS.green },
] as const;

const OTHERS_COLOR = "#64748b"; // slate — the merged "Others" donut slice

export default function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboard();
  const couriers = useCouriers();
  const claimable = useClaimableRate();
  const billing = useDashboardCourierBilling();
  const savings = useSavingsOpportunity(); // Savings Identified KPI (slow, own skeleton)

  if (isError) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <AlertTriangle className="mx-auto size-8 text-destructive" />
        <p className="mt-3 font-medium">Couldn't load the dashboard</p>
        <button onClick={() => refetch()} className="mt-4 text-sm text-primary hover:underline">Try again</button>
      </Card>
    );
  }

  const badge = data?.source === "live" ? "live" : "sample";

  // Provenance basis line for every KPI: "<date_field> · <window>" (always shown so
  // the active window is unmissable).
  const { preset, from, to } = useDateRange();
  const basisLine = (dateField: string) => basisLabel(dateField, preset, from, to);

  // Population cost per courier (Forward + RTO), sorted by total cost.
  const courierCost = [...(couriers.data ?? [])]
    .map((c) => ({ name: c.name, freight: c.freight, rto: c.rto }))
    .sort((a, b) => b.freight + b.rto - (a.freight + a.rto));

  // Shipment distribution — dedupe by name, then Top 6 couriers + "Others" so the
  // donut and legend stay compact and never scroll.
  const distTop = 6;
  const distMerged = Object.values(
    (data?.distribution ?? []).reduce<Record<string, { name: string; value: number }>>((acc, d) => {
      const name = String(d.name);
      (acc[name] ??= { name, value: 0 }).value += Number(d.value ?? 0);
      return acc;
    }, {}),
  ).sort((a, b) => b.value - a.value);
  const othersValue = distMerged.slice(distTop).reduce((s, d) => s + d.value, 0);
  const distribution =
    othersValue > 0 ? [...distMerged.slice(0, distTop), { name: "Others", value: othersValue }] : distMerged;
  const distTotal = distribution.reduce((s, d) => s + d.value, 0);
  const sliceColor = (name: string) => (name === "Others" ? OTHERS_COLOR : courierStyle(name).color);

  return (
    <div className="space-y-8">
      {/* KPI row — 4 fast KPIs + 2 slow KPIs (Claimable Rate Difference, Savings) each
          fetched from its own endpoint with its own skeleton. */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading || !data
          ? Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-[150px] animate-pulse" />)
          : data.kpis.map((kpi) => (
              <KpiCard key={kpi.key} kpi={kpi} source={badge} basis={basisLine(data.date_field)} />
            ))}
        {/* Claimable Rate Difference — honest recoverable ₹ from reconciliation_disputes
            (rows ≥ ₹50 AND actually priced). Served instantly from a warm background
            refresh: "computing…" before the first run, and the last-good figure with a
            "recalculating" note for a freshly-picked range. Excluded buckets shown so
            nothing disappears (unpriced + sub-threshold noise). */}
        {claimable.isLoading || !claimable.data ? (
          <Card className="h-[150px] animate-pulse" />
        ) : claimable.data.computing ? (
          <Card className="flex h-[150px] flex-col justify-center gap-2 p-5">
            <span className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
              Claimable Rate Difference
            </span>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              Computing… (first calculation in progress)
            </div>
          </Card>
        ) : (
          <KpiCard
            kpi={{
              key: "rate_diff",
              label: "Claimable Rate Difference",
              value: claimable.data.claimable_amount,
              format: "currency",
              delta: 0,
              delta_tone: "neutral",
              has_delta: false,
              subtitle:
                (claimable.data.recalculating ? "Recalculating for this range — showing last computed figure. " : "") +
                `${claimable.data.count.toLocaleString("en-IN")} priced rows ≥ ₹${claimable.data.threshold}. ` +
                `Excluded — unpriced (no applied rate) ${formatCurrencyINRCompact(claimable.data.excluded_no_applied_rate)}` +
                ` · below ₹${claimable.data.threshold} ${formatCurrencyINRCompact(claimable.data.excluded_below_threshold)}`,
            }}
            source={claimable.data.source === "live" ? "live" : "sample"}
            basis={basisLine(claimable.data.date_field)}
          />
        )}
        {/* Savings Identified — applied vs cheapest serviceable (pincode_serviceability sample) */}
        {savings.isLoading || !savings.data ? (
          <Card className="h-[150px] animate-pulse" />
        ) : (
          <KpiCard
            kpi={{
              key: "savings",
              label: "Savings Identified",
              value: savings.data.total_saving,
              format: "currency",
              delta: 0,
              delta_tone: "neutral",
              has_delta: false,
              subtitle: `applied vs cheapest serviceable · sampled ${savings.data.sampled} AWBs`,
            }}
            source={savings.data.source === "live" ? "live" : "sample"}
            basis={basisLine("order_date")}
          />
        )}
      </div>

      {/* Courier cost (population) + distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartCard
          title="Courier-wise Cost"
          description="Population cost per courier · Forward + RTO · shipping_cost_summary (same scale)"
          loading={couriers.isLoading}
          className="lg:col-span-2"
          height={400}
          action={<SourceBadge status={badge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={courierCost} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={60} />
              <Tooltip cursor={{ fill: "#ffffff08" }} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 12 }} />
              {COST_SERIES.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} stackId="cost" fill={s.color} radius={i === COST_SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Shipment Distribution" description="Share of orders by courier" loading={isLoading} height={400} action={<SourceBadge status={badge} />}>
          {/* Legend removed — the donut fills the whole card and stays centered. */}
          <div className="flex h-full items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={90} outerRadius={145} paddingAngle={2} stroke="none">
                  {distribution.map((d) => <Cell key={d.name} fill={sliceColor(d.name)} />)}
                </Pie>
                <Tooltip content={<DonutTooltip total={distTotal} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Courier bills detail */}
      <CourierBillsTable data={couriers.data ?? []} loading={couriers.isLoading} source={badge} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Forward Cost Breakdown — SAMPLED rate_summary (separate population from the
            population cost chart above). Fuel is folded into Base Freight. */}
        <ChartCard
          title="Forward Cost Breakdown"
          description={
            billing.data
              ? `${
                  billing.data.is_full
                    ? `All ${formatNumber(billing.data.sample_size)}`
                    : `Sample of ${formatNumber(billing.data.sample_size)}`
                } shipments · Fuel is included inside Base Freight (all-inclusive zone rate card).`
              : "Sampled forward cost components per courier"
          }
          loading={false}
          height={400}
          action={<SourceBadge status={billing.data?.source === "live" ? "live" : "sample"} />}
        >
          {billing.isLoading ? (
            <div className="flex h-full flex-col justify-end gap-2 px-2 pb-6">
              <Skeleton className="h-[70%] w-full" />
              <p className="text-xs text-muted-foreground">Sampling rate_summary components (~7s)…</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={billing.data?.rows ?? []} margin={{ left: 8, right: 8, top: 8 }}>
                <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
                <XAxis dataKey="courier" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} />
                <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={60} />
                <Tooltip cursor={{ fill: "#ffffff08" }} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
                <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 12 }} />
                {BREAKDOWN_SEGMENTS.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="breakdown" fill={s.color} radius={i === BREAKDOWN_SEGMENTS.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* State cost (replaces the zone panel). Title reflects the actual number of
            states the API returns (backend caps at top-8) — never asserts a count. */}
        <ChartCard
          title={`Top ${data?.state_cost?.length ?? 0} States`}
          description="States ranked by courier cost"
          loading={isLoading}
          height={400}
          action={<SourceBadge status={badge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.state_cost ?? []} margin={{ left: 8, right: 8, top: 24 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="state" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={64} />
              <Tooltip cursor={{ fill: "#ffffff08" }} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Bar dataKey="total_cost" name="Total Cost" fill={CHART_COLORS.cyan} radius={[4, 4, 0, 0]}>
                <LabelList
                  dataKey="total_cost"
                  position="top"
                  formatter={(v: number) => formatCurrencyINRCompact(Number(v))}
                  style={{ fill: CHART_AXIS.tick.fill, fontSize: 11 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

/** Donut tooltip: courier name, plain order count, and share — never currency. */
function DonutTooltip({ active, payload, total }: { active?: boolean; payload?: { name?: string; value?: number }[]; total: number }) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const value = Number(item.value ?? 0);
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
  return (
    <div
      style={{
        background: "#1a2236",
        border: "1px solid #334155",
        borderRadius: 8,
        padding: "8px 12px",
        color: "#f1f5f9",
        fontSize: 12,
        lineHeight: 1.5,
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
      }}
    >
      <div style={{ fontWeight: 600 }}>{String(item.name ?? "")}</div>
      <div>{formatNumber(value)} orders</div>
      <div style={{ color: "#94a3b8" }}>{pct}%</div>
    </div>
  );
}
