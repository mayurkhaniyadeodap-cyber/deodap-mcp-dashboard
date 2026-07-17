import { BarChart3 } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  description?: string;
  /** Right-aligned slot in the header (legend, toggle, menu…). */
  action?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  /** Height of the plot area in px. */
  height?: number;
  /** The chart — typically a Recharts <ResponsiveContainer> at 100%×100%. */
  children: ReactNode;
  className?: string;
}

/**
 * Titled card wrapper for charts with consistent header, height, loading
 * skeleton, and empty state. Pages pass a Recharts chart as children.
 */
export function ChartCard({
  title,
  description,
  action,
  loading = false,
  empty = false,
  emptyMessage = "No data for this range.",
  height = 300,
  children,
  className,
}: ChartCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <h3 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h3>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="flex-1">
        <div style={{ height }} className="w-full">
          {loading ? (
            <Skeleton className="size-full" />
          ) : empty ? (
            <div className="flex size-full flex-col items-center justify-center text-center text-muted-foreground">
              <BarChart3 className="size-8 opacity-40" />
              <p className="mt-2 text-sm">{emptyMessage}</p>
            </div>
          ) : (
            children
          )}
        </div>
      </CardContent>
    </Card>
  );
}
