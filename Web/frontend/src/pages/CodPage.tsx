import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageError } from "@/components/shared/PageError";
import { BillingTabs } from "@/components/shared/PageTabs";
import { SearchInput } from "@/components/shared/SearchInput";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { PanelUnavailable, UnavailableBanner } from "@/components/shared/Unavailable";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useTable } from "@/hooks/useTable";
import { cn } from "@/lib/utils";
import { useCod, useCodIntelligence, useCodPending } from "@/services/cod.service";
import { useDateRange } from "@/store/dateRange.store";
import { CHART_AXIS, CHART_COLORS } from "@/config/chart";
import type { CodDimensionRow, CodPendingCourier } from "@/types/api";
import { formatCurrencyINR, formatCurrencyINRCompact, formatNumber, formatPercent } from "@/utils/format";
import { basisLabel } from "@/utils/provenance";
import { badgeFromSource } from "@/utils/source";

type Pending = CodPendingCourier & Record<string, unknown>;
const naMoney = (v: number | null | undefined) =>
  v == null ? <span className="text-muted-foreground">N/A</span> : <span className="font-medium tabular-nums">{formatCurrencyINR(v)}</span>;

const COD_STATUS_TONE: Record<string, string> = {
  Settled: "bg-success/15 text-success",
  Pending: "bg-warning/15 text-warning",
  Overdue: "bg-destructive/15 text-destructive",
  Mismatched: "bg-primary/15 text-primary",
};
function CodStatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", COD_STATUS_TONE[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}

const PENDING_COLS: Column<Pending>[] = [
  { key: "courier", header: "Courier", sortable: true, cell: (r) => <span className="font-medium">{r.courier}</span> },
  { key: "cod_shipments", header: "COD Shipments", sortable: true, align: "right", cell: (r) => <span className="tabular-nums">{formatNumber(r.cod_shipments)}</span> },
  { key: "cod_amount", header: "COD Amount", sortable: true, align: "right", cell: (r) => naMoney(r.cod_amount) },
  { key: "remitted", header: "Remitted", sortable: true, align: "right", cell: (r) => <span className="tabular-nums text-success">{formatCurrencyINR(r.remitted)}</span> },
  { key: "pending", header: "Pending", sortable: true, align: "right", cell: (r) => <span className="tabular-nums text-destructive">{formatCurrencyINR(r.pending)}</span> },
  { key: "status", header: "Status", sortable: true, cell: (r) => <CodStatusPill status={r.status} /> },
];

const STATUS_OPTIONS = [
  { label: "All statuses", value: "all" },
  { label: "Pending", value: "Pending" },
  { label: "Settled", value: "Settled" },
  { label: "Overdue", value: "Overdue" },
  { label: "Mismatched", value: "Mismatched" },
];

// COD Intelligence — warehouse/seller dimension table columns (order_analytics).
type DimRow = CodDimensionRow & Record<string, unknown>;
const dimColumns = (groupHeader: string): Column<DimRow>[] => [
  { key: "group", header: groupHeader, cell: (r) => <span className="font-medium">{r.group}</span> },
  { key: "orders", header: "Orders", align: "right", cell: (r) => <span className="tabular-nums">{formatNumber(r.orders)}</span> },
  { key: "cod_value", header: "COD Value", align: "right", cell: (r) => <span className="tabular-nums">{formatCurrencyINR(r.cod_value)}</span> },
  { key: "cod_intensity_pct", header: "COD Intensity", align: "right", cell: (r) => <span className="tabular-nums">{formatPercent(r.cod_intensity_pct)}</span> },
];

export default function CodPage() {
  const { data, isLoading, isError, refetch } = useCod();
  const pending = useCodPending();
  const intel = useCodIntelligence();
  const [statusFilter, setStatusFilter] = useState("all");
  if (isError) return <PageError onRetry={() => refetch()} />;

  // Provenance drives the badges and flips to Unavailable/Sample on fallback.
  const unavailable = data?.source === "unavailable";
  const badge = badgeFromSource(data?.source);
  const pendingBadge = badgeFromSource(pending.data?.source);
  const df = data?.date_field ?? "order_date";
  const { preset, from, to } = useDateRange();
  const weekly = data?.weekly ?? [];

  // --- COD Intelligence (additive) — all live from /api/cod/intelligence. ---
  const intelUnavailable = intel.data?.source === "unavailable";
  const intelBadge = badgeFromSource(intel.data?.source);
  const intelBasis = basisLabel(intel.data?.date_field ?? "order_date", preset, from, to);
  const intelKpis = intel.data?.kpis ?? [];
  // COD vs Prepaid split (orders) → donut. COD amber, Prepaid blue.
  const splitDonut = (intel.data?.payment_split ?? []).map((s) => ({
    name: s.payment_type,
    value: s.orders,
    fill: s.payment_type === "COD" ? CHART_COLORS.amber : CHART_COLORS.blue,
  }));
  const splitTotal = splitDonut.reduce((sum, s) => sum + s.value, 0);

  // Unit economics (COD vs Prepaid) + warehouse/seller COD dimension tables — live.
  const econ = intel.data?.unit_economics ?? [];
  const econCod = econ.find((e) => e.payment_type === "COD");
  const econPrepaid = econ.find((e) => e.payment_type === "Prepaid");
  const econRows =
    econCod && econPrepaid
      ? [
          { metric: "Orders", cod: formatNumber(econCod.orders), prepaid: formatNumber(econPrepaid.orders) },
          { metric: "Avg Order Value", cod: formatCurrencyINR(econCod.avg_order_value), prepaid: formatCurrencyINR(econPrepaid.avg_order_value) },
          { metric: "Avg Shipping Cost / Order", cod: formatCurrencyINR(econCod.avg_shipping_cost), prepaid: formatCurrencyINR(econPrepaid.avg_shipping_cost) },
          { metric: "Forward Cost", cod: formatCurrencyINR(econCod.fwd_cost), prepaid: formatCurrencyINR(econPrepaid.fwd_cost) },
          { metric: "RTO Cost", cod: formatCurrencyINR(econCod.rto_cost), prepaid: formatCurrencyINR(econPrepaid.rto_cost) },
          { metric: "Total Cost", cod: formatCurrencyINR(econCod.total_cost), prepaid: formatCurrencyINR(econPrepaid.total_cost) },
        ]
      : [];
  // Display only: hide warehouses/sellers with no COD activity (cod_value <= 0).
  // The live calculation is unchanged — this filters the rendered rows only.
  const warehouseAll = (intel.data?.warehouse_cod ?? []) as DimRow[];
  const sellerAll = (intel.data?.seller_cod ?? []) as DimRow[];
  const warehouseCod = warehouseAll.filter((r) => r.cod_value > 0);
  const sellerCod = sellerAll.filter((r) => r.cod_value > 0);
  const warehouseHidden = warehouseAll.length - warehouseCod.length;
  const sellerHidden = sellerAll.length - sellerCod.length;

  // COD Pending table — live per-courier aging, with status filter + search + sort + pagination.
  const pendingRows = (pending.data?.rows ?? []) as Pending[];
  const filteredPending = statusFilter === "all" ? pendingRows : pendingRows.filter((r) => r.status === statusFilter);
  const pendingTable = useTable<Pending>({ data: filteredPending, searchKeys: ["courier"], initialSort: { key: "pending", dir: "desc" }, pageSize: 10 });

  return (
    <div className="space-y-6">
      <BillingTabs />
      <UnavailableBanner show={unavailable} onRetry={() => refetch()} retrying={isLoading} />

      {/* ===================== COD Intelligence (live) ===================== */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[22px] font-semibold leading-tight tracking-tight">COD Intelligence</h2>
          <SourceBadge status={intelBadge} />
          <span className="text-sm text-muted-foreground">Live COD behaviour &amp; settlement signals</span>
        </div>

        {/* Intelligence KPI cards — all live from cod/intelligence. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {intel.isLoading || !intel.data
            ? Array.from({ length: 7 }).map((_, i) => <Card key={i} className="h-[130px] animate-pulse" />)
            : intelUnavailable
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="h-[130px]"><PanelUnavailable onRetry={() => intel.refetch()} /></Card>
              ))
            : intelKpis.map((k) => <KpiCard key={k.key} kpi={k} source={intelBadge} basis={intelBasis} />)}
        </div>

        {/* COD vs Prepaid split (order share). */}
        <ChartCard
          title="COD vs Prepaid Mix"
          description={`Order share · by ${intel.data?.date_field ?? "order_date"} · order_analytics(payment_type)`}
          loading={intel.isLoading}
          unavailable={intelUnavailable}
          onRetry={() => intel.refetch()}
          height={320}
          action={<SourceBadge status={intelBadge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={splitDonut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={118} paddingAngle={2} stroke="none">
                {splitDonut.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip total={splitTotal} hideLabel valueFormatter={(v) => formatNumber(v)} />} />
              <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* COD vs Prepaid unit economics (shipping_cost_summary + order_analytics). */}
        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[22px] font-semibold leading-tight tracking-tight">COD vs Prepaid Unit Economics</h3>
              <SourceBadge status={intelBadge} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Per-payment cost &amp; value · shipping_cost_summary(payment_type) + order_analytics(payment_type)
            </p>
          </div>
          {econRows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              {intelUnavailable ? "Unit economics unavailable — MCP unreachable." : "No unit-economics data for this range."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Metric</th>
                    <th className="px-4 py-2.5 text-right font-medium">COD</th>
                    <th className="px-4 py-2.5 text-right font-medium">Prepaid</th>
                  </tr>
                </thead>
                <tbody>
                  {econRows.map((r, i) => (
                    <tr key={r.metric} className={cn("border-b border-border/60", i % 2 === 1 && "bg-muted/30")}>
                      <td className="px-4 py-2.5 font-medium">{r.metric}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: CHART_COLORS.amber }}>{r.cod}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: CHART_COLORS.blue }}>{r.prepaid}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* COD by warehouse + by seller (order_analytics group_by=warehouse|seller). */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <div className="border-b border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-[22px] font-semibold leading-tight tracking-tight">COD by Warehouse</h3>
                <SourceBadge status={intelBadge} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Top warehouses by COD value · order_analytics(warehouse)</p>
            </div>
            <DataTable
              columns={dimColumns("Warehouse")}
              data={warehouseCod}
              getRowId={(r) => r.group}
              loading={intel.isLoading}
              zebra
              className="rounded-none border-0"
              emptyTitle="No warehouse COD data"
              emptyMessage="No COD by warehouse for this range."
            />
            {warehouseHidden > 0 ? (
              <p className="border-t border-border p-3 text-[12px] leading-snug text-muted-foreground">
                Warehouses without COD activity are hidden.
              </p>
            ) : null}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-[22px] font-semibold leading-tight tracking-tight">COD by Seller</h3>
                <SourceBadge status={intelBadge} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Top sellers by COD value · order_analytics(seller)</p>
            </div>
            <DataTable
              columns={dimColumns("Seller")}
              data={sellerCod}
              getRowId={(r) => r.group}
              loading={intel.isLoading}
              zebra
              className="rounded-none border-0"
              emptyTitle="No seller COD data"
              emptyMessage="No COD by seller for this range."
            />
            {sellerHidden > 0 ? (
              <p className="border-t border-border p-3 text-[12px] leading-snug text-muted-foreground">
                Sellers without COD activity are hidden.
              </p>
            ) : null}
          </Card>
        </div>
      </section>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading || !data
          ? Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-[130px] animate-pulse" />)
          : unavailable
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="h-[130px]"><PanelUnavailable onRetry={() => refetch()} /></Card>
            ))
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
          unavailable={unavailable}
          onRetry={() => refetch()}
          height={320}
          action={<SourceBadge status={badge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly} margin={{ left: 8, right: 8, top: 8 }} barGap={4}>
              <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
              <XAxis dataKey="week" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} />
              <YAxis stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} width={96} />
              <Tooltip cursor={{ fill: "#ffffff08" }} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="collected" name="COD Value (collected)" fill={CHART_COLORS.green} radius={[4, 4, 0, 0]} />
              <Bar dataKey="remitted" name="COD Remitted" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="COD Settlement Tracking"
          description="Outstanding remittance per courier · balances include unresolved settlement records, not confirmed receivables"
          loading={pending.isLoading}
          unavailable={pending.data?.source === "unavailable"}
          onRetry={() => pending.refetch()}
          height={320}
          action={<SourceBadge status={pendingBadge} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pendingRows} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke={CHART_AXIS.grid} horizontal={false} />
              <XAxis type="number" stroke={CHART_AXIS.stroke} tick={CHART_AXIS.tick} tickFormatter={(v) => formatCurrencyINRCompact(Number(v))} />
              <YAxis type="category" dataKey="courier" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} width={84} />
              <Tooltip cursor={{ fill: "#ffffff08" }} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
              <Bar dataKey="pending" name="Pending Amount" fill={CHART_COLORS.amber} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* COD Pending by Courier — live per-courier aging (cod_remittance_aging) */}
      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-[22px] font-semibold leading-tight tracking-tight">COD Reconciliation Detail</h3>
            <SourceBadge status={pendingBadge} />
            <SearchInput value={pendingTable.search} onChange={pendingTable.setSearch} placeholder="Search courier…" className="w-full sm:w-56" />
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={STATUS_OPTIONS} className="w-full sm:w-44" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Shipment-level COD tracking</p>
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            Outstanding balances include unresolved settlement records and are not confirmed receivables.
            Aging across 1–14 month windows shows old pending does not reduce (14-month-old COD remains ~95% overdue),
            so these are settlement-record gaps and reconciliation-cycle delays, not cash owed.
          </p>
        </div>
        <DataTable
          columns={PENDING_COLS}
          data={pendingTable.rows}
          getRowId={(r) => r.courier}
          loading={pending.isLoading}
          sort={pendingTable.sort}
          onSortChange={pendingTable.setSort}
          zebra
          className="rounded-none border-0"
          emptyTitle="No COD couriers"
          emptyMessage="No COD remittance data for this range."
        />
      </Card>
    </div>
  );
}
