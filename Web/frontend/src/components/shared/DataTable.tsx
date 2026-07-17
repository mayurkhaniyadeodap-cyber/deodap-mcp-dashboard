import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { SortState } from "@/hooks/useTable";
import { cn } from "@/lib/utils";

export interface Column<T> {
  /** Stable id; also the sort key when the column is sortable. */
  key: string;
  header: ReactNode;
  /** Cell renderer — fully typed, no accessor magic. */
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  /** Class applied to the <td> (and header <th>). */
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowId: (row: T) => string | number;

  loading?: boolean;
  skeletonRows?: number;
  emptyTitle?: string;
  emptyMessage?: string;

  /** Controlled sort. When provided, headers call onSortChange; the table does
   *  NOT reorder data (parent/server owns ordering). */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;

  /** Optional row selection (checkbox column). */
  selection?: {
    selectedIds: Set<string | number>;
    onToggleRow: (id: string | number) => void;
    onTogglePage: (ids: (string | number)[]) => void;
  };

  onRowClick?: (row: T) => void;
  stickyHeader?: boolean;
  /** Alternating row shading (opt-in per table). */
  zebra?: boolean;
  className?: string;
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * One reusable, typed table for the whole app: sortable headers, sticky header,
 * loading skeletons, empty state, and optional row selection. Sorting/paging are
 * controlled so the same component serves client tables (via useTable) and
 * server-driven tables (Bills).
 */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  loading = false,
  skeletonRows = 8,
  emptyTitle = "Nothing here yet",
  emptyMessage = "No records match your filters.",
  sort,
  onSortChange,
  selection,
  onRowClick,
  stickyHeader = true,
  zebra = false,
  className,
}: DataTableProps<T>) {
  const cycleSort = (key: string) => {
    if (!onSortChange) return;
    if (!sort || sort.key !== key) onSortChange({ key, dir: "asc" });
    else if (sort.dir === "asc") onSortChange({ key, dir: "desc" });
    else onSortChange(null);
  };

  const pageIds = data.map(getRowId);
  const allSelected = selection && pageIds.length > 0 && pageIds.every((id) => selection.selectedIds.has(id));
  const colSpan = columns.length + (selection ? 1 : 0);

  return (
    <div className={cn("overflow-x-auto rounded-xl border border-border", className)}>
      <table className="w-full border-collapse text-sm">
        <thead
          className={cn(
            "bg-card text-xs uppercase tracking-wider text-muted-foreground",
            stickyHeader && "sticky top-0 z-10",
          )}
        >
          <tr className="border-b border-border">
            {selection && (
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  className="size-4 rounded border-border bg-background/60 accent-primary"
                  checked={allSelected}
                  onChange={() => selection.onTogglePage(pageIds)}
                  aria-label="Select all rows on this page"
                />
              </th>
            )}
            {columns.map((col) => {
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3 font-semibold",
                    alignClass[col.align ?? "left"],
                    col.sortable && onSortChange && "cursor-pointer select-none hover:text-foreground",
                    col.headerClassName,
                  )}
                  onClick={col.sortable ? () => cycleSort(col.key) : undefined}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5",
                      col.align === "right" && "flex-row-reverse",
                    )}
                  >
                    {col.header}
                    {col.sortable && onSortChange && (
                      <SortIcon active={active} dir={active ? sort.dir : undefined} />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, r) => (
              <tr key={`sk-${r}`}>
                {selection && (
                  <td className="px-4 py-3">
                    <Skeleton className="size-4" />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    <Skeleton className="h-4 w-full max-w-[8rem]" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-16">
                <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                  <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Inbox className="size-6" />
                  </div>
                  <p className="mt-3 font-medium text-foreground">{emptyTitle}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{emptyMessage}</p>
                </div>
              </td>
            </tr>
          ) : (
            data.map((row, i) => {
              const id = getRowId(row);
              const selected = selection?.selectedIds.has(id) ?? false;
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "transition-colors hover:bg-accent/40",
                    zebra ? (i % 2 === 1 ? "bg-muted/20" : "bg-transparent") : "bg-background/40",
                    onRowClick && "cursor-pointer",
                    selected && "bg-primary/[0.06]",
                  )}
                >
                  {selection && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="size-4 rounded border-border bg-background/60 accent-primary"
                        checked={selected}
                        onChange={() => selection.onToggleRow(id)}
                        aria-label="Select row"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn("px-4 py-3 text-foreground", alignClass[col.align ?? "left"], col.className)}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir?: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="size-3.5 opacity-40" />;
  return dir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />;
}
