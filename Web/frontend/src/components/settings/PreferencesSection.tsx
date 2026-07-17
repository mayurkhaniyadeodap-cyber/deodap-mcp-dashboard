import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SettingsResponse } from "@/types/api";

interface Props {
  data: SettingsResponse | undefined;
  isLoading: boolean;
}

/**
 * System preferences — READ-ONLY. Currency (₹ INR), Timezone (IST) and Weight
 * Unit (kg) are hardcoded throughout the app, so they're shown as system info,
 * not editable inputs that change nothing. The old Company Details card (fake
 * entity/GSTIN/address) and the "Discrepancy Threshold" (no engine reads it)
 * were removed rather than left as fabricated inputs.
 */
export function PreferencesSection({ data, isLoading }: Props) {
  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-5">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const rows = [
    { label: "Currency", value: data.preferences.currency, note: "all amounts are formatted in ₹ (INR)" },
    { label: "Timezone", value: data.preferences.timezone, note: "all dates/times are shown in IST" },
    { label: "Weight Unit", value: data.preferences.weight_unit, note: "all weights are in kilograms" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>System Preferences</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Fixed system settings — read-only.
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="text-sm font-medium text-foreground">{r.label}</div>
              <div className="text-xs text-muted-foreground">{r.note}</div>
            </div>
            <span className="rounded-md border border-border bg-accent/40 px-2.5 py-1 text-sm font-medium tabular-nums">
              {r.value}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
