import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useDateRange } from "@/store/dateRange.store";
import type {
  DiscrepancyResponse,
  DisputeInvoicesResponse,
  DisputeLinesResponse,
  ReconciliationResponse,
  SavingsResponse,
} from "@/types/api";

/**
 * GET /api/discrepancies/reconciliation?from&to — SLOW (reconciliation_disputes ×2
 * + reconciliation_summary). Per-AWB weight/rate mismatches + reconciled totals.
 * Own skeleton; 60s server cache.
 */
export function useReconciliation() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["reconciliation", from, to],
    queryFn: async () =>
      (await api.get<ReconciliationResponse>("/discrepancies/reconciliation", { params: { from, to } })).data,
    staleTime: 60_000,
  });
}

/** GET /api/discrepancies?from&to — fast panels: rate difference, weight aggregate, RTO, NDR. */
export function useDiscrepancies() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["discrepancies", from, to],
    queryFn: async () => (await api.get<DiscrepancyResponse>("/discrepancies", { params: { from, to } })).data,
  });
}

export interface DisputeLineFilters {
  minDiff: number;
  sortBy: "rate_diff" | "weight_diff";
  courier: string | null; // display name (empty/null = all)
  invoiceNo: string;
  page: number;
  pageSize: number;
}

/**
 * GET /api/disputes/lines — the per-AWB dispute list (priced, ≥min_diff,
 * reconciliation_at basis). Enumeration is served warm; filter/sort/page are
 * server-side. Polls while the first enumeration is still computing.
 */
export function useDisputeLines(f: DisputeLineFilters, opts?: { enabled?: boolean }) {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["dispute-lines", from, to, f.minDiff, f.sortBy, f.courier, f.invoiceNo, f.page, f.pageSize],
    queryFn: async () =>
      (
        await api.get<DisputeLinesResponse>("/disputes/lines", {
          params: {
            from, to,
            min_diff: f.minDiff,
            sort_by: f.sortBy,
            courier_slug: f.courier || undefined,
            invoice_no: f.invoiceNo || undefined,
            page: f.page,
            page_size: f.pageSize,
          },
        })
      ).data,
    enabled: opts?.enabled ?? true,
    placeholderData: (prev) => prev, // keep the current page visible while paging
    staleTime: 25 * 60 * 1000,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.computing || d.recalculating) ? 15_000 : false;
    },
  });
}

/**
 * GET /api/disputes/invoices — the DEFAULT invoice-grouped view. Dispute lines
 * bundled by carrier invoice; totals reconcile exactly with the claimable KPI.
 */
export function useDisputeInvoices(
  f: Pick<DisputeLineFilters, "minDiff" | "courier" | "invoiceNo" | "page" | "pageSize">,
  opts?: { enabled?: boolean },
) {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["dispute-invoices", from, to, f.minDiff, f.courier, f.invoiceNo, f.page, f.pageSize],
    queryFn: async () =>
      (
        await api.get<DisputeInvoicesResponse>("/disputes/invoices", {
          params: {
            from, to,
            min_diff: f.minDiff,
            courier_slug: f.courier || undefined,
            invoice_no: f.invoiceNo || undefined,
            page: f.page,
            page_size: f.pageSize,
          },
        })
      ).data,
    enabled: opts?.enabled ?? true,
    placeholderData: (prev) => prev,
    staleTime: 25 * 60 * 1000,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.computing || d.recalculating) ? 15_000 : false;
    },
  });
}

/**
 * GET /api/disputes/{lines|invoices}/export/{fmt} — downloads the CURRENT filtered
 * set for the active view (line items OR invoice summary) as a blob. Filenames
 * come from Content-Disposition.
 */
export function useDisputeLinesExport() {
  const { from, to } = useDateRange();
  return useMutation({
    mutationFn: async ({ fmt, f, view }: { fmt: "csv" | "xlsx"; f: DisputeLineFilters; view: "lines" | "invoices" }) => {
      const res = await api.get(`/disputes/${view}/export/${fmt}`, {
        params: {
          from, to,
          min_diff: f.minDiff,
          // sort_by only applies to the line-item export
          ...(view === "lines" ? { sort_by: f.sortBy } : {}),
          courier_slug: f.courier || undefined,
          invoice_no: f.invoiceNo || undefined,
        },
        responseType: "blob",
      });
      const disposition = res.headers["content-disposition"] as string | undefined;
      const match = disposition?.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `deodap_dispute_${view}.${fmt}`;
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return filename;
    },
  });
}

/**
 * GET /api/savings-opportunity?from&to — SLOW (pincode_serviceability sample,
 * ~30s first load, 30-min server cache). Fetched separately so it never blocks
 * the Discrepancies page; its own loading skeleton renders while it computes.
 */
export function useSavingsOpportunity() {
  const { from, to } = useDateRange();
  return useQuery({
    queryKey: ["savings-opportunity", from, to],
    queryFn: async () => (await api.get<SavingsResponse>("/savings-opportunity", { params: { from, to } })).data,
    staleTime: 30 * 60 * 1000, // matches the server's 30-min cache
    gcTime: 30 * 60 * 1000,
  });
}
