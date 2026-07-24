import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/** Relative "Xs / Xm / Xh ago" from an epoch-ms timestamp. */
function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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
