import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { ChartCard } from "@/components/shared/ChartCard";
import { SourceBadge } from "@/components/shared/SourceBadge";
import { courierStyle } from "@/config/couriers";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/services/meta.service";
import type { DashboardResponse } from "@/types/api";
import { formatNumber, formatNumberShort } from "@/utils/format";

const TOP = 6;
const OTHERS_COLOR = "#94a3b8"; // slate — the merged "Others" slice

interface Props {
  distribution: DashboardResponse["distribution"] | undefined;
  loading: boolean;
  unavailable: boolean;
  onRetry: () => void;
  source?: SourceStatus;
  updatedAt?: number;
  className?: string;
}

/**
 * Share of shipments by courier: donut + legend with shares. Hovering (or focusing) a
 * slice or legend row shows that courier in the donut's centre — no floating tooltip
 * over the total.
 */
export function ShipmentDistributionCard({ distribution, loading, unavailable, onRetry, source, updatedAt, className }: Props) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<string | null>(null);

  // Dedupe by name, then Top 6 couriers + "Others" so donut and legend stay compact.
  const { slices, total } = useMemo(() => {
    const merged = Object.values(
      (distribution ?? []).reduce<Record<string, { name: string; value: number }>>((acc, d) => {
        const name = String(d.name);
        (acc[name] ??= { name, value: 0 }).value += Number(d.value ?? 0);
        return acc;
      }, {}),
    ).sort((a, b) => b.value - a.value);
    const othersValue = merged.slice(TOP).reduce((s, d) => s + d.value, 0);
    const list = othersValue > 0 ? [...merged.slice(0, TOP), { name: "Others", value: othersValue }] : merged;
    return { slices: list, total: list.reduce((s, d) => s + d.value, 0) };
  }, [distribution]);
  const color = (name: string) => (name === "Others" ? OTHERS_COLOR : courierStyle(name).color);
  const hovered = active ? slices.find((d) => d.name === active) : undefined;
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  return (
    <ChartCard
      title="Shipment Distribution"
      description="By courier"
      loading={loading}
      unavailable={unavailable}
      onRetry={onRetry}
      empty={!loading && total === 0}
      emptyMessage="No shipments in this range."
      height={250}
      endpoint="/api/dashboard"
      action={<SourceBadge status={source} />}
      updatedAt={updatedAt}
      className={className}
    >
      <div className="flex h-full items-center gap-4">
        <div className="relative aspect-square h-full max-h-[210px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="62%"
                outerRadius="92%"
                paddingAngle={2}
                stroke="none"
                isAnimationActive={!reduced}
                animationDuration={700}
                onMouseEnter={(d: { name?: string }) => setActive(d.name ?? null)}
                onMouseLeave={() => setActive(null)}
              >
                {slices.map((d) => (
                  <Cell key={d.name} fill={color(d.name)} opacity={active && active !== d.name ? 0.35 : 1} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {/* Centre: the hovered courier, else the total (sum of the slices drawn). */}
          <div aria-live="polite" className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            {hovered ? (
              <div key={hovered.name} className="max-w-[58%] animate-fade-in">
                <div className="truncate text-[11px] font-semibold" style={{ color: color(hovered.name) }}>
                  {hovered.name}
                </div>
                <div className="text-lg font-bold tabular-nums leading-tight">{formatNumber(hovered.value)}</div>
                <div className="text-[11px] text-muted-foreground">{share(hovered.value).toFixed(1)}% of shipments</div>
              </div>
            ) : (
              <div title={`${formatNumber(total)} shipments`} className="animate-fade-in">
                <div className="text-xl font-bold tabular-nums leading-none">{formatNumberShort(total)}</div>
                <div className="mt-1 text-[11px] font-medium text-muted-foreground">Total Shipments</div>
              </div>
            )}
          </div>
        </div>

        {/* Legend: name · share (count on hover / in the tooltip). */}
        <ul className="min-w-0 flex-1 space-y-2 text-[13px]">
          {slices.map((d) => (
            <li
              key={d.name}
              tabIndex={0}
              aria-label={`${d.name}: ${formatNumber(d.value)} shipments, ${share(d.value).toFixed(1)}%`}
              onMouseEnter={() => setActive(d.name)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(d.name)}
              onBlur={() => setActive(null)}
              className={cn(
                "flex cursor-default items-center gap-2 rounded px-1 transition-opacity focus-visible:ring-offset-0",
                active && active !== d.name && "opacity-50",
              )}
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color(d.name) }} />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="font-semibold tabular-nums">{Math.round(share(d.value))}%</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
