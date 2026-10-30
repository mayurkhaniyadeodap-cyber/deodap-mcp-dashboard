import { PiggyBank } from "lucide-react";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { PanelUnavailable } from "@/components/shared/Unavailable";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SavingsResponse } from "@/types/api";
import { formatCurrencyINR, formatCurrencyINRShort, formatNumber } from "@/utils/format";
import { badgeFromSource } from "@/utils/source";

interface Props {
  data: SavingsResponse | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  basis: string;
  className?: string;
}

/**
 * "Savings Identified" — applied rate vs the cheapest serviceable courier, from a
 * pincode_serviceability SAMPLE (GET /api/savings-opportunity). Shown as an insight
 * panel because it is sampled, not a population total like the KPI row.
 */
export function SavingsInsightCard({ data, loading, failed, onRetry, basis, className }: Props) {
  const unavailable = failed || data?.source === "unavailable";
  const source = failed ? "unavailable" : badgeFromSource(data?.source);

  return (
    <Card className={`flex min-w-0 flex-col rounded-xl p-4 animate-fade-up ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="grid size-9 place-items-center rounded-lg bg-success/15 text-success">
            <PiggyBank className="size-[18px]" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold leading-tight tracking-tight">Savings Identified</h3>
            <p className="text-xs text-muted-foreground">Applied vs cheapest serviceable courier</p>
          </div>
        </div>
        <SourceBadge status={source} />
      </div>

      <div className="mt-5 flex-1">
        {loading || (!data && !failed) ? (
          <div aria-busy="true">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="mt-2 h-4 w-28" />
            <p className="mt-4 text-xs text-muted-foreground">Sampling courier serviceability (first load can take ~30s)…</p>
          </div>
        ) : unavailable ? (
          <PanelUnavailable onRetry={onRetry} className="min-h-[180px]" />
        ) : data ? (
          <>
            <div className="text-[32px] font-bold leading-none tracking-tight tabular-nums" title={formatCurrencyINR(data.total_saving)}>
              {formatCurrencyINRShort(data.total_saving)}
            </div>
            <div className="mt-1.5 text-xs font-medium tabular-nums text-muted-foreground">{formatCurrencyINR(data.total_saving)}</div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">AWBs sampled</dt>
                <dd className="mt-1 font-semibold tabular-nums">{formatNumber(data.sampled)}</dd>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">With a saving</dt>
                <dd className="mt-1 font-semibold tabular-nums">{formatNumber(data.rows.filter((r) => r.saving > 0).length)}</dd>
              </div>
            </dl>
            {data.note ? <p className="mt-4 text-xs leading-snug text-muted-foreground">{data.note}</p> : null}
          </>
        ) : null}
      </div>

      <div className="mt-4 border-t border-border/70 pt-3 text-[11px] font-medium text-muted-foreground">
        <span className="block truncate">{basis} · sampled, not a population total</span>
      </div>
    </Card>
  );
}
