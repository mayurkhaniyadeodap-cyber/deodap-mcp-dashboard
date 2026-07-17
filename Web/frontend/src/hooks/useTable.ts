import { useMemo, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

interface UseTableOptions<T> {
  data: T[];
  /** Fields included in the free-text search. */
  searchKeys?: (keyof T)[];
  /** Extra predicate for external filters (e.g. status). */
  filterFn?: (row: T) => boolean;
  initialSort?: SortState | null;
  pageSize?: number;
  /** Custom comparable value per sort key (defaults to row[key]). */
  getSortValue?: (row: T, key: string) => string | number;
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Client-side table engine: search → filter → sort → paginate. Returns the
 * current page of rows plus the state/setters the shared table UI binds to.
 * (Server-driven tables like Bills manage this state via query params instead.)
 */
export function useTable<T extends Record<string, unknown>>({
  data,
  searchKeys = [],
  filterFn,
  initialSort = null,
  pageSize = 10,
  getSortValue,
}: UseTableOptions<T>) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState | null>(initialSort);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 250);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return data.filter((row) => {
      if (filterFn && !filterFn(row)) return false;
      if (!q || searchKeys.length === 0) return true;
      return searchKeys.some((k) => String(row[k] ?? "").toLowerCase().includes(q));
    });
  }, [data, debouncedSearch, searchKeys, filterFn]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const accessor = getSortValue ?? ((row: T, key: string) => row[key] as string | number);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => dir * compare(accessor(a, sort.key), accessor(b, sort.key)));
  }, [filtered, sort, getSortValue]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const rows = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  );

  // Changing search/sort should reset to page 1.
  const onSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const onSortChange = (s: SortState | null) => {
    setSort(s);
    setPage(1);
  };

  return {
    rows,
    total,
    page: safePage,
    pageCount,
    pageSize,
    setPage,
    sort,
    setSort: onSortChange,
    search,
    setSearch: onSearchChange,
  };
}
