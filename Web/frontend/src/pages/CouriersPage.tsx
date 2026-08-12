import { CalendarDays } from "lucide-react";
import { CourierScorecard } from "@/components/shared/CourierScorecard";
import { Freshness } from "@/components/shared/Freshness";
import { PageError } from "@/components/shared/PageError";
import { BillingTabs } from "@/components/shared/PageTabs";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { PanelUnavailable, UnavailableBanner } from "@/components/shared/Unavailable";
import { Card } from "@/components/ui/card";
import { useCouriers } from "@/services/couriers.service";
import { useSourceMeta } from "@/services/meta.service";
import { useDateRange } from "@/store/dateRange.store";
import { basisLabel } from "@/utils/provenance";

export default function CouriersPage() {
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useCouriers();
  const comparisonSrc = useSourceMeta().data?.couriers?.comparison;
  const { preset, from, to } = useDateRange();
  if (isError) return <PageError onRetry={() => refetch()} />;

  const couriers = [...(data ?? [])].sort((a, b) => b.freight + b.rto - (a.freight + a.rto));
  const maxShipments = Math.max(1, ...couriers.map((c) => c.shipments));
  const totalShipments = couriers.reduce((sum, c) => sum + c.shipments, 0);

  // /api/couriers returns a bare list with NO `source` field, so a Ship MCP outage
  // simply yields an empty list. Treat a resolved-but-empty result as the unavailable
  // state (a live range always has couriers) so the page shows the banner + Retry
  // instead of rendering nothing — the previous behaviour was a blank page. This
  // never fires while loading, and keepPreviousData keeps prior cards during refetch.
  const unavailable = !isLoading && couriers.length === 0;
  const badge = unavailable ? "unavailable" : comparisonSrc;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <BillingTabs />
        <div className="flex items-center gap-3">
          <Freshness updatedAt={dataUpdatedAt} />
          <SourceBadge status={badge} />
        </div>
      </div>

      <UnavailableBanner show={unavailable} onRetry={() => refetch()} retrying={isFetching} />

      {/* Provenance — all courier tools filter on order_date. */}
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <CalendarDays className="size-3 shrink-0" />
        {basisLabel("order_date", preset, from, to)}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => <Card key={i} className="h-[280px] animate-pulse" />)
        ) : unavailable ? (
          <Card className="col-span-full p-0">
            <PanelUnavailable onRetry={() => refetch()} retrying={isFetching} className="min-h-[280px]" />
          </Card>
        ) : (
          couriers.map((c) => (
            <CourierScorecard
              key={c.id}
              courier={c}
              maxShipments={maxShipments}
              totalShipments={totalShipments}
            />
          ))
        )}
      </div>
    </div>
  );
}
