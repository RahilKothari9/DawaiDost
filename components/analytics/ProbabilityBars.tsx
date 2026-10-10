"use client";
// OWNER: analytics agent. Decisions API probability readout across the four fixed actions.
import { Check } from "lucide-react";
import { actionChoices, actionLabels, type DecisionAction } from "@/lib/scenario";
import { fmtPct } from "@/lib/analytics/format";
import s from "./bits.module.css";

export type ProbabilityBarsProps = {
  probabilities: Record<DecisionAction, number>;
  selected?: DecisionAction;
  compact?: boolean;
  /** Order by probability (desc) instead of the fixed action order. */
  sorted?: boolean;
  className?: string;
};

export function ProbabilityBars({ probabilities, selected, compact = false, sorted = false, className }: ProbabilityBarsProps) {
  const actions = actionChoices.map((c) => c.value);
  const order = sorted ? [...actions].sort((a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0)) : actions;
  return (
    <ul className={[s.probs, compact && s.probsCompact, className].filter(Boolean).join(" ")} aria-label="Decision probabilities by action">
      {order.map((a) => {
        const p = Math.max(0, Math.min(1, probabilities[a] ?? 0));
        const isSel = a === selected;
        return (
          <li key={a} className={s.probRow} data-selected={isSel} aria-label={`${actionLabels[a]}: ${fmtPct(p)}${isSel ? ", selected" : ""}`}>
            <span className={s.probLabel}>
              {isSel ? <Check className={s.probTick} aria-hidden strokeWidth={3} /> : <i style={{ width: 12, flex: "none" }} aria-hidden />}
              <span>{actionLabels[a]}</span>
            </span>
            <span className={s.probTrack} aria-hidden>
              <span className={s.probFill} style={{ width: `${p * 100}%` }} />
            </span>
            <span className={s.probValue} aria-hidden>{fmtPct(p)}</span>
          </li>
        );
      })}
    </ul>
  );
}
