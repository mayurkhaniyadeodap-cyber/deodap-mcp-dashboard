import type { BadgeVariant } from "@/components/ui/badge";

/** Bill lifecycle statuses (mirrors the backend `status` enum). */
export type BillStatus = "delivered" | "in_transit" | "pending" | "rto" | "discrepancy";

/** Maps a status to a display label + Badge variant (DeoDap accent colors). */
export const BILL_STATUS_META: Record<BillStatus, { label: string; variant: BadgeVariant }> = {
  delivered: { label: "Delivered", variant: "success" },
  in_transit: { label: "In Transit", variant: "info" },
  pending: { label: "Pending", variant: "warning" },
  rto: { label: "RTO", variant: "danger" },
  discrepancy: { label: "Discrepancy", variant: "purple" },
};

/** All statuses, handy for building filter options. */
export const BILL_STATUSES = Object.keys(BILL_STATUS_META) as BillStatus[];

/** Reconciliation statuses used by the COD page. */
export type ReconStatus = "reconciled" | "partial" | "pending";

export const RECON_STATUS_META: Record<ReconStatus, { label: string; variant: BadgeVariant }> = {
  reconciled: { label: "Reconciled", variant: "success" },
  partial: { label: "Partial", variant: "warning" },
  pending: { label: "Pending", variant: "danger" },
};

/** Discrepancy type + resolution status (Discrepancies page). */
export type DiscrepancyType = "weight" | "zone" | "rate" | "cod";
export const DISCREPANCY_TYPE_META: Record<DiscrepancyType, { label: string; variant: BadgeVariant }> = {
  weight: { label: "Weight", variant: "purple" },
  zone: { label: "Zone", variant: "info" },
  rate: { label: "Rate", variant: "warning" },
  cod: { label: "COD", variant: "primary" },
};

export type DiscrepancyStatus = "open" | "disputed" | "resolved";
export const DISCREPANCY_STATUS_META: Record<DiscrepancyStatus, { label: string; variant: BadgeVariant }> = {
  open: { label: "Open", variant: "danger" },
  disputed: { label: "Disputed", variant: "warning" },
  resolved: { label: "Resolved", variant: "success" },
};

/** Courier API connection status (Configuration page). */
export type ApiStatus = "connected" | "degraded" | "disconnected";
export const API_STATUS_META: Record<ApiStatus, { label: string; variant: BadgeVariant }> = {
  connected: { label: "Connected", variant: "success" },
  degraded: { label: "Degraded", variant: "warning" },
  disconnected: { label: "Disconnected", variant: "danger" },
};
