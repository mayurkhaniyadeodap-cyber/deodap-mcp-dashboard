import { useState } from "react";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { FilterBar } from "@/components/shared/FilterBar";
import { BillingTabs } from "@/components/shared/PageTabs";
import { Pagination } from "@/components/shared/Pagination";
import { SearchInput } from "@/components/shared/SearchInput";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { BillStatusBadge } from "@/components/shared/StatusBadge";
import { Select } from "@/components/ui/select";
import { useDebounce } from "@/hooks/useDebounce";
import type { SortState } from "@/hooks/useTable";
import { useBills } from "@/services/bills.service";
import type { Bill, BillStatus } from "@/types/api";
import { formatCurrencyINR, formatDateIST } from "@/utils/format";
import { BILL_STATUS_META, BILL_STATUSES } from "@/utils/status";

const PAGE_SIZE = 10;
const DEFAULT_SORT: SortState = { key: "date", dir: "desc" };

const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  ...BILL_STATUSES.map((s) => ({ label: BILL_STATUS_META[s].label, value: s })),
];

const COLUMNS: Column<Bill>[] = [
  { key: "awb", header: "AWB", sortable: true, cell: (b) => <span className="font-medium">{b.awb}</span> },
  { key: "courier", header: "Courier", sortable: true, cell: (b) => b.courier },
  { key: "date", header: "Date", sortable: true, cell: (b) => formatDateIST(b.date) },
  { key: "weight", header: "Weight", sortable: true, align: "right", cell: (b) => `${b.weight.toFixed(2)} kg` },
  { key: "zone", header: "State", sortable: true, cell: (b) => b.zone },
  { key: "amount", header: "Amount", sortable: true, align: "right", cell: (b) => formatCurrencyINR(b.amount) },
  {
    key: "cod",
    header: "COD",
    sortable: true,
    align: "right",
    cell: (b) => (b.cod > 0 ? formatCurrencyINR(b.cod) : <span className="text-muted-foreground">—</span>),
  },
  { key: "status", header: "Status", sortable: true, cell: (b) => <BillStatusBadge status={b.status} /> },
];

export default function BillsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<BillStatus | "">("");
  const [sort, setSort] = useState<SortState | null>(DEFAULT_SORT);
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);
  const { data, isLoading } = useBills({ search: debouncedSearch, status, sort, page, pageSize: PAGE_SIZE });

  // Changing any filter resets to page 1.
  const onSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const onStatusChange = (v: string) => {
    setStatus(v as BillStatus | "");
    setPage(1);
  };
  const onSortChange = (s: SortState | null) => {
    setSort(s);
    setPage(1);
  };
  const onReset = () => {
    setSearch("");
    setStatus("");
    setSort(DEFAULT_SORT);
    setPage(1);
  };

  const hasFilters = search !== "" || status !== "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <BillingTabs />
        {/* Badge reflects the ACTUAL data source of this response: LIVE for the live
            list_orders listing, Sample for the search/sort demo-data path (the MCP
            can't search/sort), Unavailable on a live-fetch failure. Never mislabeled. */}
        <SourceBadge status={data?.source} />
      </div>
      <FilterBar onReset={hasFilters ? onReset : undefined}>
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder="Search AWB, courier, or zone…"
          className="sm:w-72"
        />
        <Select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          options={STATUS_OPTIONS}
          className="sm:w-48"
        />
      </FilterBar>

      <DataTable
        columns={COLUMNS}
        data={data?.items ?? []}
        getRowId={(b) => b.id}
        loading={isLoading}
        sort={sort}
        onSortChange={onSortChange}
        emptyTitle="No bills found"
        emptyMessage="Try adjusting your search or status filter."
      />

      <Pagination
        page={data?.page ?? page}
        pageCount={data?.total_pages ?? 1}
        total={data?.total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}
