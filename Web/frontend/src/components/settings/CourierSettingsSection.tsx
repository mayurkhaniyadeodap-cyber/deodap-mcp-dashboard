import { SourceBadge } from "@/components/shared/SourceBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCouriers } from "@/services/couriers.service";
import { useSourceMeta } from "@/services/meta.service";

/**
 * Courier roster (read-only) — reads the LIVE /api/couriers data, the same
 * source the Courier Comparison page uses, so there is ONE source of truth for
 * names + codes (no hardcoded settings.json copy to drift out of sync).
 */
export function CourierSettingsSection() {
  const { data: couriers, isLoading } = useCouriers();
  const badge = useSourceMeta().data?.couriers?.comparison;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Courier Roster</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Live couriers — same source as Courier Comparison.
          </p>
        </div>
        <SourceBadge status={badge} />
      </CardHeader>
      <CardContent>
        {isLoading || !couriers ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {couriers.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="grid size-8 place-items-center rounded-md bg-muted text-xs font-semibold">{c.code}</span>
                <span className="text-sm font-medium">{c.name}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
