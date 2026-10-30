import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { CHART_AXIS, CHART_COLORS } from "@/config/chart";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import type { TrendResponse } from "@/types/api";
import { formatCurrencyINR, formatCurrencyINRShort, formatDayMonthIST, formatNumber } from "@/utils/format";
import { badgeFromSource } from "@/utils/source";
import { monthlyBilled } from "@/utils/trend";

type View = "monthly" | "daily";

interface Props {
  data: TrendResponse | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  updatedAt?: number;
  className?: string;
}

/**
 * Billing & booking trend from /api/trend (the same response the Trend Analysis
 * page uses):
 *   Monthly billed — sum of per-courier billing per month (shipping_cost_summary).
 *     A month that failed to load is a GAP (null), never 0; partial months are
 *     marked (utils/trend.monthlyBilled).
 *   Daily bookings — order value (₹) and order count per day (daily_booking_trend).
 */
export function TrendCard({ data, loading, failed, onRetry, updatedAt, className }: Props) {
  const reduced = useReducedMotion();

  const monthly = useMemo(() => monthlyBilled(data), [data]);
  const monthsWithData = monthly.filter((m) => m.billed !== null).length;
  const completeMonths = monthly.filter((m) => m.billed !== null && !m.label.endsWith("*")).length;

  const daily = useMemo(
    () => (data?.daily ?? []).map((d) => ({ label: formatDayMonthIST(d.day), value: d.order_value, orders: d.orders })),
    [data],
  );

  // Default to Monthly when the range has 2+ complete loaded months, else Daily; the user's
  // own choice (tab click) wins afterwards.
  const [picked, setPicked] = useState<View | null>(null);
  const view: View = picked ?? (completeMonths >= 2 ? "monthly" : "daily");

  const unavailable = failed || data?.source === "unavailable";
  const empty = view === "monthly" ? monthsWithData === 0 : daily.length === 0;
  const partialCount = data?.partial_months?.length ?? 0;
  const failedList = data?.failed_months ?? [];

  const tabs = (
    <div role="tablist" aria-label="Trend view" className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 text-xs font-medium">
      {(
        [
          ["monthly", "Monthly billed"],
          ["daily", "Daily bookings"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          role="tab"
          type="button"
          aria-selected={view === key}
          onClick={() => setPicked(key)}
          className={cn(
            "rounded px-2.5 py-1 transition-colors duration-150",
            view === key ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <ChartCard
      title={view === "monthly" ? "Monthly Trend" : "Daily Trend"}
      description={
        view === "monthly"
          ? `Billed amount (₹) per month${data?.window ? ` · ${data.window}` : ""}`
          : "Order value and orders per day (bookings, not courier billing)"
      }
      loading={loading}
      unavailable={unavailable}
      onRetry={onRetry}
      empty={!loading && empty}
      emptyMessage={view === "monthly" ? "No complete month in this range — try Daily bookings." : "No bookings in this range."}
      height={240}
      endpoint="/api/trend"
      updatedAt={updatedAt}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {tabs}
          <SourceBadge status={badgeFromSource(data?.source)} />
        </div>
      }
      footer={
        view === "monthly" && (partialCount > 0 || failedList.length > 0) ? (
          <span>
            {partialCount > 0 ? "* Partial month — data still arriving. " : ""}
            {failedList.length > 0 ? `${failedList.join(", ")} failed to load (shown as a gap, not ₹0).` : ""}
          </span>
        ) : undefined
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        {view === "monthly" ? (
          <AreaChart data={monthly} margin={{ left: 0, right: 8, top: 6, bottom: 0 }} accessibilityLayer>
            <defs>
              <linearGradient id="trend-billed" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.brand} stopOpacity={0.35} />
                <stop offset="100%" stopColor={CHART_COLORS.brand} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} tickFormatter={(v) => formatCurrencyINRShort(Number(v))} width={56} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
            <Area
              type="monotone"
              dataKey="billed"
              name="Billed Amount"
              stroke={CHART_COLORS.brand}
              strokeWidth={2.5}
              fill="url(#trend-billed)"
              dot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS.brand }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={!reduced}
              animationDuration={900}
            />
          </AreaChart>
        ) : (
          <AreaChart data={daily} margin={{ left: 0, right: 0, top: 6, bottom: 0 }} accessibilityLayer>
            <defs>
              <linearGradient id="trend-value" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.brand} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_COLORS.brand} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} />
            <YAxis yAxisId="value" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} tickFormatter={(v) => formatCurrencyINRShort(Number(v))} width={56} tickLine={false} axisLine={false} />
            <YAxis yAxisId="orders" orientation="right" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} tickFormatter={(v) => formatNumber(Number(v))} width={44} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip valueFormatter={(v, name) => (name === "Orders" ? formatNumber(v) : formatCurrencyINR(v))} />} />
            <Area yAxisId="value" type="monotone" dataKey="value" name="Order value" stroke={CHART_COLORS.brand} strokeWidth={2.5} fill="url(#trend-value)" dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduced} animationDuration={900} />
            <Area yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke={CHART_COLORS.amber} strokeWidth={2} fill="none" dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduced} animationDuration={900} />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </ChartCard>
  );
}
