/**
 * ONE source of truth for date provenance across every page: the PROVENANCE label
 * ("Order date · Last 30 days", "Reconciliation date · Last 30 days").
 */
import { type DatePreset } from "@/store/dateRange.store";
import { formatDateIST } from "@/utils/format";

/** Human labels for each MCP date_field a panel can be filtered on. */
export const DATE_FIELD_LABEL: Record<string, string> = {
  order_date: "Order date",
  reconciliation_at: "Reconciliation date",
  delivered_date: "Delivered date",
  dispatched_at: "Dispatch date",
  edd: "Promised EDD",
};

export function windowLabel(preset: DatePreset, from: string, to: string): string {
  switch (preset) {
    case "today":
      return "Today (partial)";
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "mtd":
      return "Month to date";
    case "ytd":
      return "Year to date";
    default:
      return `${formatDateIST(from)} – ${formatDateIST(to)}`;
  }
}

/** "<date_field> · <window>" — the provenance line for one panel. */
export function basisLabel(dateField: string, preset: DatePreset, from: string, to: string): string {
  return `${DATE_FIELD_LABEL[dateField] ?? "Order date"} · ${windowLabel(preset, from, to)}`;
}
