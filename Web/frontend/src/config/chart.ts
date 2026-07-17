/**
 * Shared chart theme so every Recharts visualization reads as one system.
 * Colors come from the DeoDap accent tokens; categorical series cycle through
 * CHART_SERIES. Axis/grid values are tuned for the dark surface.
 */
export const CHART_COLORS = {
  blue: "#3b82f6",
  cyan: "#06b6d4",
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  purple: "#8b5cf6",
} as const;

/** Ordered categorical palette for multi-series charts (6 distinct hues). */
export const CHART_SERIES = [
  CHART_COLORS.blue,
  CHART_COLORS.cyan,
  CHART_COLORS.green,
  CHART_COLORS.amber,
  CHART_COLORS.purple,
  CHART_COLORS.red,
] as const;

/** Named segments for the courier billing stacked bar (Freight/COD/RTO/Fuel). */
export const BILLING_SEGMENTS = [
  { key: "freight", label: "Freight", color: CHART_COLORS.blue },
  { key: "cod", label: "COD", color: CHART_COLORS.green },
  { key: "rto", label: "RTO", color: CHART_COLORS.red },
  { key: "fuel", label: "Fuel", color: CHART_COLORS.amber },
] as const;

export const CHART_AXIS = {
  stroke: "#475569",
  tick: { fill: "#94a3b8", fontSize: 12 },
  grid: "#273548",
} as const;

// Tooltip styling now lives in the shared <ChartTooltip> component
// (components/shared/ChartTooltip.tsx) so item text is always light-on-dark.
