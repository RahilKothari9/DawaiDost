// OWNER: analytics agent. Display formatters for charts and tiles. Pure, locale-stable (en-IN grouping).

const intFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const dayMonthTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

/** 12345 -> "12,345" (Indian grouping for lakhs). */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return intFmt.format(Math.round(n));
}

/** Auto-compact for tiles: 1,284 / 12.9K / 4.2L-ish via Intl compact. */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n) < 10000 ? fmtInt(n) : compactFmt.format(n);
}

/** Days of stock: "∞", "0", "2.4", "16". */
export function fmtDays(days: number): string {
  if (days === Infinity) return "∞";
  if (!Number.isFinite(days)) return "—";
  if (days <= 0) return "0";
  if (days < 10) return days.toFixed(1);
  if (days >= 999) return "999+";
  return String(Math.round(days));
}

export function fmtPct(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function fmtSigned(n: number, digits = 0): string {
  if (!Number.isFinite(n) || n === 0) return "±0";
  const s = Math.abs(n).toFixed(digits);
  return n > 0 ? `+${s}` : `−${s}`;
}

export function toDate(iso: string | number | Date): Date {
  return iso instanceof Date ? iso : new Date(iso);
}

export function fmtDate(iso: string | number | Date): string {
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? "—" : dayMonth.format(d);
}

export function fmtDateTime(iso: string | number | Date): string {
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? "—" : dayMonthTime.format(d);
}

/** Relative to the simulated clock, never wall-clock time. */
export function fmtAgo(iso: string, nowIso: string): string {
  const ms = toDate(nowIso).getTime() - toDate(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const future = ms < 0;
  const m = Math.abs(ms) / 60000;
  const unit = m < 1 ? "just now" : m < 60 ? `${Math.round(m)} min` : m < 60 * 24 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  if (unit === "just now") return unit;
  return future ? `in ${unit}` : `${unit} ago`;
}

export function initials(name: string): string {
  return name
    .replace(/^(Dr|Smt|Shri|Mr|Ms)\.?\s+/i, "")
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
