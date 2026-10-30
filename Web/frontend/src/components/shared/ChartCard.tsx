import { BarChart3 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { AdminToolInfo } from "@/components/shared/AdminToolInfo";
import { Freshness } from "@/components/shared/Freshness";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelUnavailable } from "@/components/shared/Unavailable";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  description?: string;
  /** Right-aligned slot in the header (legend, toggle, menu…). */
  action?: ReactNode;
  loading?: boolean;
  /** Text under the loading skeleton (e.g. "Sampling rate_summary (~7s)…"). */
  loadingMessage?: string;
  empty?: boolean;
  emptyMessage?: string;
  /** Ship MCP unreachable → render the "unavailable" state instead of the chart. */
  unavailable?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  /** Height of the plot area in px. */
  height?: number;
  /** The chart — typically a Recharts <ResponsiveContainer> at 100%×100%. */
  children: ReactNode;
  /** Optional strip under the plot (footnotes, summary). */
  footer?: ReactNode;
  /** When the data was received (epoch ms) → "Updated 2m ago" under the header action. */
  updatedAt?: number;
  className?: string;
  style?: CSSProperties;
  /** Optional API endpoint this card is fed by. When set, admins see a small
   *  data-source / MCP-tool affordance (no effect for other users). */
  endpoint?: string;
}

/**
 * Titled card wrapper for charts with consistent header, height, loading
 * skeleton, unavailable and empty states. Pages pass a Recharts chart as children.
 */
export function ChartCard({
  title,
  description,
  action,
  loading = false,
  loadingMessage,
  empty = false,
  emptyMessage = "No data for this range.",
  unavailable = false,
  onRetry,
  retrying,
  height = 300,
  children,
  footer,
  updatedAt,
  className,
  style,
  endpoint,
}: ChartCardProps) {
  return (
    <Card className={cn("flex min-w-0 flex-col rounded-xl animate-fade-up", className)} style={style}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-x-3 gap-y-2 space-y-0 p-4 pb-3">
        <div className="min-w-[10rem] flex-1">
          <h3 className="text-[15px] font-semibold leading-tight tracking-tight">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            {endpoint ? <AdminToolInfo endpoint={endpoint} /> : null}
            {action}
          </div>
          {updatedAt && !loading ? <Freshness updatedAt={updatedAt} /> : null}
        </div>
      </CardHeader>
      <CardContent className="flex-1 px-4 pb-4">
        <div style={{ height }} className="w-full">
          {loading ? (
            <div aria-busy="true" className="flex size-full flex-col gap-2">
              <Skeleton className="w-full flex-1" />
              {loadingMessage ? <p className="text-xs text-muted-foreground">{loadingMessage}</p> : null}
            </div>
          ) : unavailable ? (
            <PanelUnavailable onRetry={onRetry} retrying={retrying} />
          ) : empty ? (
            <div className="flex size-full flex-col items-center justify-center text-center text-muted-foreground">
              <BarChart3 className="size-8 opacity-40" />
              <p className="mt-2 text-sm">{emptyMessage}</p>
            </div>
          ) : (
            children
          )}
        </div>
        {footer ? <div className="mt-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
