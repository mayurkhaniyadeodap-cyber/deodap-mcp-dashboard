import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { CHART_AXIS, CHART_CURSOR } from "@/config/chart";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { SourceStatus } from "@/services/meta.service";
import type { Courier } from "@/types/api";
import { formatCurrencyINR, formatCurrencyINRShort } from "@/utils/format";

const TOP = 7;

interface Props {
  couriers: Courier[] | undefined;
  loading: boolean;
  unavailable: boolean;
  onRetry: () => void;
  source?: SourceStatus;
  updatedAt?: number;
  className?: string;
}

/**
 * Courier-wise cost: Forward + RTO stacked, both from shipping_cost_summary (same
 * population, same scale). Top 7 couriers by total cost + "Others" (the rest summed,
 * so the bars still add up to the whole).
 */
export function CourierCostCard({ couriers, loading, unavailable, onRetry, source, updatedAt, className }: Props) {
  const reduced = useReducedMotion();
  const rows = useMemo(() => {
    const sorted = [...(couriers ?? [])]
      .map((c) => ({ name: c.name, freight: c.freight, rto: c.rto }))
      .sort((a, b) => b.freight + b.rto - (a.freight + a.rto));
    if (sorted.length <= TOP + 1) return sorted;
    const rest = sorted.slice(TOP);
    return [
      ...sorted.slice(0, TOP),
      { name: "Others", freight: rest.reduce((s, r) => s + r.freight, 0), rto: rest.reduce((s, r) => s + r.rto, 0) },
    ];
  }, [couriers]);

  return (
    <ChartCard
      title="Courier-wise Cost"
      description={`Forward + RTO cost by courier${(couriers?.length ?? 0) > TOP + 1 ? ` · top ${TOP} + others` : ""}`}
      loading={loading}
      unavailable={unavailable}
      onRetry={onRetry}
      empty={!loading && rows.length === 0}
      emptyMessage="No courier cost for this range."
      height={250}
      endpoint="/api/couriers"
      action={<SourceBadge status={source} />}
      updatedAt={updatedAt}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: 0, right: 4, top: 4, bottom: 0 }} barCategoryGap="28%" accessibilityLayer>
          <defs>
            <linearGradient id="cc-forward" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#1d4ed8" />
            </linearGradient>
            <linearGradient id="cc-rto" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#818cf8" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="name" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 10.5 }} interval={0} angle={-25} textAnchor="end" height={46} tickLine={false} axisLine={false} />
          <YAxis
            stroke={CHART_AXIS.stroke}
            tick={{ ...CHART_AXIS.tick, fontSize: 11 }}
            tickFormatter={(v) => formatCurrencyINRShort(Number(v))}
            width={56}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip cursor={CHART_CURSOR} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
          <Legend verticalAlign="top" align="right" height={26} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="freight" name="Forward Cost" stackId="cost" fill="url(#cc-forward)" isAnimationActive={!reduced} animationDuration={700} />
          <Bar dataKey="rto" name="RTO Cost" stackId="cost" fill="url(#cc-rto)" radius={[5, 5, 0, 0]} isAnimationActive={!reduced} animationDuration={700} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
