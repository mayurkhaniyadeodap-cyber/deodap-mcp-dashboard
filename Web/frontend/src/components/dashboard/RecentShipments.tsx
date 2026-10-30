import { ArrowRight } from "lucide-react";
import { Freshness } from "@/components/shared/Freshness";
import { useState } from "react";
import { Link } from "react-router-dom";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { SearchInput } from "@/components/shared/SearchInput";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { BillStatusBadge } from "@/components/shared/StatusBadge";
import { PanelUnavailable } from "@/components/shared/Unavailable";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { courierStyle } from "@/config/couriers";
import { useDebounce } from "@/hooks/useDebounce";
import { useBills } from "@/services/bills.service";
import type { Bill, BillStatus } from "@/types/api";
import { formatCurrencyINR, formatDateIST, formatDayMonthIST } from "@/utils/format";
import { BILL_STATUS_META, BILL_STATUSES } from "@/utils/status";

// Same page size + default sort as the Bills page, so both share one cached query
// (and one MCP call) for the first page.
const PAGE_SIZE = 10;
const DEFAULT_SORT = { key: "date", dir: "desc" } as const;

const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  ...BILL_STATUSES.map((s) => ({ label: BILL_STATUS_META[s].label, value: s })),
];

const COLUMNS: Column<Bill>[] = [
  { key: "awb", header: "AWB", cell: (b) => <span className="whitespace-nowrap font-medium tabular-nums">{b.awb}</span> },
  {
    key: "courier",
    header: "Courier",
    cell: (b) => (
      <span className="inline-flex max-w-[9.5rem] items-center gap-2 whitespace-nowrap" title={b.courier}>
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: courierStyle(b.courier).color }} />
        <span className="truncate">{b.courier}</span>
      </span>
    ),
  },
  { key: "date", header: "Date", cell: (b) => <span className="whitespace-nowrap" title={formatDateIST(b.date)}>{formatDayMonthIST(b.date)}</span> },
  { key: "weight", header: "Weight", align: "right", cell: (b) => <span className="whitespace-nowrap tabular-nums">{b.weight.toFixed(2)} kg</span> },
  { key: "zone", header: "State", cell: (b) => <span className="block max-w-[8.5rem] truncate whitespace-nowrap" title={b.zone}>{b.zone}</span> },
  { key: "amount", header: "Amount", align: "right", cell: (b) => <span className="whitespace-nowrap font-medium tabular-nums">{formatCurrencyINR(b.amount)}</span> },
  { key: "status", header: "Status", cell: (b) => <BillStatusBadge status={b.status} /> },
];

/**
 * Latest shipments for the selected range, from GET /api/bills (newest first). Search
 * (AWB / courier / state) and the status filter are served live by the MCP; the badge
 * shows the ACTUAL source of each response, and an MCP failure shows the unavailable
 * state — never placeholder rows.
 */
export function RecentShipments({ className }: { className?: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<BillStatus | "">("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 300);
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useBills({
    search: debounced,
    status,
    sort: DEFAULT_SORT,
    page,
    pageSize: PAGE_SIZE,
  });
  const unavailable = isError || data?.source === "unavailable";
  const filtered = debounced !== "" || status !== "";

  return (
    <Card className={`flex min-w-0 flex-col overflow-hidden rounded-xl animate-fade-up ${className ?? ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-tight tracking-tight">Recent Shipments</h3>
            <SourceBadge status={isError ? "unavailable" : data?.source} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Newest first{data && !unavailable ? ` · ${data.total.toLocaleString("en-IN")} in this range` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Link to="/bills" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
            View all bills <ArrowRight className="size-3.5" />
          </Link>
          {data && !unavailable ? <Freshness updatedAt={dataUpdatedAt} /> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pb-3 sm:flex-row [&_input]:h-9 [&_select]:h-9">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search AWB, courier or state…"
          className="sm:flex-1 sm:max-w-xs"
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as BillStatus | "");
            setPage(1);
          }}
          options={STATUS_OPTIONS}
          className="sm:w-44"
        />
      </div>

      {unavailable ? (
        <div className="h-[280px] px-4 pb-4">
          <PanelUnavailable onRetry={() => refetch()} retrying={isFetching} />
        </div>
      ) : (
        <>
          {/* Horizontal scroll stays inside the card on narrow screens. */}
          <div className={`scrollbar-thin overflow-x-auto border-t border-border transition-opacity ${isFetching && !isLoading ? "opacity-60" : ""}`}>
            <DataTable
              columns={COLUMNS}
              data={data?.items ?? []}
              getRowId={(b) => b.id}
              loading={isLoading}
              skeletonRows={6}
              className="min-w-[600px] rounded-none border-0 [&_td]:px-2.5 [&_td]:py-2 [&_td]:text-[12.5px] [&_th]:px-2.5 [&_th]:py-2.5 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4"
              emptyTitle={filtered ? "No matching shipments" : "No shipments"}
              emptyMessage={filtered ? "Try another AWB, courier or state, or clear the status filter." : "No shipments in this date range."}
            />
          </div>
          {data && data.total_pages > 1 ? (
            <div className="border-t border-border px-4 py-2.5">
              <Pagination page={data.page} pageCount={data.total_pages} total={data.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
