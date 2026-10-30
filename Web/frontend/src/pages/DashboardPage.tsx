import { CostBreakdownCard } from "@/components/dashboard/CostBreakdownCard";
import { CourierCostCard } from "@/components/dashboard/CourierCostCard";
import { DataStatusLegend } from "@/components/dashboard/DataStatusLegend";
import { RecentShipments } from "@/components/dashboard/RecentShipments";
import { SavingsInsightCard } from "@/components/dashboard/SavingsInsightCard";
import { ShipmentDistributionCard } from "@/components/dashboard/ShipmentDistributionCard";
import { StateCostCard } from "@/components/dashboard/StateCostCard";
import { TrendCard } from "@/components/dashboard/TrendCard";
import { CourierBillsTable } from "@/components/shared/CourierBillsTable";
import { KpiCard, KpiCardSkeleton, KpiCardUnavailable } from "@/components/shared/KpiCard";
import { UnavailableBanner } from "@/components/shared/Unavailable";
import { useCouriers } from "@/services/couriers.service";
import {
  useDashboard,
  useDashboardCourierBilling,
  useDashboardRateDiff,
  useKpiTrends,
} from "@/services/dashboard.service";
import { useSavingsOpportunity } from "@/services/discrepancies.service";
import { useTrend } from "@/services/trend.service";
import { useDateRange } from "@/store/dateRange.store";
import type { Kpi } from "@/types/api";
import { basisLabel } from "@/utils/provenance";
import { badgeFromSource } from "@/utils/source";

// The four fast KPIs served by /api/dashboard, in display order (labels are used for
// their loading/unavailable states, before the response — which carries its own
// labels — has arrived).
const BASE_KPIS = [
  { key: "total_billing", label: "Total Billed Amount" },
  { key: "total_shipments", label: "Total Shipments" },
  { key: "average_cost", label: "Avg Cost/Shipment" },
  { key: "total_cod", label: "COD Remittance" },
] as const;

const KPI_HINTS: Record<string, string> = {
  total_billing: "Forward + RTO courier cost for orders booked in the selected range.",
  total_shipments: "Orders booked in the selected range.",
  average_cost: "Total billed amount ÷ shipments for the range.",
  total_cod: "COD actually remitted by couriers. Remittance lags delivery by a few days.",
  pending_recon: "Rate difference (invoiced − applied) on lines not yet reconciled. Recent ranges rise as invoices post.",
};

/** A KPI built on the client from a dedicated endpoint (no delta: none is served). */
function soloKpi(key: string, label: string, value: number, unavailable: boolean, subtitle?: string): Kpi {
  return { key, label, value, format: "currency", delta: 0, delta_tone: "neutral", has_delta: false, unavailable, subtitle };
}

export default function DashboardPage() {
  const dash = useDashboard();
  const couriers = useCouriers();
  const pendingRecon = useDashboardRateDiff();
  const billing = useDashboardCourierBilling();
  const savings = useSavingsOpportunity();
  const trend = useTrend();
  const kpiTrends = useKpiTrends();
  const { preset, from, to } = useDateRange();

  const data = dash.data;
  // A failed request and an "unavailable" response are the same honest state for the
  // panels: no numbers, a Retry. The rest of the dashboard keeps working.
  const dashDown = dash.isError || data?.source === "unavailable";
  const dashBadge = dash.isError ? "unavailable" : badgeFromSource(data?.source);
  const retryDash = () => void dash.refetch();
  const basisLine = (dateField: string) => basisLabel(dateField, preset, from, to);
  // KPI sparklines: real values per equal period of the selected range.
  const series = kpiTrends.data?.source === "live" ? kpiTrends.data.series : undefined;
  const periods = kpiTrends.data?.buckets.length ?? 0;
  const sparkProps = (key: string) => ({
    trend: series?.[key],
    trendLabel: periods ? `Trend across ${periods} equal periods of the selected range` : undefined,
    trendLoading: kpiTrends.isLoading,
    trendNote:
      kpiTrends.isError || kpiTrends.data?.source === "unavailable"
        ? "Trend unavailable right now"
        : periods === 0 && kpiTrends.data
          ? "Pick 2+ days to see a trend"
          : undefined,
  });

  return (
    <div className="space-y-5">
      <UnavailableBanner show={dashDown} onRetry={retryDash} retrying={dash.isFetching} />

      {/* Five KPIs. Each tile loads, fails and retries on its own. */}
      <section aria-label="Key metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1500px]:grid-cols-5">
        {dash.isLoading || (!data && !dash.isError)
          ? BASE_KPIS.map((k, i) => <KpiCardSkeleton key={k.key} kpiKey={k.key} label={k.label} index={i} />)
          : dashDown || !data
            ? BASE_KPIS.map((k, i) => (
                <KpiCardUnavailable key={k.key} kpiKey={k.key} label={k.label} onRetry={retryDash} retrying={dash.isFetching} index={i} />
              ))
            : data.kpis.map((kpi, i) => (
                <KpiCard
                  key={kpi.key}
                  kpi={kpi}
                  source={dashBadge}
                  basis={basisLine(data.date_field)}
                  hint={KPI_HINTS[kpi.key]}
                  {...sparkProps(kpi.key)}
                  updatedAt={dash.dataUpdatedAt}
                  index={i}
                />
              ))}

        {/* Pending Reconciliation — live ₹ rate difference (invoiced − applied) on
            unreconciled lines, /dashboard/rate-diff. amount > 0 → "Action Needed";
            0 → "No Pending Reconciliation"; N/A whenever the value is not live. */}
        {pendingRecon.isError ? (
          <KpiCardUnavailable kpiKey="pending_recon" label="Pending Reconciliation" onRetry={() => void pendingRecon.refetch()} retrying={pendingRecon.isFetching} index={4} />
        ) : pendingRecon.isLoading || !pendingRecon.data ? (
          <KpiCardSkeleton kpiKey="pending_recon" label="Pending Reconciliation" index={4} />
        ) : (
          <KpiCard
            kpi={soloKpi(
              "pending_recon",
              "Pending Reconciliation",
              pendingRecon.data.kpi.value,
              pendingRecon.data.source !== "live",
              // Maturity comes from the date, not from MCP data.
              pendingRecon.data.maturing ? "Recent window — still reconciling; figure will rise as data matures" : undefined,
            )}
            source={badgeFromSource(pendingRecon.data.source)}
            basis={basisLine(pendingRecon.data.date_field)}
            hint={KPI_HINTS.pending_recon}
            {...sparkProps("pending_recon")}
            updatedAt={pendingRecon.dataUpdatedAt}
            index={4}
          />
        )}
      </section>

      {/* Main analytics. */}
      <section aria-label="Cost and distribution" className="grid grid-cols-1 gap-4 lg:grid-cols-2 min-[1500px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <CourierCostCard
          couriers={couriers.data}
          loading={couriers.isLoading}
          unavailable={couriers.isError || dashDown}
          onRetry={() => void couriers.refetch()}
          source={couriers.isError ? "unavailable" : dashBadge}
          updatedAt={couriers.dataUpdatedAt}
          className="lg:col-span-2 min-[1500px]:col-span-1"
        />
        <ShipmentDistributionCard
          distribution={data?.distribution}
          loading={dash.isLoading}
          unavailable={dashDown}
          onRetry={retryDash}
          source={dashBadge}
          updatedAt={dash.dataUpdatedAt}
        />
        <StateCostCard
          rows={data?.state_cost}
          loading={dash.isLoading}
          unavailable={dashDown}
          onRetry={retryDash}
          source={dashBadge}
          updatedAt={dash.dataUpdatedAt}
        />
      </section>

      {/* Trend + recent shipments. */}
      <section aria-label="Trend and shipments" className="grid grid-cols-1 gap-4 min-[1500px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <TrendCard
          data={trend.data}
          loading={trend.isLoading}
          failed={trend.isError}
          onRetry={() => void trend.refetch()}
          updatedAt={trend.dataUpdatedAt}
        />
        <RecentShipments />
      </section>

      <DataStatusLegend updatedAt={dash.dataUpdatedAt || undefined} />

      {/* Cost detail: sampled forward-cost breakdown + sampled savings. */}
      <section aria-label="Cost detail" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <CostBreakdownCard
          data={billing.data}
          loading={billing.isLoading}
          failed={billing.isError}
          onRetry={() => void billing.refetch()}
          className="xl:col-span-2"
        />
        <SavingsInsightCard
          data={savings.data}
          loading={savings.isLoading}
          failed={savings.isError}
          onRetry={() => void savings.refetch()}
          basis={basisLine("order_date")}
        />
      </section>

      {/* Per-courier billing detail. */}
      <CourierBillsTable data={couriers.data ?? []} loading={couriers.isLoading} source={couriers.isError ? "unavailable" : dashBadge} />
    </div>
  );
}
