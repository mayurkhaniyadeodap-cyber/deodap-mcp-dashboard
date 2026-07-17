import { AlertTriangle, CheckCircle2, PackageX, RotateCcw, TrendingDown } from "lucide-react";
import { AccentPanel, PanelRow } from "@/components/shared/AccentPanel";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { PageError } from "@/components/shared/PageError";
import { BillingTabs } from "@/components/shared/PageTabs";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ACCENT_HEX } from "@/config/tokens";
import { useDiscrepancies, useSavingsOpportunity } from "@/services/discrepancies.service";
import type { CourierRate, SavingRow } from "@/types/api";
import { formatCurrencyINR, formatNumber, formatPercent } from "@/utils/format";

const ORANGE = "#f97316";

function rtoColor(rate: number): string {
  if (rate > 8) return ACCENT_HEX.red;
  if (rate > 5) return ACCENT_HEX.amber;
  return ACCENT_HEX.green;
}

const SAVINGS_COLUMNS: Column<SavingRow>[] = [
  { key: "awb", header: "AWB", cell: (r) => <span className="font-medium">{r.awb}</span> },
  { key: "courier_used", header: "Courier Used", cell: (r) => r.courier_used },
  { key: "applied", header: "Applied", align: "right", cell: (r) => formatCurrencyINR(r.applied) },
  { key: "cheapest_courier", header: "Cheapest", cell: (r) => r.cheapest_courier },
  { key: "cheapest_rate", header: "Cheapest ₹", align: "right", cell: (r) => formatCurrencyINR(r.cheapest_rate) },
  {
    key: "saving",
    header: "Saving",
    align: "right",
    cell: (r) => <span className={r.saving > 0 ? "font-semibold text-success" : "text-muted-foreground"}>{formatCurrencyINR(r.saving)}</span>,
  },
  {
    key: "cheapest_rto_pct",
    header: "Cheapest RTO %",
    align: "right",
    cell: (r) => <span style={{ color: rtoColor(r.cheapest_rto_pct) }} className="tabular-nums">{formatPercent(r.cheapest_rto_pct)}</span>,
  },
];

export default function DiscrepanciesPage() {
  const { data, isLoading, isError, refetch } = useDiscrepancies();
  const savings = useSavingsOpportunity();
  if (isError) return <PageError onRetry={() => refetch()} />;

  const badge = data?.source === "live" ? "live" : "sample";
  const rd = data?.rate_diff;
  const rto = data?.rto ?? [];
  const ndr = data?.ndr ?? [];
  const avgRto = rto.length ? rto.reduce((s, r) => s + r.rate_pct, 0) / rto.length : 0;

  return (
    <div className="space-y-6">
      <BillingTabs />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-64 animate-pulse rounded-lg bg-card" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Rate Difference — invoiced vs applied (aggregate, dispute path) */}
          <AccentPanel color={ACCENT_HEX.red} icon={AlertTriangle} title="Rate Difference" badge={`${formatNumber(rd?.reconciliation_lines ?? 0)} lines`} source={badge}>
            <PanelRow left="Forward rate diff (to investigate)" value={formatCurrencyINR(rd?.fwd_rate_diff ?? 0)} valueStyle={{ color: ACCENT_HEX.red }} />
            <PanelRow left="Weight-overcharged lines" value={formatNumber(rd?.weight_overcharged ?? 0)} />
            <PanelRow left="Extra weight" value={`${formatNumber(Math.round(rd?.weight_diff_kg ?? 0))} kg`} />
            <PanelRow left="Basis" sub="invoiced vs applied · reconciliation_at · lags a few days" value="" />
          </AccentPanel>

          {/* Reconciliation status — "Disputed" is really PENDING (resolves as lines age) */}
          <AccentPanel color={ACCENT_HEX.blue} icon={CheckCircle2} title="Reconciliation Status" badge={rd?.has_recon ? "live" : "no data"} source={badge}>
            <PanelRow left="Reconciled" sub="lines" value={formatNumber(rd?.reconciled ?? 0)} valueStyle={{ color: ACCENT_HEX.green }} />
            <PanelRow left="Pending reconciliation" sub="lines (labelled 'Disputed' upstream)" value={formatNumber(rd?.disputed ?? 0)} valueStyle={{ color: ACCENT_HEX.amber }} />
            <PanelRow left="Note" sub="resolves as lines age: recent ~71% pending → older months ~16%" value="" />
          </AccentPanel>

          {/* RTO per courier — order_date basis, but an OUTCOME that lags */}
          <AccentPanel color={ORANGE} icon={RotateCcw} title="RTO Analysis" badge={`${formatPercent(avgRto)} avg`} source={badge}>
            {rto.map((c: CourierRate) => (
              <PanelRow key={c.courier} left={c.courier} value={formatPercent(c.rate_pct)} valueStyle={{ color: rtoColor(c.rate_pct) }} />
            ))}
            <PanelRow left="Basis" sub="order_date · returns post days later (lags)" value="" />
          </AccentPanel>

          {/* NDR per courier — order_date basis, but an OUTCOME that lags */}
          <AccentPanel color={ACCENT_HEX.purple} icon={PackageX} title="NDR Analysis" badge={`${formatNumber(data?.ndr_orders ?? 0)} NDRs`} source={badge}>
            {ndr.map((c: CourierRate) => (
              <PanelRow key={c.courier} left={c.courier} value={formatPercent(c.rate_pct)} valueStyle={{ color: rtoColor(c.rate_pct) }} />
            ))}
            <PanelRow left="Basis" sub="order_date · NDRs post days later (lags)" value="" />
          </AccentPanel>
        </div>
      )}

      {/* Savings Opportunity — separate slow endpoint, own skeleton */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown className="size-4 text-success" />
            <h3 className="font-semibold tracking-tight">Savings Opportunity — cheapest serviceable vs courier used</h3>
            <SourceBadge status={savings.data?.source === "live" ? "live" : "sample"} />
          </div>
          {savings.data && (
            <div className="text-sm text-muted-foreground">
              Sampled saving <span className="font-semibold text-success">{formatCurrencyINR(savings.data.total_saving)}</span> · {savings.data.sampled} AWBs
              {savings.data.skipped > 0 && ` · ${savings.data.skipped} skipped`}
            </div>
          )}
        </div>
        <p className="border-b border-border bg-background/40 px-4 py-2 text-xs text-muted-foreground">
          Theoretical maximum — ignores SLA, capacity &amp; routing rules. Cheapest ≠ better overall, so the cheapest courier's RTO% is shown. Sampled figure only (not extrapolated).
        </p>
        {/* Temporal-mix caveat: this panel compares TWO points in time. */}
        <p className="flex items-start gap-1.5 border-b border-border bg-warning/[0.06] px-4 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            Mixed time basis: each order's <span className="font-medium">historical</span> applied rate (list_orders · order_date) is compared against <span className="font-medium">today's</span> rate card (pincode_serviceability has no date basis). If the rate card changed since those orders shipped, the saving is an estimate against current pricing, not what was actually quoted then.
          </span>
        </p>
        {savings.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <p className="pt-1 text-xs text-muted-foreground">Pricing a sample of AWBs live (~30s the first time; cached 30 min)…</p>
          </div>
        ) : (
          <DataTable
            columns={SAVINGS_COLUMNS}
            data={savings.data?.rows ?? []}
            getRowId={(r) => r.awb}
            loading={false}
            className="rounded-none border-0"
            emptyTitle="No savings in sample"
            emptyMessage={savings.isError ? "Savings pricing was unavailable — try again shortly." : "The sampled shipments were already on (or near) the cheapest serviceable courier."}
          />
        )}
      </Card>
    </div>
  );
}
