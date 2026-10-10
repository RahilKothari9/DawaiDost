import type { DecisionAction, RiskLevel, TimelineKind, TransferStatus } from "@/lib/district/types";

const TZ = "Asia/Kolkata";

export function fmtClock(iso: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { day, time };
}

export function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso));
}

/** "3h ago" relative to the simulated clock. */
export function fmtAgo(iso: string, nowIso: string) {
  const mins = Math.round((new Date(nowIso).getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function fmtDays(days: number) {
  if (!Number.isFinite(days)) return "∞";
  if (days < 10) return days.toFixed(1);
  return Math.round(days).toString();
}

export function fmtPct(p: number) {
  return `${Math.round(p * 100)}%`;
}

export const ACTION_LABEL: Record<DecisionAction, string> = {
  verify_count: "Verify the count",
  transfer_surplus: "Transfer nearby surplus",
  draft_indent: "Draft a district indent",
  escalate_supply_gap: "Escalate the supply gap",
};

export const ACTION_ORDER: DecisionAction[] = ["verify_count", "transfer_surplus", "draft_indent", "escalate_supply_gap"];

export const ACTION_WHEN: Record<DecisionAction, string> = {
  verify_count: "The latest report is uncertain or does not match expected use. Ask the pharmacist to count again.",
  transfer_surplus: "A nearby clinic holds safe surplus above its own reserve. Move it before the shelf empties.",
  draft_indent: "No local surplus can cover the gap. Prepare a consumption-based order to the district store.",
  escalate_supply_gap: "The district itself is short and resupply is delayed. Raise it with evidence and a timestamp.",
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  stockout: "Stocked out",
  critical: "Critical",
  low: "Low",
  ok: "Healthy",
  surplus: "Surplus",
};

export const TRANSFER_LABEL: Record<TransferStatus, string> = {
  proposed: "Proposed",
  approved: "Approved",
  in_transit: "In transit",
  delivered: "Delivered",
  rejected: "Rejected",
};

export const KIND_LABEL: Record<TimelineKind, string> = {
  voice_report: "Voice report",
  count_verified: "Count verified",
  recount_requested: "Recount requested",
  alert: "Alert",
  decision: "Decision",
  approval: "Approval",
  rejection: "Rejection",
  transfer_update: "Transfer",
  indent: "Indent",
  escalation: "Escalation",
  briefing: "Briefing",
  system: "System",
};

export const RISK_RANK: Record<RiskLevel, number> = { stockout: 0, critical: 1, low: 2, ok: 3, surplus: 4 };
