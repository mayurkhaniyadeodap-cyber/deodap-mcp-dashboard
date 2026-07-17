/**
 * Central accent palette. Components reference these instead of ad-hoc hex.
 * `ACCENT_HEX` powers per-accent KPI cards, chart series, and status colors.
 */
export type Accent = "blue" | "cyan" | "green" | "red" | "amber" | "purple" | "pink";

export const ACCENT_HEX: Record<Accent, string> = {
  blue: "#3b82f6",
  cyan: "#06b6d4",
  green: "#10b981",
  red: "#ef4444",
  amber: "#f59e0b",
  purple: "#8b5cf6",
  pink: "#ec4899",
};

/** rgba from any hex (for translucent fills — chips, glows, bar tracks). */
export function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** rgba helper for translucent accent fills (icon chips, glows). */
export function accentAlpha(accent: Accent, alpha: number): string {
  return hexAlpha(ACCENT_HEX[accent], alpha);
}
