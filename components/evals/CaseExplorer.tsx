"use client";
// OWNER: evals agent. Filterable per-case table plus a drawer with the exact snapshot sent, expected vs chosen, probabilities.
import { useMemo, useState } from "react";
import { ProbabilityBars } from "@/components/analytics/ProbabilityBars";
import { Drawer, Tabs } from "@/components/ui";
import { CATEGORY_LABELS, type EvalCategory } from "@/lib/evals/cases";
import { isCorrect, type Prediction } from "@/lib/evals/metrics";
import type { BaselineResult, CaseResult, ResultsCase } from "@/lib/evals/types";
import { ACTION_SHORT, ms, pct } from "./format";
import s from "./evals.module.css";

export type Outcome = "correct" | "accepted" | "wrong" | "failed" | "none";
type Filter = "all" | "wrong" | "ambiguous" | "disagree";

export function outcomeOf(p: Prediction | undefined): Outcome {
  if (!p) return "none";
  if (p.choice === null) return "failed";
  if (p.choice === p.expected) return "correct";
  return isCorrect(p) ? "accepted" : "wrong";
}

const OUTCOME_LABEL: Record<Outcome, string> = { correct: "Correct", accepted: "Accepted alt.", wrong: "Wrong", failed: "Call failed", none: "Not run" };
const OUTCOME_CLASS: Record<Outcome, string> = { correct: s.ok, accepted: s.alt, wrong: s.bad, failed: s.fail, none: s.fail };

export function OutcomeTag({ o }: { o: Outcome }) {
  return <span className={s.outcome}><i className={`${s.outcomeDot} ${OUTCOME_CLASS[o]}`} aria-hidden />{OUTCOME_LABEL[o]}</span>;
}

type Props = {
  cases: ResultsCase[];
  configLabel: string | null;
  predictions: Map<string, Prediction>;
  raw: Map<string, CaseResult>;
  baseline: Map<string, BaselineResult>;
  openId: string | null;
  onOpen: (id: string | null) => void;
};

export function CaseExplorer({ cases, configLabel, predictions, raw, baseline, openId, onOpen }: Props) {
  const [category, setCategory] = useState<"all" | EvalCategory>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const hasModel = predictions.size > 0;

  const rows = useMemo(() => cases.filter((c) => {
    if (category !== "all" && c.category !== category) return false;
    const p = predictions.get(c.id);
    const b = baseline.get(c.id);
    const modelOk = p ? isCorrect(p) : false;
    const rulesOk = b ? b.choice === c.expected || c.acceptable.includes(b.choice) : false;
    if (filter === "wrong") return hasModel ? !modelOk : !rulesOk;
    if (filter === "ambiguous") return c.ambiguous;
    if (filter === "disagree") return hasModel && modelOk !== rulesOk;
    return true;
  }), [cases, category, filter, predictions, baseline, hasModel]);

  const open = cases.find((c) => c.id === openId) ?? null;
  const op = open ? predictions.get(open.id) : undefined;
  const or = open ? raw.get(open.id) : undefined;
  const ob = open ? baseline.get(open.id) : undefined;
  const cats = [...new Set(cases.map((c) => c.category))];

  return (
    <>
      <div className={s.filters}>
        <Tabs
          size="sm"
          label="Filter cases"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All" },
            { value: "wrong", label: hasModel ? "Model wrong" : "Rules wrong" },
            { value: "ambiguous", label: "Ambiguous" },
            ...(hasModel ? [{ value: "disagree" as const, label: "Model vs rules differ" }] : []),
          ]}
        />
        <label className="sr-only" htmlFor="case-category">Category</label>
        <select id="case-category" className={s.select} value={category} onChange={(e) => setCategory(e.target.value as "all" | EvalCategory)}>
          <option value="all">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
        <span className={s.count}>{rows.length} of {cases.length}</span>
      </div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Case</th>
              <th>Scenario</th>
              <th>Category</th>
              <th>Expected</th>
              {hasModel ? <th>{configLabel}</th> : null}
              {hasModel ? <th className={s.numCell}>Conf.</th> : null}
              <th>Rules</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const p = predictions.get(c.id);
              const b = baseline.get(c.id);
              const o = hasModel ? outcomeOf(p) : outcomeOf(b ? { caseId: c.id, category: c.category, expected: c.expected, acceptable: c.acceptable, ambiguous: c.ambiguous, choice: b.choice, confidence: b.confidence, probabilities: b.probabilities } : undefined);
              const rulesWrong = b && !(b.choice === c.expected || c.acceptable.includes(b.choice));
              return (
                <tr key={c.id} className={`${s.rowButton} ${openId === c.id ? s.rowSelected : ""}`} onClick={() => onOpen(c.id)} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(c.id))} aria-label={`Open case ${c.id}`}>
                  <td className="num muted">{c.id}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 220 }}>{c.title}</td>
                  <td className="muted">{CATEGORY_LABELS[c.category]}</td>
                  <td className={s.choice}>{ACTION_SHORT[c.expected]}{c.acceptable.length ? <span className="muted"> / {c.acceptable.map((a) => ACTION_SHORT[a]).join(" / ")}</span> : null}</td>
                  {hasModel ? <td className={`${s.choice} ${o === "wrong" ? s.choiceWrong : ""}`}>{p?.choice ? ACTION_SHORT[p.choice] : "–"}</td> : null}
                  {hasModel ? <td className={s.numCell}>{pct(p?.confidence)}</td> : null}
                  <td className={`${s.choice} ${rulesWrong ? s.choiceWrong : ""}`}>{b ? ACTION_SHORT[b.choice] : "–"}</td>
                  <td><OutcomeTag o={o} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Drawer open={!!open} onClose={() => onOpen(null)} title={open ? `${open.id} · ${open.title}` : ""} subtitle={open ? `${CATEGORY_LABELS[open.category]}${open.ambiguous ? " · ambiguous" : ""} · rule ${open.rule}` : undefined} width={560}>
        {open ? (
          <div className={s.drawerBody}>
            <dl className={s.kv}>
              <dt>Expected</dt>
              <dd className={s.choice}>{ACTION_SHORT[open.expected]}{open.acceptable.length ? ` (also accepted: ${open.acceptable.map((a) => ACTION_SHORT[a]).join(", ")})` : ""}</dd>
              <dt>Why</dt>
              <dd>{open.reason}</dd>
              {hasModel ? (
                <>
                  <dt>{configLabel}</dt>
                  <dd><span className={s.choice}>{op?.choice ? ACTION_SHORT[op.choice] : "–"}</span> · <OutcomeTag o={outcomeOf(op)} />{or?.ok ? <span className="muted"> · {ms(or.latencyMs)} · {or.inputTokens ?? "–"} in / {or.outputTokens ?? "–"} out tokens</span> : or?.error ? <span className="muted"> · {or.error}</span> : null}</dd>
                </>
              ) : null}
              <dt>Rules baseline</dt>
              <dd className={s.choice}>{ob ? ACTION_SHORT[ob.choice] : "–"}</dd>
            </dl>

            {op?.probabilities ? (
              <div>
                <p className={s.sectionLabel}>Decisions API probabilities</p>
                <ProbabilityBars probabilities={op.probabilities} selected={op.choice ?? undefined} />
              </div>
            ) : null}

            {ob?.ruleTrace.length ? (
              <div>
                <p className={s.sectionLabel}>Rules that fired (lib/ai/decide.ts fallback)</p>
                <div className={s.trace}>{ob.ruleTrace.map((t, i) => <span key={i}>{t}</span>)}</div>
              </div>
            ) : null}

            <div>
              <p className={s.sectionLabel}>Exact snapshot sent as <code className={s.code}>input</code></p>
              <pre className={s.pre}>{JSON.stringify(open.snapshot, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
