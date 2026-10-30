import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { relTime } from "@/utils/format";

/**
 * "Updated 15s ago" — data-freshness label to sit beside a SourceBadge.
 *
 * `updatedAt` is the epoch-ms timestamp the data was last received (pass a
 * TanStack Query `dataUpdatedAt`). Hidden entirely when no timestamp is available
 * (e.g. the query hasn't resolved yet), per spec. A lightweight 15s tick keeps the
 * relative time current; it re-renders only this tiny label, nothing else.
 */
export function Freshness({ updatedAt, className }: { updatedAt?: number; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!updatedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [updatedAt]);

  if (!updatedAt) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground ${className ?? ""}`}
      title={new Date(updatedAt).toLocaleString()}
    >
      <Clock className="size-3 shrink-0" />
      Updated {relTime(updatedAt)}
    </span>
  );
}
