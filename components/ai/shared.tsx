"use client";
// OWNER: ai agent. Small shared pieces for the AI decision layer UI.
import { AlertTriangle, ClipboardCheck, FileText, Loader2, Truck } from "lucide-react";
import { useCallback, useState } from "react";
import { actionLabels } from "@/lib/scenario";
import { buildTransferForDecision } from "@/lib/ai/transfer";
import { isAiDecision, type AiSource, type UrgencyLevel } from "@/lib/ai/types";
import { useDistrict } from "@/lib/district/store";
import type { DecisionAction, DecisionRecord } from "@/lib/district/types";
import s from "./ai.module.css";

export const ACTIONS: DecisionAction[] = ["verify_count", "transfer_surplus", "draft_indent", "escalate_supply_gap"];

export const ACTION_COLOR: Record<DecisionAction, string> = {
  verify_count: "var(--risk-low)",
  transfer_surplus: "var(--accent)",
  draft_indent: "var(--risk-surplus)",
  escalate_supply_gap: "var(--risk-stockout)",
};

const ACTION_ICON: Record<DecisionAction, typeof Truck> = {
  verify_count: ClipboardCheck,
  transfer_surplus: Truck,
  draft_indent: FileText,
  escalate_supply_gap: AlertTriangle,
};

export const URGENCY_LABEL: Record<UrgencyLevel, string> = { today: "Today", this_week: "This week", monitor: "Monitor" };

export const pct = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? `${Math.round(x * 100)}%` : "–");
export const fmtMs = (ms: number | undefined) => (typeof ms !== "number" ? "–" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function SourceBadge({ source, reason, title }: { source: AiSource; reason?: string; title?: string }) {
  const live = source === "live";
  return (
    <span className={`${s.source} ${live ? s.sourceLive : s.sourceFallback}`} title={title ?? (live ? "Answered by the live OpenAI API" : `Deterministic fallback${reason ? ` (${reason.replace(/_/g, " ")})` : ""}: same stock rules, no model`)}>
      <i aria-hidden />
      {live ? "Live" : "Demo fallback"}
    </span>
  );
}

export function ActionChip({ action, short }: { action: DecisionAction; short?: boolean }) {
  const Icon = ACTION_ICON[action];
  const label = actionLabels[action];
  return (
    <span className={s.chip} style={{ ["--chip" as string]: ACTION_COLOR[action] }} title={action}>
      <Icon size={13} strokeWidth={2.2} aria-hidden />
      {short ? label.split(" ")[0] : label}
    </span>
  );
}

export function UrgencyChip({ level }: { level: UrgencyLevel }) {
  return <span className={`${s.urgency} ${s[`urgency_${level}`]}`}>{URGENCY_LABEL[level]}</span>;
}

/** One stacked bar across the four actions: a glanceable probability fingerprint. */
export function MiniProbStack({ probabilities, label }: { probabilities: Record<DecisionAction, number>; label?: string }) {
  const total = ACTIONS.reduce((t, a) => t + (probabilities[a] ?? 0), 0) || 1;
  return (
    <span className={s.stack} role="img" aria-label={label ?? ACTIONS.map((a) => `${actionLabels[a]} ${pct(probabilities[a])}`).join(", ")}>
      {ACTIONS.map((a) => (
        <span key={a} style={{ width: `${((probabilities[a] ?? 0) / total) * 100}%`, background: ACTION_COLOR[a] }} title={`${actionLabels[a]}: ${pct(probabilities[a])}`} />
      ))}
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className={s.spinner} aria-hidden />;
}

export function LangToggle({ lang, onChange }: { lang: "en" | "hi"; onChange: (l: "en" | "hi") => void }) {
  return (
    <span className={s.langToggle} role="group" aria-label="Language">
      <button type="button" aria-pressed={lang === "en"} onClick={() => onChange("en")}>EN</button>
      <button type="button" aria-pressed={lang === "hi"} onClick={() => onChange("hi")} lang="hi">हिं</button>
    </span>
  );
}

export function latestDecision(decisions: DecisionRecord[], facilityId: string, medicineId: string): DecisionRecord | undefined {
  return decisions.find((d) => d.facilityId === facilityId && d.medicineId === medicineId);
}

export function urgencyOf(d: DecisionRecord): UrgencyLevel | null {
  if (isAiDecision(d)) return d.ai.urgencyLevel;
  if (typeof d.urgency === "number") return d.urgency > 0.66 ? "today" : d.urgency > 0.33 ? "this_week" : "monitor";
  return null;
}

/** Officer actions on a decision. Approving executes the chosen action through store actions. */
export function useDecisionActions() {
  const { state, dispatch } = useDistrict();
  const [indentFor, setIndentFor] = useState<{ facilityId: string; medicineId: string; decisionId: string } | null>(null);
  const officer = `${state.district.officer.name} (DHO)`;

  const approve = useCallback((d: DecisionRecord): { ok: boolean; message: string } => {
    const fac = state.facilities.find((f) => f.id === d.facilityId);
    const med = state.medicines.find((m) => m.id === d.medicineId);
    const where = `${fac?.name ?? d.facilityId} · ${med ? `${med.name} ${med.strength}` : d.medicineId}`;
    switch (d.action) {
      case "transfer_surplus": {
        const t = buildTransferForDecision(state, d, state.now);
        if (!t) return { ok: false, message: "No donor can safely send stock any more. Draft an indent instead." };
        dispatch({ type: "PROPOSE_TRANSFER", transfer: t });
        dispatch({ type: "SET_TRANSFER_STATUS", transferId: t.id, status: "approved" });
        dispatch({ type: "SET_DECISION_STATUS", decisionId: d.id, status: "approved", actor: officer });
        const from = state.facilities.find((f) => f.id === t.fromId)?.name ?? t.fromId;
        return { ok: true, message: `Transfer approved: ${t.quantity} ${med?.unit ?? "units"} from ${from}.` };
      }
      case "verify_count": {
        // The store's approval reducer flags the record and logs the recount request.
        dispatch({ type: "SET_DECISION_STATUS", decisionId: d.id, status: "approved", actor: officer });
        return { ok: true, message: `Recount requested at ${fac?.name ?? d.facilityId}.` };
      }
      case "draft_indent": {
        setIndentFor({ facilityId: d.facilityId, medicineId: d.medicineId, decisionId: d.id });
        return { ok: true, message: "Indent draft opened." };
      }
      case "escalate_supply_gap": {
        // The store's approval reducer writes the escalation event with district totals.
        dispatch({ type: "SET_DECISION_STATUS", decisionId: d.id, status: "approved", actor: officer });
        return { ok: true, message: `Supply gap escalated: ${where}.` };
      }
    }
  }, [state, dispatch, officer]);

  const reject = useCallback((d: DecisionRecord) => dispatch({ type: "SET_DECISION_STATUS", decisionId: d.id, status: "rejected", actor: officer }), [dispatch, officer]);
  const acknowledge = useCallback((d: DecisionRecord) => dispatch({ type: "SET_DECISION_STATUS", decisionId: d.id, status: "acknowledged", actor: officer }), [dispatch, officer]);

  const onIndentDone = useCallback((status: "approved" | "submitted") => {
    if (indentFor) {
      const d = state.decisions.find((x) => x.id === indentFor.decisionId);
      if (d && d.status === "pending") dispatch({ type: "SET_DECISION_STATUS", decisionId: d.id, status: "approved", actor: officer });
    }
    if (status === "submitted") setIndentFor(null);
  }, [indentFor, state.decisions, dispatch, officer]);

  return { approve, reject, acknowledge, indentFor, closeIndent: () => setIndentFor(null), onIndentDone, officer };
}
