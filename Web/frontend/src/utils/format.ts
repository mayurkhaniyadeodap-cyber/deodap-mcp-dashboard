/**
 * Formatting helpers. Currency uses Indian grouping (lakh/crore); dates render
 * in IST (Asia/Kolkata) regardless of the viewer's timezone.
 */

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-IN");

/** ₹12,34,567 — full amount with Indian (lakh) grouping. */
export function formatCurrencyINR(value: number): string {
  return inrFormatter.format(value);
}

/**
 * FULL Indian-format currency — no Cr/L/K abbreviations (e.g. ₹1,39,00,000).
 * Kept as an alias of formatCurrencyINR so every existing call site (KPI cards,
 * chart axes, tables, tooltips) shows full amounts consistently.
 */
export function formatCurrencyINRCompact(value: number): string {
  return formatCurrencyINR(value);
}

/** 12,34,567 — plain number with Indian grouping. */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

/** FULL Indian-format integer — no Cr/L/K abbreviations (alias of formatNumber). */
export function formatNumberCompact(value: number): string {
  return formatNumber(value);
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`;
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** 07 Jul 2026 (IST). Accepts an ISO string, epoch ms, or Date. */
export function formatDateIST(input: string | number | Date): string {
  return dateFormatter.format(new Date(input));
}

/** 07 Jul 2026, 03:45 pm (IST). */
export function formatDateTimeIST(input: string | number | Date): string {
  return dateTimeFormatter.format(new Date(input));
}
