// OWNER: escalations agent. Escalation lifecycle, persisted as "escalation" timeline events so it survives route
// changes and appears in the activity log. The timeline is the source of truth; this module only encodes and replays it.
import type { DecisionRecord, TimelineEvent } from "../district/types";

export type EscalationStage = "draft" | "sent" | "acknowledged" | "scheduled" | "resolved";

export const STAGES: EscalationStage[] = ["draft", "sent", "acknowledged", "scheduled", "resolved"];

export const STAGE_LABEL: Record<EscalationStage, string> = {
  draft: "Draft",
  sent: "Sent to state",
  acknowledged: "Acknowledged",
  scheduled: "Supply scheduled",
  resolved: "Resolved",
};

/** Verb on the button that moves an escalation into this stage. */
export const STAGE_ACTION: Record<EscalationStage, string> = {
  draft: "Open escalation",
  sent: "Mark sent",
  acknowledged: "Record acknowledgement",
  scheduled: "Record dispatch date",
  resolved: "Mark resolved",
};

export type StageEntry = { stage: EscalationStage; at: string; actor: string; note?: string; eventId: string };

export type Escalation = {
  id: string;
  medicineId: string;
  stage: EscalationStage;
  openedAt: string;
  updatedAt: string;
  history: StageEntry[]; // oldest first
  decisionIds: string[]; // linked escalate_supply_gap decisions
  memoRef?: string;
};

const PREFIX = "escalation";

/** Timeline ids look like `escalation|<escalationId>|<stage>|<nonce>`; escalation ids never contain "|". */
export function escalationEventId(escalationId: string, stage: EscalationStage, nonce: string): string {
  return [PREFIX, escalationId, stage, nonce].join("|");
}

export function parseEscalationEventId(id: string): { escalationId: string; stage: EscalationStage } | null {
  const parts = id.split("|");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const stage = parts[2] as EscalationStage;
  if (!STAGES.includes(stage)) return null;
  return { escalationId: parts[1], stage };
}

export function newEscalationId(medicineId: string, now: string, nonce: string): string {
  return `esc-${medicineId}-${now.slice(0, 10).replaceAll("-", "")}-${nonce}`;
}

export function nextStage(stage: EscalationStage): EscalationStage | null {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

/** Memo reference printed on the letter: DHO/<district>/ESC/<yyyymmdd>/<medicine>. */
export function memoReference(district: string, escalationId: string, medicineId: string, at: string): string {
  const tail = escalationId.split("-").pop() ?? "";
  return `DHO/${district.toUpperCase().slice(0, 3)}/ESC/${at.slice(0, 10).replaceAll("-", "")}/${medicineId.toUpperCase()}-${tail.toUpperCase()}`;
}

/** Decision ids are stored in an event's detail line as `decisions: a,b`. */
const DECISIONS_RE = /decisions: ([\w,.-]+)/;
const MEMO_RE = /ref: (\S+)/;

/**
 * Replays escalation events (timeline is newest first) into escalations, newest opened first.
 * Linked decisions: those listed on the events plus every escalate_supply_gap decision for the same medicine
 * created up to the time the escalation was resolved.
 */
export function deriveEscalations(timeline: TimelineEvent[], decisions: DecisionRecord[] = []): Escalation[] {
  const byId = new Map<string, Escalation>();
  for (let i = timeline.length - 1; i >= 0; i--) {
    const ev = timeline[i];
    if (ev.kind !== "escalation") continue;
    const parsed = parseEscalationEventId(ev.id);
    if (!parsed || !ev.medicineId) continue;
    const entry: StageEntry = { stage: parsed.stage, at: ev.at, actor: ev.actor, note: ev.detail, eventId: ev.id };
    let esc = byId.get(parsed.escalationId);
    if (!esc) {
      esc = { id: parsed.escalationId, medicineId: ev.medicineId, stage: parsed.stage, openedAt: ev.at, updatedAt: ev.at, history: [], decisionIds: [] };
      byId.set(parsed.escalationId, esc);
    }
    esc.history.push(entry);
    if (STAGES.indexOf(parsed.stage) >= STAGES.indexOf(esc.stage)) esc.stage = parsed.stage;
    esc.updatedAt = ev.at;
    const ids = ev.detail?.match(DECISIONS_RE)?.[1]?.split(",").filter(Boolean) ?? [];
    for (const d of ids) if (!esc.decisionIds.includes(d)) esc.decisionIds.push(d);
    const ref = ev.detail?.match(MEMO_RE)?.[1];
    if (ref) esc.memoRef = ref;
  }
  const list = [...byId.values()];
  for (const esc of list) {
    const resolvedAt = esc.stage === "resolved" ? esc.updatedAt : null;
    for (const d of linkedDecisions(decisions, esc.medicineId, resolvedAt)) if (!esc.decisionIds.includes(d.id)) esc.decisionIds.push(d.id);
  }
  return list.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

/** escalate_supply_gap decisions for one medicine, newest first; optionally only those created before `until`. */
export function linkedDecisions(decisions: DecisionRecord[], medicineId: string, until: string | null = null): DecisionRecord[] {
  return decisions.filter((d) => d.action === "escalate_supply_gap" && d.medicineId === medicineId && (!until || d.createdAt <= until));
}

/** The open (not resolved) escalation for a medicine, if any. */
export function activeEscalation(escalations: Escalation[], medicineId: string): Escalation | undefined {
  return escalations.find((e) => e.medicineId === medicineId && e.stage !== "resolved");
}

export function stageEvent(opts: {
  escalationId: string;
  medicineId: string;
  stage: EscalationStage;
  at: string;
  actor: string;
  title: string;
  detail?: string;
  nonce: string;
}): TimelineEvent {
  return {
    id: escalationEventId(opts.escalationId, opts.stage, opts.nonce),
    at: opts.at,
    kind: "escalation",
    medicineId: opts.medicineId,
    title: opts.title,
    detail: opts.detail,
    actor: opts.actor,
  };
}
