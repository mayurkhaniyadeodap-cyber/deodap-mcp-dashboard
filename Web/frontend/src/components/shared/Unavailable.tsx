import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, WifiOff } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Retry ALL live data — the SAME logic as the navbar Refresh button
 * (`queryClient.invalidateQueries()` → refetch every active query), plus a local
 * in-flight flag so the button can show a spinner and disable while retrying.
 *
 * `extra` is an optional page-supplied refetch (e.g. a specific query); it's called
 * in addition to the global invalidate, never instead of it — that per-query-only
 * behaviour was the original bug (it left the other failed panels un-retried).
 */
function useLiveDataRetry(extra?: () => void) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const retry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      extra?.();
      // Refetch every active query (all affected MCP requests) and wait for them to
      // settle, so the button stays disabled/spinning until the retry completes. If
      // it succeeds, panels flip back to live and the banner hides automatically; if
      // it fails, the queries stay "unavailable" and the banner remains.
      await queryClient.invalidateQueries();
    } finally {
      setRetrying(false);
    }
  }, [queryClient, extra, retrying]);
  return { retry, retrying };
}

/**
 * In-panel "live data unavailable" state — shown INSTEAD of a chart/table when the
 * Ship MCP is unreachable. Never shows numbers. Auto-retry runs in the background;
 * the button forces an immediate retry of ALL live queries.
 */
export function PanelUnavailable({
  onRetry,
  retrying: retryingProp,
  className,
}: {
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const { retry, retrying } = useLiveDataRetry(onRetry);
  const busy = retrying || Boolean(retryingProp);
  return (
    <div className={cn("flex size-full min-h-[140px] flex-col items-center justify-center gap-2 text-center", className)}>
      <WifiOff className="size-6 text-warning" />
      <p className="text-sm font-medium">Live data unavailable</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Ship MCP unreachable — no numbers shown. Retrying automatically…
      </p>
      <Button variant="outline" size="sm" onClick={retry} disabled={busy} className="mt-1">
        <RefreshCw className={cn("mr-1.5 size-3.5", busy && "animate-spin")} />
        {busy ? "Retrying…" : "Retry now"}
      </Button>
    </div>
  );
}

/**
 * Page-level banner shown when ANY panel on the page is unavailable, so the outage
 * is unmistakable even if some panels still have data. The Retry button retries all
 * live queries at once (same as the navbar Refresh).
 */
export function UnavailableBanner({
  show,
  onRetry,
  retrying: retryingProp,
}: {
  show: boolean;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const { retry, retrying } = useLiveDataRetry(onRetry);
  const busy = retrying || Boolean(retryingProp);
  if (!show) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
      <WifiOff className="size-4 shrink-0" />
      <span className="font-medium">Live data unavailable</span>
      <span className="text-warning/80">— the Ship MCP is unreachable. No numbers are shown; retrying automatically.</span>
      <Button
        variant="outline"
        size="sm"
        onClick={retry}
        disabled={busy}
        className="ml-auto border-warning/40 text-warning hover:bg-warning/15"
      >
        <RefreshCw className={cn("mr-1.5 size-3.5", busy && "animate-spin")} />
        {busy ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
