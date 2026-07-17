/**
 * Centralized per-courier presentation: display code + accent color.
 * Components look courier style up here instead of hard-coding colors/codes.
 *
 * Keyed by the REAL live roster (display name = the MCP `shipping_company`, which
 * is the only reliable label — `courier_name` is null for every courier except
 * ShipRocket, where it holds a sub-method string). Each courier gets a fixed,
 * deterministic accent; unknown names fall back to a cycled palette. The null /
 * "(none)" courier slug surfaces as "Unassigned".
 */
export interface CourierStyle {
  code: string;
  color: string;
}

export const COURIER_STYLE: Record<string, CourierStyle> = {
  BlueDart: { code: "BLD", color: "#06b6d4" }, // cyan
  DTDC: { code: "DTDC", color: "#8b5cf6" }, // purple
  Ekart: { code: "EKT", color: "#10b981" }, // green
  Trackon: { code: "TRK", color: "#f59e0b" }, // amber
  "Shree Maruti": { code: "MRT", color: "#ef4444" }, // red
  "Amazon ATS": { code: "AMZ", color: "#ec4899" }, // pink
  Delhivery: { code: "DLV", color: "#3b82f6" }, // blue
  ShipRocket: { code: "SR", color: "#14b8a6" }, // teal
  "India Post": { code: "INP", color: "#f97316" }, // orange
  "Rapid Miles": { code: "RPM", color: "#64748b" }, // slate
  "Shree Anjani": { code: "SAJ", color: "#a855f7" }, // violet
  "Shree Mahavir": { code: "MHV", color: "#eab308" }, // yellow
  Unassigned: { code: "UNA", color: "#64748b" }, // slate/grey — null courier slug
};

/** Cycled palette for couriers not explicitly mapped (so none render blue-flat). */
const FALLBACK_PALETTE = ["#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899"];

/** Style for a courier by name. Unknown names get a distinct cycled color +
 *  a derived code (never skipped). */
export function courierStyle(name: string): CourierStyle {
  const mapped = COURIER_STYLE[name];
  if (mapped) return mapped;
  // Deterministic index from the name so the same courier always gets the same color.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const color = FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
  const code = name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "CUR";
  return { code, color };
}
