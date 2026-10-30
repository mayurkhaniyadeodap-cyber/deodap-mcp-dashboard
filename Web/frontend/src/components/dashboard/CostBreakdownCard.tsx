import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartTooltip } from "@/components/shared/ChartTooltip";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { CHART_AXIS, CHART_COLORS, CHART_CURSOR } from "@/config/chart";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { CourierBillingResponse } from "@/types/api";
import { formatCurrencyINR, formatCurrencyINRShort, formatNumber } from "@/utils/format";
import { badgeFromSource } from "@/utils/source";

// Forward cost BREAKDOWN — sampled from list_orders rate_summary (a different
// population from the courier cost chart, so it lives in its own card). Fuel/other
// are always ₹0 and folded into the all-inclusive base freight → never their own
// series (there's no live Fuel source).
const SEGMENTS = [
  { key: "base_freight", label: "Base Freight", color: CHART_COLORS.brand },
  { key: "gst", label: "GST", color: CHART_COLORS.amber },
  { key: "cod_charges", label: "COD Charges", color: CHART_COLORS.green },
] as const;

interface Props {
  data: CourierBillingResponse | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  className?: string;
}

export function CostBreakdownCard({ data, loading, failed, onRetry, className }: Props) {
  const reduced = useReducedMotion();
  const sampleLine = data
    ? data.is_full
      ? `All ${formatNumber(data.sample_size)} shipments`
      : `Sample of ${formatNumber(data.sample_size)} of ${formatNumber(data.total_matched)} shipments`
    : "Sampled forward cost components per courier";

  return (
    <ChartCard
      title={`Forward Cost Breakdown${data && !data.is_full ? " · Sampled" : ""}`}
      description={`${sampleLine} · forward ₹ only (RTO not added in) · Fuel is inside Base Freight`}
      loading={loading}
      loadingMessage="Sampling rate_summary components (~7s)…"
      unavailable={failed || data?.source === "unavailable"}
      onRetry={onRetry}
      empty={!loading && !!data && data.rows.length === 0}
      height={340}
      endpoint="/api/dashboard/courier-billing"
      action={<SourceBadge status={failed ? "unavailable" : badgeFromSource(data?.source)} />}
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data?.rows ?? []} margin={{ left: 4, right: 8, top: 4 }} accessibilityLayer>
          <CartesianGrid stroke={CHART_AXIS.grid} vertical={false} />
          <XAxis dataKey="courier" stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} tickLine={false} />
          <YAxis stroke={CHART_AXIS.stroke} tick={{ ...CHART_AXIS.tick, fontSize: 11 }} tickFormatter={(v) => formatCurrencyINRShort(Number(v))} width={72} tickLine={false} />
          <Tooltip cursor={CHART_CURSOR} content={<ChartTooltip valueFormatter={(v) => formatCurrencyINR(v)} />} />
          <Legend verticalAlign="top" align="right" height={28} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {SEGMENTS.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="breakdown"
              fill={s.color}
              radius={i === SEGMENTS.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              isAnimationActive={!reduced}
              animationDuration={700}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
