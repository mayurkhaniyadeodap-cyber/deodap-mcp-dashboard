import { CheckCircle2 } from "lucide-react";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { PageError } from "@/components/shared/PageError";
import { BillingTabs } from "@/components/shared/PageTabs";
import { SearchInput } from "@/components/shared/SearchInput";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Card } from "@/components/ui/card";
import { useTable } from "@/hooks/useTable";
import { useCouriers } from "@/services/couriers.service";
import { useReconciliation } from "@/services/discrepancies.service";
import { type SourceStatus, useSourceMeta } from "@/services/meta.service";
import { UnavailableBanner } from "@/components/shared/Unavailable";
import type { Courier, RateDispute, ReconciledCourier, WeightDispute } from "@/types/api";
import { formatCurrencyINR, formatNumber, formatPercent } from "@/utils/format";
import { badgeFromSource } from "@/utils/source";

const money = (v: number) => <span className="tabular-nums">{formatCurrencyINR(v)}</span>;
const awbCell = (v: string) => <span className="font-mono text-xs">{v}</span>;

const kg = (v: number) => <span className="tabular-nums">{v.toFixed(2)} kg</span>;
function rtoColor(rate: number): string {
  if (rate >= 10) return "#ef4444";
  if (rate >= 5) return "#f59e0b";
  return "#10b981";
}

type W = WeightDispute & Record<string, unknown>;
type R = RateDispute & Record<string, unknown>;
type Rto = Courier & Record<string, unknown>;

const WEIGHT_COLS: Column<W>[] = [
  { key: "courier", header: "Courier", sortable: true, cell: (r) => <span className="font-medium">{r.courier}</span> },
  { key: "awb", header: "AWB", sortable: true, cell: (r) => awbCell(r.awb) },
  { key: "expected_weight_kg", header: "Expected Weight", sortable: true, align: "right", cell: (r) => kg(r.expected_weight_kg) },
  { key: "billed_weight_kg", header: "Billed Weight", sortable: true, align: "right", cell: (r) => kg(r.billed_weight_kg) },
  { key: "weight_diff_kg", header: "Weight Difference", sortable: true, align: "right", cell: (r) => <span className="tabular-nums text-destructive">{r.weight_diff_kg.toFixed(2)} kg</span> },
];
const RATE_COLS: Column<R>[] = [
  { key: "courier", header: "Courier", sortable: true, cell: (r) => <span className="font-medium">{r.courier}</span> },
  { key: "awb", header: "AWB", sortable: true, cell: (r) => awbCell(r.awb) },
  { key: "applied_rate", header: "Applied Rate", sortable: true, align: "right", cell: (r) => money(r.applied_rate) },
  { key: "invoiced_rate", header: "Invoice Rate", sortable: true, align: "right", cell: (r) => money(r.invoiced_rate) },
  { key: "rate_diff", header: "Rate Difference", sortable: true, align: "right", cell: (r) => <span className="font-medium tabular-nums text-destructive">{formatCurrencyINR(r.rate_diff)}</span> },
];
const RTO_COLS: Column<Rto>[] = [
  { key: "name", header: "Courier", sortable: true, cell: (r) => <span className="font-medium">{r.name}</span> },
  { key: "rto_pct", header: "RTO %", sortable: true, align: "right", cell: (r) => <span className="tabular-nums font-medium" style={{ color: rtoColor(r.rto_pct) }}>{formatPercent(r.rto_pct)}</span> },
  { key: "rto", header: "RTO Cost", sortable: true, align: "right", cell: (r) => money(r.rto) },
  { key: "shipments", header: "Shipment Count", sortable: true, align: "right", cell: (r) => <span className="tabular-nums">{formatNumber(r.shipments)}</span> },
];

export default function DiscrepanciesPage() {
  const recon = useReconciliation();
  const couriers = useCouriers();
  const comparisonSrc = useSourceMeta().data?.couriers?.comparison;
  const reconSrc = badgeFromSource(recon.data?.source);
  const reconUnavailable = recon.data?.source === "unavailable";

  // Section datasets (live). Each table keeps its own search / sort / pagination.
  const weight = useTable<W>({ data: (recon.data?.weight_disputes ?? []) as W[], searchKeys: ["awb", "courier"], initialSort: { key: "weight_diff_kg", dir: "desc" }, pageSize: 10 });
  // Overcharging Alerts = only rows where the courier invoiced MORE than we applied.
  const rateData = (recon.data?.rate_disputes ?? []).filter((r) => r.invoiced_rate > r.applied_rate) as R[];
  const rate = useTable<R>({ data: rateData, searchKeys: ["awb", "courier"], initialSort: { key: "rate_diff", dir: "desc" }, pageSize: 10 });
  // Reconciled couriers — same live source (reconciliation_summary status=Reconciled),
  // rendered as a compact summary card (see ReconciledSummaryCard) instead of a table.
  const reconciledCouriers = recon.data?.reconciled ?? [];
  const rto = useTable<Rto>({ data: (couriers.data ?? []) as Rto[], searchKeys: ["name"], initialSort: { key: "rto_pct", dir: "desc" }, pageSize: 10 });

  if (recon.isError && couriers.isError) {
    return <PageError onRetry={() => { recon.refetch(); couriers.refetch(); }} />;
  }

  return (
    <div className="space-y-6">
      <BillingTabs />
      <UnavailableBanner show={reconUnavailable} onRetry={() => recon.refetch()} retrying={recon.isFetching} />

      {/* 1. Weight Discrepancies — reconciliation_disputes (weight_status=Mismatched) */}
      <Section
        title="Weight Discrepancies"
        subtitle={recon.data ? `Top ${recon.data.weight_disputes.length} of ${formatNumber(recon.data.weight_total)} weight mismatches · by weight difference` : "Weight-mismatched shipments"}
        badge={reconSrc}
        search={weight}
      >
        <DataTable columns={WEIGHT_COLS} data={weight.rows} getRowId={(r) => r.awb} loading={recon.isLoading} sort={weight.sort} onSortChange={weight.setSort} zebra className="rounded-none border-0" emptyTitle="No weight disputes" emptyMessage="No weight mismatches for this range." />
      </Section>

      {/* 2. Overcharging Alerts — reconciliation_disputes (rate_status=Mismatched) */}
      <Section
        title="Overcharging Alerts"
        subtitle={recon.data ? `Top ${recon.data.rate_disputes.length} of ${formatNumber(recon.data.rate_total)} rate mismatches · invoiced above applied` : "Rate-mismatched shipments"}
        badge={reconSrc}
        search={rate}
      >
        <DataTable columns={RATE_COLS} data={rate.rows} getRowId={(r) => r.awb} loading={recon.isLoading} sort={rate.sort} onSortChange={rate.setSort} zebra className="rounded-none border-0" emptyTitle="No overcharges" emptyMessage="No rate mismatches for this range." />
      </Section>

      {/* 3. Reconciled Successfully — reconciliation_summary (status=Reconciled).
          Compact summary card (one row per reconciled courier) instead of a table. */}
      <ReconciledSummaryCard data={reconciledCouriers} badge={reconSrc} loading={recon.isLoading} />

      {/* 4. RTO Analysis — rto_analysis (RTO% + shipments) + shipping_cost_summary (RTO cost) */}
      <Section
        title="RTO Analysis"
        subtitle="Return-to-origin rate, cost, and volume per courier"
        badge={comparisonSrc}
        search={rto}
        searchPlaceholder="Search courier…"
      >
        <DataTable columns={RTO_COLS} data={rto.rows} getRowId={(r) => r.id} loading={couriers.isLoading} sort={rto.sort} onSortChange={rto.setSort} zebra className="rounded-none border-0" emptyTitle="No couriers" emptyMessage="No courier data for this range." />
      </Section>
    </div>
  );
}

/** Shared section shell — title, LIVE/Sample badge, optional search, then the table. */
function Section({
  title,
  subtitle,
  badge,
  search,
  searchPlaceholder = "Search AWB or courier…",
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: SourceStatus;
  search?: { search: string; setSearch: (v: string) => void };
  searchPlaceholder?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h3>
          <SourceBadge status={badge} />
          {search && <SearchInput value={search.search} onChange={search.setSearch} placeholder={searchPlaceholder} className="w-full sm:w-56" />}
        </div>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </Card>
  );
}

/** Compact "Reconciled Successfully" card — one row per successfully reconciled
 *  courier. Same live data as before (reconciliation_summary status=Reconciled); the
 *  courier count is derived from the data length (never hardcoded). */
function ReconciledSummaryCard({
  data,
  badge,
  loading,
}: {
  data: ReconciledCourier[];
  badge?: SourceStatus;
  loading: boolean;
}) {
  const count = data.length;
  return (
    <Card className="overflow-hidden">
      {/* Header: title + LIVE badge (left), dynamic courier count (right) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[22px] font-semibold leading-tight tracking-tight">Reconciled Successfully</h3>
          <SourceBadge status={badge} />
        </div>
        {!loading && count > 0 && (
          <span className="inline-flex items-center rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
            {count} {count === 1 ? "Courier" : "Couriers"}
          </span>
        )}
      </div>

      {/* Body: one compact row per reconciled courier */}
      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      ) : count === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No reconciled lines for this range.</div>
      ) : (
        <ul className="divide-y divide-border/60">
          {data.map((c) => (
            <li
              key={c.courier}
              className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
            >
              <span className="truncate text-sm font-medium">{c.courier}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-success">
                <CheckCircle2 className="size-4" /> Matched
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
