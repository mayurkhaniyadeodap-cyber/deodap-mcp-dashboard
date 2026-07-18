import { ChevronDown, ChevronRight, Download, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { SearchInput } from "@/components/shared/SearchInput";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import type { SortState } from "@/hooks/useTable";
import { useHasRole } from "@/routes/RoleGuard";
import { apiErrorMessage } from "@/services/api";
import {
  type DisputeLineFilters,
  useDisputeInvoices,
  useDisputeLines,
  useDisputeLinesExport,
} from "@/services/discrepancies.service";
import type { DisputeInvoiceGroup, DisputeLine } from "@/types/api";
import { formatCurrencyINR, formatNumber } from "@/utils/format";

const LINE_PAGE_SIZE = 50;
const INVOICE_PAGE_SIZE = 25;
const MIN_DIFF_OPTIONS = [10, 50, 100] as const;

type Row = DisputeLine & Record<string, unknown>;
const kg = (v: number) => <span className="tabular-nums">{v.toFixed(2)} kg</span>;
const money = (v: number) => <span className="tabular-nums">{formatCurrencyINR(v)}</span>;

function StatusPill({ status }: { status: string }) {
  // "Unreconciled" = pending reconciliation line, not a confirmed dispute (project rule).
  const tone = status === "Reconciled" ? "bg-success/15 text-success" : "bg-warning/15 text-warning";
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{status || "—"}</span>;
}

// Sticky header + zebra + hover come from DataTable. Only Rate Diff / Wt Diff are
// server-sortable; the rest are plain columns.
const LINE_COLUMNS: Column<Row>[] = [
  { key: "awb", header: "AWB", cell: (r) => <span className="font-mono text-xs font-medium">{r.awb}</span> },
  { key: "invoice_no", header: "Invoice No", cell: (r) => <span className="font-mono text-xs">{r.invoice_no ?? "—"}</span> },
  { key: "courier", header: "Courier", cell: (r) => <span className="font-medium">{r.courier}{r.is_rto ? <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">RTO</span> : null}</span> },
  { key: "order_date", header: "Order Date", cell: (r) => <span className="tabular-nums">{r.order_date ?? "—"}</span> },
  { key: "recon_date", header: "Recon Date", cell: () => <span className="text-muted-foreground">—</span> },
  { key: "applied_weight_kg", header: "Applied Wt", align: "right", cell: (r) => kg(r.applied_weight_kg) },
  { key: "invoiced_weight_kg", header: "Invoiced Wt", align: "right", cell: (r) => kg(r.invoiced_weight_kg) },
  { key: "weight_diff", header: "Wt Diff", sortable: true, align: "right", cell: (r) => <span className="tabular-nums text-destructive">{r.weight_diff_kg.toFixed(2)} kg</span> },
  { key: "applied_rate", header: "Applied ₹", align: "right", cell: (r) => money(r.applied_rate) },
  { key: "invoiced_rate", header: "Invoiced ₹", align: "right", cell: (r) => money(r.invoiced_rate) },
  { key: "rate_diff", header: "Rate Diff ₹", sortable: true, align: "right", cell: (r) => <span className="font-medium tabular-nums text-destructive">{formatCurrencyINR(r.rate_diff)}</span> },
  { key: "status", header: "Status", cell: (r) => <StatusPill status={r.status} /> },
];

const rowId = (r: DisputeLine) => `${r.awb}-${r.is_rto ? "r" : "f"}-${r.invoice_no ?? ""}`;

/** The line items for one invoice (lazy-loaded when the card is expanded). */
function InvoiceLineItems({ base, invoiceNo }: { base: DisputeLineFilters; invoiceNo: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useDisputeLines(
    { ...base, invoiceNo, sortBy: "rate_diff", page, pageSize: LINE_PAGE_SIZE },
    { enabled: true },
  );
  const pageCount = data ? Math.max(1, Math.ceil(data.total_matched / LINE_PAGE_SIZE)) : 1;
  return (
    <div className="border-t border-border bg-muted/20 px-2 py-2">
      <DataTable
        columns={LINE_COLUMNS}
        data={(data?.lines ?? []) as Row[]}
        getRowId={rowId}
        loading={isLoading}
        zebra
        className="rounded-none border-0 bg-transparent"
        emptyTitle="No lines"
        emptyMessage="No lines for this invoice."
      />
      {(data?.total_matched ?? 0) > LINE_PAGE_SIZE && (
        <Pagination page={data?.page ?? page} pageCount={pageCount} total={data?.total_matched} pageSize={LINE_PAGE_SIZE} onPageChange={setPage} />
      )}
    </div>
  );
}

/** One expandable invoice card: summary row + drill-down to its line items. */
function InvoiceCard({ g, base }: { g: DisputeInvoiceGroup; base: DisputeLineFilters }) {
  const [open, setOpen] = useState(false);
  const dates = g.date_from === g.date_to ? g.date_from ?? "—" : `${g.date_from ?? "—"} → ${g.date_to ?? "—"}`;
  return (
    <div className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        <span className="w-48 shrink-0 truncate font-mono text-xs font-medium" title={g.invoice_no}>{g.invoice_no}</span>
        <span className="w-32 shrink-0 truncate text-sm">{g.courier}</span>
        <span className="hidden w-40 shrink-0 text-xs text-muted-foreground sm:inline">{dates}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatNumber(g.line_count)} lines</span>
        <span className="w-32 shrink-0 text-right font-semibold tabular-nums text-destructive">{formatCurrencyINR(g.rate_diff_total)}</span>
      </button>
      {open && <InvoiceLineItems base={base} invoiceNo={g.invoice_no} />}
    </div>
  );
}

export default function DisputeLinesPage() {
  const [view, setView] = useState<"invoices" | "lines">("invoices");
  const [minDiff, setMinDiff] = useState<number>(50);
  const [sortBy, setSortBy] = useState<"rate_diff" | "weight_diff">("rate_diff");
  const [courier, setCourier] = useState<string>("");
  const [invoiceNo, setInvoiceNo] = useState<string>("");
  const [page, setPage] = useState(1);
  const debouncedInvoice = useDebounce(invoiceNo, 300);

  const filters: DisputeLineFilters = {
    minDiff, sortBy, courier: courier || null, invoiceNo: debouncedInvoice, page, pageSize: LINE_PAGE_SIZE,
  };

  const grouped = view === "invoices";
  const invoicesQ = useDisputeInvoices(
    { minDiff, courier: courier || null, invoiceNo: debouncedInvoice, page, pageSize: INVOICE_PAGE_SIZE },
    { enabled: grouped },
  );
  const linesQ = useDisputeLines({ ...filters }, { enabled: !grouped });
  const active = grouped ? invoicesQ : linesQ;
  const data = active.data;

  const exportDl = useDisputeLinesExport();
  const { toast } = useToast();
  const canExport = useHasRole("admin", "employee");

  const badge = data?.source === "live" ? "live" : "sample";
  const computing = data?.computing ?? false;
  const claimable = data?.claimable_amount ?? 0;
  const unitCount = data?.total_matched ?? 0; // invoices or lines depending on view
  const couriers = data?.couriers ?? [];
  const excluded = data?.excluded_no_applied_rate ?? 0;

  const sort: SortState = { key: sortBy, dir: "desc" };
  const pageSize = grouped ? INVOICE_PAGE_SIZE : LINE_PAGE_SIZE;
  const pageCount = data ? Math.max(1, Math.ceil(unitCount / pageSize)) : 1;
  const courierOptions = [{ label: "All couriers", value: "" }, ...couriers.map((c) => ({ label: c, value: c }))];

  const reset1 = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };
  const onSortChange = (s: SortState | null) => {
    if (s && (s.key === "rate_diff" || s.key === "weight_diff")) { setSortBy(s.key); setPage(1); }
  };
  const switchView = (v: "invoices" | "lines") => { setView(v); setPage(1); };

  const onExport = (fmt: "csv" | "xlsx") => {
    exportDl.mutate(
      { fmt, f: { ...filters, invoiceNo: debouncedInvoice }, view },
      {
        onSuccess: (filename) => toast({ title: "Export ready", description: `${filename} downloaded.`, variant: "success" }),
        onError: (err) => toast({ title: "Export failed", description: apiErrorMessage(err), variant: "error" }),
      },
    );
  };

  return (
    <div className="space-y-4">
      {/* Header: claimable summary + honest framing + export */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[22px] font-semibold leading-tight tracking-tight">Dispute Lines</h2>
              <SourceBadge status={badge} />
            </div>
            <p className="mt-1 text-sm">
              <span className="font-semibold text-foreground">Claimable: {formatCurrencyINR(claimable)}</span>
              <span className="text-muted-foreground">
                {grouped ? ` across ${formatNumber(unitCount)} invoices` : ` · ${formatNumber(unitCount)} lines`}
                {" · priced shipments, differences ≥ ₹"}{minDiff}{", reconciliation date"}
              </span>
            </p>
            {excluded > 0 && (
              <p className="mt-1 text-[12px] text-muted-foreground">
                {formatNumber(excluded)} unpriced shipments excluded (no applied rate — cannot be disputed).
              </p>
            )}
            <p className="mt-1 text-[12px] text-muted-foreground">
              Filtered on reconciliation date. Each line is a billing line (forward or RTO leg) — AWBs are effectively
              unique, so lines are not deduped. Per-line reconciliation date isn't exposed by the MCP.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onExport("csv")} disabled={!canExport || exportDl.isPending}>
              <FileText className="mr-1.5 size-4" /> CSV
            </Button>
            <Button size="sm" onClick={() => onExport("xlsx")} disabled={!canExport || exportDl.isPending}>
              {exportDl.isPending ? <Download className="mr-1.5 size-4 animate-pulse" /> : <FileSpreadsheet className="mr-1.5 size-4" />} Excel
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {grouped
            ? "Exporting the invoice summary (one row per carrier invoice)."
            : "Exporting the full line items (one row per AWB, with invoice_no)."}
          {!canExport && " Your role is read-only and cannot export."}
        </p>
      </Card>

      {/* View toggle + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          <button
            onClick={() => switchView("invoices")}
            className={cn("px-3 py-1.5 text-sm font-medium transition-colors", grouped ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted")}
          >
            Group by invoice
          </button>
          <button
            onClick={() => switchView("lines")}
            className={cn("px-3 py-1.5 text-sm font-medium transition-colors", !grouped ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted")}
          >
            All lines
          </button>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {MIN_DIFF_OPTIONS.map((v) => (
            <button
              key={v}
              onClick={() => reset1(setMinDiff)(v)}
              className={cn("px-3 py-1.5 text-sm font-medium transition-colors", minDiff === v ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted")}
            >
              ≥ ₹{v}
            </button>
          ))}
        </div>
        <Select value={courier} onChange={(e) => reset1(setCourier)(e.target.value)} options={courierOptions} className="w-full sm:w-52" />
        <SearchInput value={invoiceNo} onChange={reset1(setInvoiceNo)} placeholder="Search invoice no…" className="w-full sm:w-56" />
      </div>

      {computing ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
          <span className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          Building the dispute list for ≥ ₹{minDiff}… (first calculation may take a couple of minutes; cached after).
        </Card>
      ) : (
        <>
          {data?.recalculating && (
            <p className="text-xs text-muted-foreground">Recalculating for this threshold — showing the last computed result.</p>
          )}

          {grouped ? (
            <Card className="overflow-hidden">
              {/* Column headings for the invoice list */}
              <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span className="w-4 shrink-0" />
                <span className="w-48 shrink-0">Invoice No</span>
                <span className="w-32 shrink-0">Courier</span>
                <span className="hidden w-40 shrink-0 sm:inline">Date Range</span>
                <span className="ml-auto shrink-0"># Lines</span>
                <span className="w-32 shrink-0 text-right">Rate Diff ₹</span>
              </div>
              <div className="divide-y divide-border">
                {invoicesQ.isLoading && !invoicesQ.data ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading invoices…</div>
                ) : (invoicesQ.data?.invoices ?? []).length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">No invoices clear this threshold for the selected filters.</div>
                ) : (
                  (invoicesQ.data?.invoices ?? []).map((g) => <InvoiceCard key={g.invoice_no} g={g} base={filters} />)
                )}
              </div>
            </Card>
          ) : (
            <DataTable
              columns={LINE_COLUMNS}
              data={(linesQ.data?.lines ?? []) as Row[]}
              getRowId={rowId}
              loading={linesQ.isLoading}
              sort={sort}
              onSortChange={onSortChange}
              zebra
              emptyTitle="No dispute lines"
              emptyMessage="No priced lines clear this threshold for the selected filters."
            />
          )}

          <Pagination page={data?.page ?? page} pageCount={pageCount} total={unitCount} pageSize={pageSize} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
