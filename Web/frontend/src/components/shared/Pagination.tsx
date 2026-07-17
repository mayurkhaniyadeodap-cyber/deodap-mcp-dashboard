import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Optional counts for the "showing x–y of z" summary. */
  total?: number;
  pageSize?: number;
}

/** Builds a compact page list with ellipses, e.g. 1 … 4 5 6 … 20. */
function pageWindow(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) pages.push("…");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < pageCount - 1) pages.push("…");
  pages.push(pageCount);
  return pages;
}

export function Pagination({ page, pageCount, onPageChange, total, pageSize }: PaginationProps) {
  const from = total !== undefined && pageSize ? (page - 1) * pageSize + 1 : undefined;
  const to = total !== undefined && pageSize ? Math.min(page * pageSize, total) : undefined;

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      {total !== undefined ? (
        <p className="text-xs text-muted-foreground">
          {total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}
        </p>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="grid size-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </button>

        {pageWindow(page, pageCount).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1.5 text-sm text-muted-foreground">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(
                "grid size-8 place-items-center rounded-md border text-sm transition-colors",
                p === page
                  ? "border-primary bg-primary/15 font-medium text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {p}
            </button>
          ),
        )}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          className="grid size-8 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
