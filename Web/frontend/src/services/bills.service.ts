import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { SortState } from "@/hooks/useTable";
import { useDateRange } from "@/store/dateRange.store";
import type { BillStatus, BillsPage } from "@/types/api";

export interface BillsQuery {
  search?: string;
  status?: BillStatus | "";
  sort?: SortState | null;
  page: number;
  pageSize: number;
}

/**
 * GET /api/bills?…&from&to — server-side search, status filter, sort, pagination,
 * plus the active date range. keepPreviousData keeps the table stable while the
 * next page loads.
 */
export function useBills(query: BillsQuery) {
  const { from, to } = useDateRange();
  const params = {
    search: query.search || undefined,
    status: query.status || undefined,
    sort: query.sort ? `${query.sort.key}:${query.sort.dir}` : undefined,
    page: query.page,
    page_size: query.pageSize,
    from,
    to,
  };

  return useQuery({
    // Key includes page/search/status/sort (via params) and from/to.
    queryKey: ["bills", params],
    queryFn: async () => {
      const { data } = await api.get<BillsPage>("/bills", { params });
      return data;
    },
    placeholderData: keepPreviousData,
  });
}
