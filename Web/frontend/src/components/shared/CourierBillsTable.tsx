import { useState } from "react";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { SearchInput } from "@/components/shared/SearchInput";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useTable } from "@/hooks/useTable";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/services/meta.service";
import type { Courier } from "@/types/api";
import { formatCurrencyINR, formatNumber } from "@/utils/format";

const money = (v: number) => <span className="tabular-nums">{formatCurrencyINR(v)}</span>;
const naMoney = (v: number | null | undefined) =>
  v == null ? <span className="text-muted-foreground">N/A</span> : money(v);

// Reconciliation status → coloured pill (live from reconciliation_summary).
// "Unreconciled" = lines still pending reconciliation cycles (the tool's "Disputed"
// bucket is a backlog/lag artifact, not confirmed disputes) → warning, not destructive.
const STATUS_TONE: Record<string, string> = {
  Reconciled: "bg-success/15 text-success",
  Pending: "bg-warning/15 text-warning",
  Unreconciled: "bg-warning/15 text-warning",
};
function ReconStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_TONE[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}

const STATUS_OPTIONS = [
  { label: "All statuses", value: "all" },
  { label: "Reconciled", value: "Reconciled" },
  { label: "Pending", value: "Pending" },
  { label: "Unreconciled", value: "Unreconciled" },
];

// All live from Ship MCP. Freight/RTO = shipping_cost_summary; Total Billed =
// freight + rto; Status = reconciliation_summary; COD Remitted = cod_remittance_aging.
const COLUMNS: Column<Courier>[] = [
  {
    key: "name",
    header: "Courier",
    sortable: true,
    cell: (c) => (
      <div className="min-w-0">
        <div className="font-medium text-foreground">{c.name}</div>
        <div className="text-xs text-muted-foreground">{c.code}</div>
      </div>
    ),
  },
  { key: "status", header: "Status", sortable: true, cell: (c) => <ReconStatusBadge status={c.status} /> },
  { key: "shipments", header: "Shipments", sortable: true, align: "right", cell: (c) => <span className="tabular-nums">{formatNumber(c.shipments)}</span> },
  { key: "freight", header: "Freight Charges", sortable: true, align: "right", cell: (c) => money(c.freight) },
  { key: "rto", header: "RTO Charges", sortable: true, align: "right", cell: (c) => money(c.rto) },
  {
    key: "cost",
    header: "Total Billed",
    sortable: true,
    align: "right",
    cell: (c) => <span className="font-medium tabular-nums">{formatCurrencyINR(c.freight + c.rto)}</span>,
  },
  { key: "remitted", header: "COD Remitted", sortable: true, align: "right", cell: (c) => naMoney(c.remitted) },
];

export function CourierBillsTable({
  data,
  loading,
  title = "Courier Billing Details",
  subtitle = "Live per-courier billing (freight + RTO), reconciliation status, and COD remitted",
  source,
}: {
  data: Courier[];
  loading: boolean;
  title?: string;
  subtitle?: string;
  source?: SourceStatus;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  // Filter by reconciliation status, then augment with a `cost` field so
  // "Total Billed" sorts. (Search + sort + pagination stay in useTable.)
  const filtered = statusFilter === "all" ? data : data.filter((c) => c.status === statusFilter);
  const withCost = filtered.map((c) => ({ ...c, cost: c.freight + c.rto }));
  const table = useTable<Courier & Record<string, unknown>>({
    data: withCost as (Courier & Record<string, unknown>)[],
    searchKeys: ["name", "code"],
    initialSort: { key: "cost", dir: "desc" },
    pageSize: 20,
  });

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h3>
          <SourceBadge status={source} />
          {/* Search + status filter beside the title. */}
          <SearchInput value={table.search} onChange={table.setSearch} placeholder="Search courier…" className="w-full sm:w-56" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={STATUS_OPTIONS} className="w-full sm:w-44" />
        </div>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
          "Unreconciled" counts lines still pending reconciliation. These resolve through courier
          reconciliation cycles and are not confirmed disputes.
        </p>
      </div>
      <DataTable
        columns={COLUMNS}
        data={table.rows}
        getRowId={(c) => c.id}
        loading={loading}
        sort={table.sort}
        onSortChange={table.setSort}
        zebra
        className="rounded-none border-0"
        emptyTitle="No couriers"
        emptyMessage="No courier data for this range."
      />
    </Card>
  );
}
