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

/**
 * Short Indian-unit currency for headline figures: ₹12.4L, ₹1.2Cr (below ₹1 lakh
 * the full amount is shown). Display only — callers keep the exact value and show it
 * alongside (KPI cards print the full amount under the headline).
 */
export function formatCurrencyINRShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const short = (n: number) => n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, "");
  if (abs >= 1e7) return `${sign}₹${short(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${short(abs / 1e5)}L`;
  return formatCurrencyINR(value);
}

/** Short Indian-unit count for compact labels: 1.30L, 2.4Cr (below 1 lakh: full). */
export function formatNumberShort(value: number): string {
  const abs = Math.abs(value);
  const short = (n: number) => n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, "");
  if (abs >= 1e7) return `${short(value / 1e7)}Cr`;
  if (abs >= 1e5) return `${short(value / 1e5)}L`;
  return formatNumber(value);
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

const dayMonthFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
});

/** 07 Jul (IST) — compact chart-axis date. */
export function formatDayMonthIST(input: string | number | Date): string {
  return dayMonthFormatter.format(toDate(input));
}

/** 07 Jul 2026, 03:45 pm (IST). Naive backend datetimes are treated as UTC. */
export function formatDateTimeIST(input: string | number | Date): string {
  return dateTimeFormatter.format(toDate(input));
}

/** Relative "Xs / Xm / Xh ago" from an epoch-ms timestamp. */
export function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
