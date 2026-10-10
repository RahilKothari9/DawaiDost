"use client";
// OWNER: ai agent. Deep view of one Decisions API decision: the choice and its probabilities, every signal from
// the multi-question call, a post-hoc bilingual rationale, what-if re-runs, the exact snapshot, and the audit trail.
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronRight, Eye, FlaskConical, History, Info, MessageSquareText, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProbabilityBars } from "@/components/analytics/ProbabilityBars";
import { Button, Drawer } from "@/components/ui";
import { requestDistrictDecision, requestExplain } from "@/lib/ai/client";
import { applyCounterfactual, buildDecisionFacts, COUNTERFACTUALS, isDecisionFacts, type CounterfactualKind, type DecisionFacts } from "@/lib/ai/facts";
import { isAiDecision, URGENCY_LEVELS, type AiDecisionRecord, type ExplainResult } from "@/lib/ai/types";
import { actionLabels } from "@/lib/scenario";
import { useDistrict } from "@/lib/district/store";
import type { DecisionRecord } from "@/lib/district/types";
import { IndentDraft } from "./IndentDraft";
import { ACTION_COLOR, ACTIONS, ActionChip, fmtMs, LangToggle, latestDecision, pct, SourceBadge, Spinner, URGENCY_LABEL, UrgencyChip, urgencyOf, useDecisionActions } from "./shared";
import a from "./ai.module.css";
import s from "./DecisionCard.module.css";

export type DecisionCardProps = {
  facilityId: string;
  medicineId: string;
  /** Show this decision instead of the latest one for the pair. */
  decisionId?: string;
  /** Hide the approve / reject controls (read-only embeds). */
  readOnly?: boolean;
};

const explainCache = new Map<string, ExplainResult>();
const AUDIT_KINDS = new Set(["decision", "approval", "rejection", "transfer_update", "recount_requested", "escalation", "indent", "count_verified", "voice_report"]);

type WhatIf = { kind: CounterfactualKind; loading: boolean; result?: AiDecisionRecord; error?: string };

export function DecisionCard({ facilityId, medicineId, decisionId, readOnly }: DecisionCardProps) {
  const { state, dispatch, getAssessment } = useDistrict();
  const { approve, reject, acknowledge, indentFor, closeIndent, onIndentDone } = useDecisionActions();
  const reduce = useReducedMotion();
  const facility = state.facilities.find((f) => f.id === facilityId);
  const medicine = state.medicines.find((m) => m.id === medicineId);
  const assessment = getAssessment(facilityId, medicineId);
  const decision: DecisionRecord | undefined = decisionId ? state.decisions.find((d) => d.id === decisionId) : latestDecision(state.decisions, facilityId, medicineId);
  const ai = isAiDecision(decision) ? decision.ai : null;

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [, bump] = useState(0);
  const [explainError, setExplainError] = useState<Record<string, string>>({});
  const [whatIf, setWhatIf] = useState<WhatIf | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);

  const facts: DecisionFacts | null = useMemo(() => {
    if (decision && isDecisionFacts(decision.snapshot)) return decision.snapshot;
    try {
      return buildDecisionFacts(state, facilityId, medicineId);
    } catch {
      return null;
    }
  }, [decision, state, facilityId, medicineId]);

  const donorName = (id: string | null | undefined) => (id ? state.facilities.find((f) => f.id === id)?.name ?? id : null);

  // Post-hoc rationale: fetched once per decision id; every state update happens after the request settles.
  const explanation = decision ? explainCache.get(decision.id) : undefined;
  useEffect(() => {
    if (!decision || explainCache.has(decision.id)) return;
    const ctrl = new AbortController();
    const id = decision.id;
    requestExplain({
      decision: { action: decision.action, confidence: decision.confidence, probabilities: decision.probabilities, source: decision.source, urgencyLevel: urgencyOf(decision) ?? undefined, donorId: ai?.donor?.facilityId ?? null, donorName: donorName(ai?.donor?.facilityId), recountProbability: ai?.recountProbability },
      snapshot: decision.snapshot && typeof decision.snapshot === "object" ? decision.snapshot : {},
    }, ctrl.signal)
      .then((r) => { explainCache.set(id, r); bump((n) => n + 1); })
      .catch((e: unknown) => { if (!ctrl.signal.aborted) setExplainError((m) => ({ ...m, [id]: e instanceof Error ? e.message : "failed" })); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the decision id only
  }, [decision?.id]);

  async function run() {
    setRunning(true);
    setRunError(null);
    setWhatIf(null);
    try {
      const d = await requestDistrictDecision({ facilityId, medicineId, snapshot: buildDecisionFacts(state, facilityId, medicineId) });
      dispatch({ type: "ADD_DECISION", decision: d });
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setRunning(false);
    }
  }

  async function runWhatIf(kind: CounterfactualKind) {
    if (!facts) return;
    setWhatIf({ kind, loading: true });
    try {
      const result = await requestDistrictDecision({ facilityId, medicineId, snapshot: applyCounterfactual(facts, kind) });
      setWhatIf({ kind, loading: false, result });
    } catch (e) {
      setWhatIf({ kind, loading: false, error: e instanceof Error ? e.message : "failed" });
    }
  }

  const audit = useMemo(
    () => state.timeline.filter((e) => e.facilityId === facilityId && e.medicineId === medicineId && AUDIT_KINDS.has(e.kind)).slice(0, 8),
    [state.timeline, facilityId, medicineId],
  );

  if (!facility || !medicine) return <div className={s.card}><p className={s.pad}>Unknown facility or medicine.</p></div>;

  const days = assessment && Number.isFinite(assessment.daysOfStock) ? assessment.daysOfStock : null;
  const urgency = decision ? urgencyOf(decision) : null;
  const sorted = decision ? [...ACTIONS].sort((x, y) => decision.probabilities[y] - decision.probabilities[x]) : [];
  const margin = decision ? decision.probabilities[sorted[0]] - decision.probabilities[sorted[1]] : 1;

  return (
    <article className={s.card} aria-label={`Decision for ${facility.name}, ${medicine.name}`}>
      <header className={s.head}>
        <div className={s.headMain}>
          <p className={s.kicker}><Sparkles size={12} aria-hidden /> Decisions API · {facility.block}</p>
          <h3 className={s.title}>{facility.name}</h3>
          <p className={s.sub}>
            {medicine.name} {medicine.strength} · <b className={a.num}>{assessment?.daysOfStock === Infinity ? "∞" : days !== null ? days.toFixed(1) : "–"}</b> days of stock
            {assessment?.projectedStockoutDate ? <> · out by <span className={a.num}>{assessment.projectedStockoutDate}</span></> : null}
          </p>
        </div>
        {assessment ? <span className={s.risk} data-risk={assessment.risk}>{assessment.risk}</span> : null}
      </header>

      {!decision ? (
        <div className={s.empty}>
          <p>No recommendation yet. One call to the Decisions API asks six questions at once about this shelf:</p>
          <ul className={s.qlist}>
            <li><code>next_action</code> choice of four</li>
            <li><code>urgency</code> score: monitor · this week · today</li>
            <li><code>recount_needed</code> predicate</li>
            <li><code>indent_arrives_in_time</code> predicate</li>
            <li><code>donor</code> choice among ranked donors, or none</li>
            <li><code>transfer_bridges_gap</code> predicate</li>
          </ul>
          <Button variant="decision" icon={running ? <Spinner /> : <Sparkles size={14} />} onClick={run} disabled={running}>Ask the Decisions API</Button>
          {runError ? <p className={s.error}>{runError}</p> : null}
        </div>
      ) : (
        <>
          <section className={s.hero}>
            <div className={s.heroTop}>
              <span className={s.label}>Recommended</span>
              <SourceBadge source={decision.source} reason={decision.fallbackReason} />
            </div>
            <motion.h4 key={decision.id} className={s.action} style={{ ["--act" as string]: ACTION_COLOR[decision.action] }} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              {actionLabels[decision.action]}
            </motion.h4>
            <p className={s.heroMeta}>
              <span><b className={a.num}>{pct(decision.confidence)}</b> confidence</span>
              {urgency ? <UrgencyChip level={urgency} /> : null}
              {margin < 0.15 ? <span className={s.borderline} title="The top two actions are within 15 points">borderline: {actionLabels[sorted[1]].toLowerCase()} close behind</span> : null}
            </p>
            <ProbabilityBars probabilities={decision.probabilities} selected={decision.action} />
            <p className={s.tech}>
              {ai?.engine === "decisions-api" ? <>{ai.model} · {fmtMs(ai.latencyMs)} · {ai.usage ? `${ai.usage.totalTokens.toLocaleString("en-IN")} tokens` : "–"} · {ai.questions.length} questions in one call</> : <>Rules fallback{decision.fallbackReason ? ` (${decision.fallbackReason.replace(/_/g, " ")})` : ""}: same stock rules, no model</>}
            </p>
          </section>

          {ai ? (
            <section className={s.section} aria-label="Signals from the same call">
              <h5 className={s.h}><Info size={13} aria-hidden /> Signals from the same call</h5>
              <div className={s.signals}>
                <div className={s.signal}>
                  <span className={s.sigName}><code>urgency</code> score</span>
                  <div className={s.urgencyBars}>
                    {URGENCY_LEVELS.map((l) => (
                      <span key={l} className={s.uBar} data-on={l === ai.urgencyLevel || undefined}>
                        <i style={{ height: `${Math.max(4, ai.urgencyProbabilities[l] * 100)}%` }} />
                        <small>{URGENCY_LABEL[l]}</small>
                      </span>
                    ))}
                  </div>
                </div>
                <Predicate name="recount_needed" label="Recount needed" p={ai.recountProbability} warnAbove={0.5} />
                <Predicate name="indent_arrives_in_time" label="Indent arrives in time" p={ai.indentInTime} invert />
                <Predicate name="transfer_bridges_gap" label="Transfer bridges gap" p={ai.transferBridgesGap} invert refused={ai.refusals.includes("transfer_bridges_gap")} />
              </div>
              {ai.donor ? (
                <div className={s.donor}>
                  <span className={s.sigName}><code>donor</code> choice</span>
                  {ai.donor.probabilities.length ? (
                    <ul className={s.donorList}>
                      {[...ai.donor.probabilities].sort((x, y) => y.probability - x.probability).map((p) => (
                        <li key={String(p.value)} data-on={p.value === (ai.donor?.facilityId ?? false) || undefined}>
                          <span>{p.value === false ? "No safe donor" : donorName(p.value)}</span>
                          <span className={s.dTrack}><i style={{ width: `${p.probability * 100}%` }} /></span>
                          <span className={a.num}>{pct(p.probability)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={s.small}>{ai.donor.facilityId ? `${donorName(ai.donor.facilityId)} (top-ranked by code)` : "No safe donor"}</p>
                  )}
                </div>
              ) : null}
              {ai.ruleTrace?.length ? <p className={s.small}>Rules fired: {ai.ruleTrace.join(" · ")}</p> : null}
            </section>
          ) : null}

          <section className={s.section} aria-label="Why">
            <div className={s.hRow}>
              <h5 className={s.h}><MessageSquareText size={13} aria-hidden /> Why</h5>
              <LangToggle lang={lang} onChange={setLang} />
            </div>
            {explanation ? (
              <>
                <p className={s.why} lang={lang}>{explanation[lang]}</p>
                {explanation.keyFacts.length ? <ul className={s.facts}>{explanation.keyFacts.map((f) => <li key={f}>{f}</li>)}</ul> : null}
                <p className={a.genLabel}>
                  <SourceBadge source={explanation.source} reason={explanation.fallbackReason} />
                  {explanation.source === "live" ? `Written after the decision by ${explanation.model}. Explains it; does not make it.` : "Template explanation from the snapshot."}
                </p>
              </>
            ) : explainError[decision.id] ? (
              <p className={s.small}>Explanation unavailable.</p>
            ) : (
              <div className={s.whyLoading} aria-label="Writing explanation"><span className={a.shimmer} /><span className={a.shimmer} /><span className={a.shimmer} /></div>
            )}
          </section>

          <section className={s.section} aria-label="What if">
            <h5 className={s.h}><FlaskConical size={13} aria-hidden /> What if…</h5>
            <p className={s.small}>Re-ask the Decisions API with one fact changed. Nothing is saved.</p>
            <div className={s.cfButtons}>
              {COUNTERFACTUALS.map((c) => (
                <button key={c.kind} type="button" className={s.cf} aria-pressed={whatIf?.kind === c.kind} onClick={() => runWhatIf(c.kind)} disabled={whatIf?.loading || !facts}>
                  {whatIf?.kind === c.kind && whatIf.loading ? <Spinner size={11} /> : null}{c.label}
                </button>
              ))}
            </div>
            {whatIf?.result ? (
              <div className={s.cfResult}>
                <p className={s.cfHead}>
                  <ActionChip action={decision.action} /> <ChevronRight size={14} aria-hidden /> <ActionChip action={whatIf.result.action} />
                  <span className={s.cfVerdict}>{whatIf.result.action === decision.action ? "same call" : "call changes"}</span>
                  <SourceBadge source={whatIf.result.source} reason={whatIf.result.fallbackReason} />
                </p>
                <ul className={s.delta}>
                  {ACTIONS.map((act) => {
                    const before = decision.probabilities[act], after = whatIf.result!.probabilities[act], diff = after - before;
                    return (
                      <li key={act}>
                        <span>{actionLabels[act]}</span>
                        <span className={s.dTrack}><i style={{ width: `${after * 100}%`, background: ACTION_COLOR[act] }} /><b style={{ left: `${before * 100}%` }} title={`was ${pct(before)}`} /></span>
                        <span className={a.num} data-dir={diff > 0.02 ? "up" : diff < -0.02 ? "down" : undefined}>{pct(after)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : whatIf?.error ? <p className={s.error}>{whatIf.error}</p> : null}
          </section>
        </>
      )}

      {facts ? (
        <details className={s.section}>
          <summary className={s.summary}><Eye size={13} aria-hidden /> What the model saw</summary>
          <SnapshotView facts={facts} />
          <button type="button" className={s.rawToggle} onClick={() => setRawOpen((o) => !o)}>{rawOpen ? "Hide" : "Show"} exact JSON input</button>
          {rawOpen ? <pre className={s.raw}>{JSON.stringify(decision?.snapshot ?? facts, null, 2)}</pre> : null}
        </details>
      ) : null}

      <details className={s.section}>
        <summary className={s.summary}><History size={13} aria-hidden /> Audit trail <span className={a.muted}>({audit.length + (decision ? 1 : 0)})</span></summary>
        <ol className={s.audit}>
          {decision ? (
            <li>
              <span className={a.num}>{decision.createdAt.slice(11, 16)}</span>
              <span>{decision.source === "live" ? "Decisions API" : "Rules fallback"} chose <b>{decision.action}</b> at {pct(decision.confidence)} · status <b>{decision.status}</b>{decision.decidedAt ? ` (${decision.decidedAt.slice(0, 16).replace("T", " ")})` : ""}</span>
            </li>
          ) : null}
          {audit.map((e) => (
            <li key={e.id}>
              <span className={a.num}>{e.at.slice(5, 16).replace("T", " ")}</span>
              <span><b>{e.title}</b>{e.detail ? ` · ${e.detail}` : ""} <span className={a.muted}>({e.actor})</span></span>
            </li>
          ))}
        </ol>
      </details>

      {decision && !readOnly ? (
        <footer className={s.foot}>
          {decision.status === "pending" ? (
            <>
              <Button variant="primary" icon={<Check size={14} />} onClick={() => { const r = approve(decision); setNotice(r.message); }}>
                {decision.action === "transfer_surplus" ? "Approve transfer" : decision.action === "verify_count" ? "Request recount" : decision.action === "draft_indent" ? "Draft indent" : "Escalate"}
              </Button>
              <Button variant="ghost" icon={<Eye size={14} />} onClick={() => acknowledge(decision)}>Monitor</Button>
              <Button variant="danger" icon={<X size={14} />} onClick={() => reject(decision)}>Reject</Button>
            </>
          ) : (
            <span className={s.statusLine} data-status={decision.status}>{decision.status} by officer</span>
          )}
          <Button variant="ghost" size="sm" icon={running ? <Spinner /> : <Sparkles size={13} />} onClick={run} disabled={running} className={s.rerun}>Re-run</Button>
          {notice ? <p className={s.notice} role="status">{notice}</p> : null}
        </footer>
      ) : null}

      <Drawer open={!!indentFor} onClose={closeIndent} title="Indent draft" subtitle="Quantities computed by code · justification written by the model" width={720}>
        {indentFor ? <IndentDraft facilityId={indentFor.facilityId} focusMedicineId={indentFor.medicineId} onApproved={() => onIndentDone("approved")} onSubmitted={() => onIndentDone("submitted")} /> : null}
      </Drawer>
    </article>
  );
}

function Predicate({ name, label, p, warnAbove, invert, refused }: { name: string; label: string; p: number | null; warnAbove?: number; invert?: boolean; refused?: boolean }) {
  const tone = p === null ? "none" : invert ? (p >= 0.5 ? "good" : "bad") : warnAbove !== undefined && p > warnAbove ? "bad" : "good";
  return (
    <div className={s.signal} data-tone={tone}>
      <span className={s.sigName}><code>{name}</code> predicate</span>
      <span className={s.pred}>
        <b className={a.num}>{refused ? "declined" : p === null ? "n/a" : pct(p)}</b>
        <small>{label}</small>
      </span>
      <span className={s.pTrack}><i style={{ width: `${(p ?? 0) * 100}%` }} /></span>
    </div>
  );
}

function SnapshotView({ facts }: { facts: DecisionFacts }) {
  const t = facts.target;
  return (
    <div className={s.snap}>
      {facts.counterfactual ? <p className={s.cfNote}>{facts.counterfactual}</p> : null}
      <dl className={s.kv}>
        <div><dt>Stock</dt><dd>{t.stock} {facts.medicine.unit}</dd></div>
        <div><dt>Daily use</dt><dd>{t.dailyUse}</dd></div>
        <div><dt>Days of stock</dt><dd>{t.daysOfStock ?? "∞"}</dd></div>
        <div><dt>Lead + buffer</dt><dd>{facts.medicine.leadTimeDays} + {facts.medicine.safetyBufferDays} d</dd></div>
        <div><dt>Gap to threshold</dt><dd>{t.gapUnits}</dd></div>
        <div><dt>Inbound</dt><dd>{t.inboundUnits}</dd></div>
        <div><dt>Report</dt><dd>{t.reportSource}, {t.verified ? "verified" : "unverified"}, {t.reportAgeHours} h old</dd></div>
        <div><dt>Count check</dt><dd>{t.reportFlag ?? "consistent"}</dd></div>
        <div><dt>Upstream</dt><dd>{facts.upstream ? `${facts.upstream.status}: ${facts.upstream.note}` : "available"}</dd></div>
        {facts.districtStore ? <div><dt>District store</dt><dd>{facts.districtStore.stock} ({facts.districtStore.daysOfDistrictDemand ?? "–"} d of district demand)</dd></div> : null}
      </dl>
      {facts.donors.length ? (
        <table className={s.donorTable}>
          <thead><tr><th>Donor</th><th>km</th><th>Safe surplus</th><th>Covers</th></tr></thead>
          <tbody>
            {facts.donors.map((d) => (
              <tr key={d.facilityId}><td>{d.name}</td><td className={a.num}>{d.distanceKm}</td><td className={a.num}>{d.transferable}</td><td className={a.num}>{d.coversGapPct}%</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className={s.small}>No donor has safe surplus after its reserve.</p>}
      <p className={s.small}>{facts.policy}</p>
    </div>
  );
}
