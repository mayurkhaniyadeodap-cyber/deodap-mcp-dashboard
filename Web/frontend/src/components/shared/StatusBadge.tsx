import { Badge } from "@/components/ui/badge";
import {
  BILL_STATUS_META,
  type BillStatus,
  RECON_STATUS_META,
  type ReconStatus,
} from "@/utils/status";

/** Renders a bill status as a colored badge via the shared status map. */
export function BillStatusBadge({ status }: { status: BillStatus }) {
  const meta = BILL_STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** Renders a COD reconciliation status as a colored badge. */
export function ReconStatusBadge({ status }: { status: ReconStatus }) {
  const meta = RECON_STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
