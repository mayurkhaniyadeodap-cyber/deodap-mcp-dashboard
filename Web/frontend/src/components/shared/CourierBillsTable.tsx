import { type Column, DataTable } from "@/components/shared/DataTable";
import { SearchInput } from "@/components/shared/SearchInput";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Card } from "@/components/ui/card";
import { useTable } from "@/hooks/useTable";
import type { SourceStatus } from "@/services/meta.service";
import type { Courier } from "@/types/api";
import { formatCurrencyINR, formatNumber } from "@/utils/format";

const money = (v: number) => <span className="tabular-nums">{formatCurrencyINR(v)}</span>;

// Only real, live columns. Removed the fabricated Fuel Surcharge / COD Charges
// (constants), COD Remitted / Net Payable (no source) and the heuristic Status.
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
  { key: "shipments", header: "Shipments", sortable: true, align: "right", cell: (c) => <span className="tabular-nums">{formatNumber(c.shipments)}</span> },
  { key: "freight", header: "Freight", sortable: true, align: "right", cell: (c) => money(c.freight) },
  { key: "rto", header: "RTO", sortable: true, align: "right", cell: (c) => money(c.rto) },
  {
    key: "cost",
    header: "Cost (our rate card)",
    sortable: true,
    align: "right",
    cell: (c) => <span className="font-medium tabular-nums">{formatCurrencyINR(c.freight + c.rto)}</span>,
  },
  { key: "cod_value", header: "COD Value", sortable: true, align: "right", cell: (c) => money(c.cod_value) },
];

export function CourierBillsTable({
  data,
  loading,
  title = "Courier Cost Detail",
  subtitle = "Our applied rate card (freight + RTO) per courier — not the courier's invoice",
  source,
}: {
  data: Courier[];
  loading: boolean;
  title?: string;
  subtitle?: string;
  source?: SourceStatus;
}) {
  // Augment with a real `cost` field so the "Cost (our rate card)" column sorts.
  const withCost = data.map((c) => ({ ...c, cost: c.freight + c.rto }));
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
          {/* Search sits beside the title, not floating far right. */}
          <SearchInput value={table.search} onChange={table.setSearch} placeholder="Search courier…" className="w-full sm:w-56" />
        </div>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
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
