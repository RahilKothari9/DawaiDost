// OWNER: data agent. Display formatters. All times render in IST (Asia/Kolkata).
import { actionLabels } from "../scenario";
import { RISK_ORDER } from "./engine";
import type { DecisionAction, DecisionStatus, FacilityType, Medicine, RiskLevel, TransferStatus } from "./types";

export { RISK_ORDER };

const TZ = "Asia/Kolkata";
const MIN = 6e4, HOUR = 36e5, DAY = 864e5;

export const RISK_LABEL: Record<RiskLevel, string> = { stockout: "Stocked out", critical: "Critical", low: "Low", ok: "OK", surplus: "Surplus" };
export const RISK_SHORT: Record<RiskLevel, string> = { stockout: "Out", critical: "Crit", low: "Low", ok: "OK", surplus: "Surplus" };
export const RISK_COLOR: Record<RiskLevel, string> = {
  stockout: "var(--risk-stockout)", critical: "var(--risk-critical)", low: "var(--risk-low)", ok: "var(--risk-ok)", surplus: "var(--risk-surplus)",
};
/** Raw hex fallbacks matching app/tokens.css, for canvas/WebGL layers that cannot read CSS vars. */
export const RISK_HEX: Record<RiskLevel, string> = { stockout: "#a11d17", critical: "#dc4f1c", low: "#c98f06", ok: "#4f8162", surplus: "#1d6a86" };
export const RISK_DESCRIPTION: Record<RiskLevel, string> = {
  stockout: "Shelf is empty.",
  critical: "Runs out before a district resupply can arrive.",
  low: "Below lead time + safety buffer.",
  ok: "Covered through the next resupply.",
  surplus: "Holds safe surplus above its own reserve.",
};

export const riskLabel = (r: RiskLevel) => RISK_LABEL[r];
export const riskColor = (r: RiskLevel) => RISK_COLOR[r];
export const compareRisk = (a: RiskLevel, b: RiskLevel) => RISK_ORDER[a] - RISK_ORDER[b];
export const worstRisk = (risks: RiskLevel[]): RiskLevel => risks.reduce<RiskLevel>((w, r) => (RISK_ORDER[r] < RISK_ORDER[w] ? r : w), "surplus");

export const ACTION_LABEL: Record<DecisionAction, string> = actionLabels;
export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = { proposed: "Proposed", approved: "Approved", in_transit: "In transit", delivered: "Delivered", rejected: "Rejected" };
export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = { pending: "Awaiting approval", approved: "Approved", rejected: "Rejected", acknowledged: "Acknowledged" };
export const FACILITY_TYPE_LABEL: Record<FacilityType, string> = { WAREHOUSE: "District warehouse", DH: "District hospital", CHC: "Community health centre", PHC: "Primary health centre" };

const nf = new Intl.NumberFormat("en-IN");
export const formatNumber = (n: number) => nf.format(Math.round(n));
export const formatPercent = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`;
export const formatKm = (km: number) => `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;

export function formatHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}

/** "2.0 days", "16 days", "∞", "<0.1 days" */
export function formatDays(days: number | null | undefined, opts: { short?: boolean } = {}): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "∞";
  const v = days <= 0 ? "0" : days < 0.1 ? "<0.1" : days < 10 ? days.toFixed(1) : String(Math.round(days));
  return opts.short ? `${v}d` : `${v} ${v === "1.0" ? "day" : "days"}`;
}

/** Unit noun for a medicine: "strip", "sachet", "inhaler". */
export function unitNoun(m: Pick<Medicine, "unit">): string {
  return m.unit.split(" ")[0];
}

/** "24 strips", "1 inhaler", "300 sachets" */
export function formatUnits(qty: number, m?: Pick<Medicine, "unit">): string {
  const n = Math.round(qty);
  const noun = m ? unitNoun(m) : "unit";
  return `${formatNumber(n)} ${n === 1 ? noun : noun.endsWith("s") ? noun : `${noun}s`}`;
}

export const medicineName = (m: Pick<Medicine, "name" | "strength">) => `${m.name} ${m.strength}`;

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const weekdayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short" });

export const formatIstTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatIstDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatIstDateTime = (iso: string) => `${formatIstDate(iso)}, ${formatIstTime(iso)}`;
export const formatIstWeekday = (iso: string) => weekdayFmt.format(new Date(iso));
export const formatClock = (iso: string) => `${formatIstWeekday(iso)} ${formatIstDate(iso)} · ${formatIstTime(iso)} IST`;

const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * HOUR).toISOString().slice(0, 10);

/** Relative to the simulated clock: "just now", "12 min ago", "3 h ago", "Yesterday, 17:10", "Mon, 09:00", "in 2 h". */
export function formatRelative(iso: string, now: string): string {
  const diff = new Date(now).getTime() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  if (abs < MIN) return "just now";
  if (diff < 0) return abs < HOUR ? `in ${Math.round(abs / MIN)} min` : abs < DAY ? `in ${formatHours(abs / HOUR)}` : `in ${Math.round(abs / DAY)} days`;
  if (abs < HOUR) return `${Math.round(abs / MIN)} min ago`;
  if (abs < 12 * HOUR || istDay(iso) === istDay(now)) return `${Math.floor(abs / HOUR)} h ago`;
  const yesterday = istDay(new Date(new Date(now).getTime() - DAY).toISOString());
  if (istDay(iso) === yesterday) return `Yesterday, ${formatIstTime(iso)}`;
  if (abs < 6 * DAY) return `${formatIstWeekday(iso)}, ${formatIstTime(iso)}`;
  return `${Math.round(abs / DAY)} days ago`;
}

/** "Today", "Tomorrow", "in 3 days", "12 Oct" for a projected ISO date. */
export function formatProjectedDate(isoDate: string | null, now: string): string {
  if (!isoDate) return "Not projected";
  const days = Math.round((Date.parse(isoDate) - Date.parse(istDay(now))) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `in ${days} days`;
  return formatIstDate(`${isoDate}T06:30:00Z`);
}

export const formatConfidence = (c: number) => c.toFixed(2);
