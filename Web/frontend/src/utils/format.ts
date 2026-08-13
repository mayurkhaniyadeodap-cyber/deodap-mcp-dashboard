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

/**
 * Build a Date, treating a timezone-naive ISO *datetime* as UTC. Backend datetimes
 * are UTC but serialized WITHOUT a marker (datetime.utcnow() → "2026-08-13T04:22:59"),
 * which `new Date()` would otherwise parse as LOCAL time and mis-convert. We append
 * "Z" so the Asia/Kolkata formatters convert correctly — no hardcoded +5:30. Epoch
 * numbers, Date objects, date-only strings, and already-zoned strings are untouched.
 */
function toDate(input: string | number | Date): Date {
  if (
    typeof input === "string" &&
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(input) && // has a time component
    !/[zZ]|[+-]\d{2}:?\d{2}$/.test(input) // …but no timezone marker
  ) {
    return new Date(`${input.replace(" ", "T")}Z`);
  }
  return new Date(input);
}

/** 07 Jul 2026 (IST). Accepts an ISO string, epoch ms, or Date. */
export function formatDateIST(input: string | number | Date): string {
  return dateFormatter.format(toDate(input));
}

/** 07 Jul 2026, 03:45 pm (IST). Naive backend datetimes are treated as UTC. */
export function formatDateTimeIST(input: string | number | Date): string {
  return dateTimeFormatter.format(toDate(input));
}
