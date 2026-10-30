/**
 * Shared chart theme so every Recharts visualization reads as one system.
 * Colors come from the DeoDap accent tokens; categorical series cycle through
 * CHART_SERIES. Axis/grid/tick colours are CSS-variable tokens (index.css), so the
 * same chart reads correctly in both the dark and light theme.
 */
export const CHART_COLORS = {
  /** Brand teal (matches --primary) for the dashboard's headline series. */
  brand: "#14b8a6",
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
  stroke: "hsl(var(--chart-axis))",
  tick: { fill: "hsl(var(--chart-tick))", fontSize: 12 },
  grid: "hsl(var(--chart-grid))",
} as const;

/** Bar hover cursor — a faint wash of the foreground colour, either theme. */
export const CHART_CURSOR = { fill: "hsl(var(--foreground) / 0.05)" } as const;

// Tooltip styling lives in the shared <ChartTooltip> component
// (components/shared/ChartTooltip.tsx), themed with the popover tokens.
