import type { TrendResponse } from "@/types/api";

export interface MonthlyBilledPoint {
  /** Month label; a partial (still-arriving) month is suffixed with "*". */
  label: string;
  /** Sum of per-courier billing; null for a month that FAILED to load (a gap, never 0). */
  billed: number | null;
}

/** Total courier billing per month from /api/trend's per-courier `by_month` pivot. */
export function monthlyBilled(data: TrendResponse | undefined): MonthlyBilledPoint[] {
  const partial = new Set(data?.partial_months ?? []);
  const failed = new Set(data?.failed_months ?? []);
  const couriers = data?.couriers ?? [];
  return (data?.by_month ?? []).map((row) => {
    const month = String(row.month ?? "");
    const billed = failed.has(month)
      ? null
      : couriers.reduce((sum, c) => sum + (typeof row[c] === "number" ? (row[c] as number) : 0), 0);
    return { label: partial.has(month) ? `${month}*` : month, billed };
  });
}
