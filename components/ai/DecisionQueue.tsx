"use client";
// OWNER: ai agent. The AI inbox: every at-risk facility × medicine, the Decisions API's recommendation for each,
// a one-click "run on all" that streams results in live, and officer approve / reject / monitor controls.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Eye, Play, RotateCcw, Sparkles, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button, Drawer } from "@/components/ui";
import { requestDistrictDecision, streamBatchDecisions } from "@/lib/ai/client";
import { buildDecisionFacts } from "@/lib/ai/facts";
import { isAiDecision, type BatchEvent } from "@/lib/ai/types";
import { useDistrict } from "@/lib/district/store";
import type { DecisionAction, DecisionRecord, StockAssessment } from "@/lib/district/types";
import { IndentDraft } from "./IndentDraft";
import { ActionChip, fmtMs, latestDecision, MiniProbStack, pct, SourceBadge, Spinner, UrgencyChip, urgencyOf, useDecisionActions } from "./shared";
import a from "./ai.module.css";
import s from "./DecisionQueue.module.css";

export type DecisionQueueProps = {
  variant?: "full" | "compact";
  /** Max rows in compact mode (default 5). */
  limit?: number;
  /** Called after a row is selected (the row also selects facility + medicine in the store). */
  onSelect?: (facilityId: string, medicineId: string) => void;
};

const RISK_RANK: Record<string, number> = { stockout: 0, critical: 1, low: 2 };
const APPROVE_LABEL: Record<DecisionAction, string> = {
  verify_count: "Request recount",
  transfer_surplus: "Approve transfer",
  draft_indent: "Draft indent",
  escalate_supply_gap: "Escalate",
};
type Filter = "open" | "all" | "resolved";
type RunState = "queued" | "running" | "error";
type BatchStats = { total: number; done: number; live: number; fallback: number; tokens: number; latencies: number[]; elapsedMs?: number; model?: string };

const key = (f: string, m: string) => `${f}|${m}`;

export function DecisionQueue({ variant = "full", limit = 5, onSelect }: DecisionQueueProps) {
  const { state, dispatch, assessments } = useDistrict();
  const { approve, reject, acknowledge, indentFor, closeIndent, onIndentDone } = useDecisionActions();
  const reduce = useReducedMotion();
  const compact = variant === "compact";
  const [filter, setFilter] = useState<Filter>("open");
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [batch, setBatch] = useState<BatchStats | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fac = useMemo(() => new Map(state.facilities.map((f) => [f.id, f])), [state.facilities]);
  const med = useMemo(() => new Map(state.medicines.map((m) => [m.id, m])), [state.medicines]);

  const atRisk = useMemo(
    () =>
      assessments
        .filter((x) => x.risk in RISK_RANK && fac.get(x.facilityId)?.type !== "WAREHOUSE")
        .sort((x, y) => RISK_RANK[x.risk] - RISK_RANK[y.risk] || x.daysOfStock - y.daysOfStock),
    [assessments, fac],
  );

  const rows = useMemo(() => {
    const all = atRisk.map((x) => ({ a: x, d: latestDecision(state.decisions, x.facilityId, x.medicineId) }));
    // Keep resolved decisions for items that are no longer at risk visible under "resolved".
    const seen = new Set(all.map((r) => key(r.a.facilityId, r.a.medicineId)));
    const extra = state.decisions
      .filter((d) => d.status !== "pending" && !seen.has(key(d.facilityId, d.medicineId)) && (seen.add(key(d.facilityId, d.medicineId)), true))
      .map((d) => ({ a: assessments.find((x) => x.facilityId === d.facilityId && x.medicineId === d.medicineId), d }))
      .filter((r): r is { a: StockAssessment; d: DecisionRecord } => !!r.a);
    const list = [...all, ...extra];
    if (filter === "all") return list;
    if (filter === "resolved") return list.filter((r) => r.d && r.d.status !== "pending");
    return list.filter((r) => !r.d || r.d.status === "pending");
  }, [atRisk, state.decisions, assessments, filter]);

  const needsDecision = atRisk.filter((x) => {
    const d = latestDecision(state.decisions, x.facilityId, x.medicineId);
    return !d || d.status !== "pending";
  });
  const pending = state.decisions.filter((d) => d.status === "pending").length;
  const runTargets = needsDecision.length ? needsDecision : atRisk;
  const live = state.decisions.filter((d) => d.source === "live");
  const avgLatency = live.length ? Math.round(live.reduce((t, d) => t + (isAiDecision(d) ? d.ai.latencyMs : 0), 0) / live.length) : null;

  async function runAll() {
    if (running) {
      abortRef.current?.abort();
      return;
    }
    const targets = runTargets.slice(0, 80);
    if (!targets.length) return;
    const items = targets.map((x) => ({ facilityId: x.facilityId, medicineId: x.medicineId, snapshot: buildDecisionFacts(state, x.facilityId, x.medicineId) }));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setNotice(null);
    setRuns(Object.fromEntries(items.map((i) => [key(i.facilityId, i.medicineId), "queued" as RunState])));
    setBatch({ total: items.length, done: 0, live: 0, fallback: 0, tokens: 0, latencies: [] });
    try {
      await streamBatchDecisions(items, (e: BatchEvent) => {
        if (e.type === "start") setBatch((b) => (b ? { ...b, model: e.model } : b));
        if (e.type === "progress") setRuns((r) => ({ ...r, [key(e.facilityId, e.medicineId)]: "running" }));
        if (e.type === "decision") {
          dispatch({ type: "ADD_DECISION", decision: e.decision });
          setRuns((r) => {
            const next = { ...r };
            delete next[key(e.decision.facilityId, e.decision.medicineId)];
            return next;
          });
          setBatch((b) => b && { ...b, done: b.done + 1, live: b.live + (e.decision.source === "live" ? 1 : 0), fallback: b.fallback + (e.decision.source === "live" ? 0 : 1), tokens: b.tokens + (e.decision.ai.usage?.totalTokens ?? 0), latencies: [...b.latencies, e.decision.ai.latencyMs] });
        }
        if (e.type === "error") {
          setRuns((r) => ({ ...r, [key(e.facilityId, e.medicineId)]: "error" }));
          setBatch((b) => b && { ...b, done: b.done + 1 });
        }
        if (e.type === "done") setBatch((b) => b && { ...b, elapsedMs: e.elapsedMs });
      }, { concurrency: 4, signal: ctrl.signal });
    } catch (err) {
      if (!ctrl.signal.aborted) setNotice(err instanceof Error ? err.message : "Batch run failed.");
    } finally {
      setRunning(false);
      setRuns((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v === "error")));
      abortRef.current = null;
    }
  }

  async function runOne(facilityId: string, medicineId: string) {
    const k = key(facilityId, medicineId);
    setRuns((r) => ({ ...r, [k]: "running" }));
    try {
      const d = await requestDistrictDecision({ facilityId, medicineId, snapshot: buildDecisionFacts(state, facilityId, medicineId) });
      dispatch({ type: "ADD_DECISION", decision: d });
      setRuns((r) => {
        const next = { ...r };
        delete next[k];
        return next;
      });
    } catch {
      setRuns((r) => ({ ...r, [k]: "error" }));
    }
  }

  function select(facilityId: string, medicineId: string) {
    dispatch({ type: "SELECT_FACILITY", facilityId });
    dispatch({ type: "SELECT_MEDICINE", medicineId });
    onSelect?.(facilityId, medicineId);
  }

  function onApprove(d: DecisionRecord) {
    const r = approve(d);
    setNotice(r.ok ? null : r.message);
  }

  const shown = compact ? rows.slice(0, limit) : rows;
  const runCount = Math.min(needsDecision.length || atRisk.length, 80);
  const scope = needsDecision.length === atRisk.length ? "all" : "open";
  const runLabel = running
    ? `Stop · ${batch?.done ?? 0}/${batch?.total ?? 0}`
    : needsDecision.length
      ? compact ? `Run on ${scope} (${runCount})` : `Run Decisions API on ${scope} (${runCount})`
      : `Re-run all (${runCount})`;
  const progress = batch ? batch.done / Math.max(1, batch.total) : 0;
  const batchAvg = batch?.latencies.length ? Math.round(batch.latencies.reduce((t, x) => t + x, 0) / batch.latencies.length) : null;

  return (
    <section className={`${s.queue} ${compact ? s.compact : ""}`} aria-label="Decision queue">
      <header className={s.head}>
        <div className={s.headText}>
          {!compact ? <span className={s.kicker}><Sparkles size={12} aria-hidden /> OpenAI decision layer</span> : null}
          <p className={s.counts}>
            <b className={a.num}>{atRisk.length}</b> at risk · <b className={a.num}>{pending}</b> awaiting you
            {!compact && live.length ? <> · <span className={a.num}>{live.length}</span> live{avgLatency !== null ? <>, avg <span className={a.num}>{fmtMs(avgLatency)}</span></> : null}</> : null}
          </p>
        </div>
        {compact ? (
          <button type="button" className={s.runText} onClick={runAll} disabled={!atRisk.length} aria-live="polite">
            {running ? <Spinner size={12} /> : null}
            {runLabel}
          </button>
        ) : (
          <Button variant="decision" icon={running ? <Spinner /> : !needsDecision.length ? <RotateCcw size={14} /> : <Play size={14} />} onClick={runAll} disabled={!atRisk.length} aria-live="polite">
            {runLabel}
          </Button>
        )}
      </header>

      <AnimatePresence initial={false}>
        {batch ? (
          <motion.div className={s.batch} initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <div className={s.progress} role="progressbar" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={batch.done} aria-label="Decisions API batch progress">
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <p className={s.batchStats}>
              <span><b className={a.num}>{batch.done}</b>/<span className={a.num}>{batch.total}</span> decided</span>
              <span><b className={a.num}>{batch.live}</b> live · <span className={a.num}>{batch.fallback}</span> fallback</span>
              {batchAvg !== null ? <span>avg <span className={a.num}>{fmtMs(batchAvg)}</span></span> : null}
              {batch.tokens ? <span><span className={a.num}>{batch.tokens.toLocaleString("en-IN")}</span> tokens</span> : null}
              {batch.elapsedMs !== undefined ? <span>wall <span className={a.num}>{fmtMs(batch.elapsedMs)}</span></span> : null}
              {batch.model ? <span className={a.muted}>{batch.model} · 6 questions per call</span> : null}
              {!running ? <button type="button" className={s.dismiss} onClick={() => setBatch(null)} aria-label="Dismiss batch summary"><X size={12} /></button> : null}
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!compact ? (
        <div className={s.filters} role="tablist" aria-label="Filter decisions">
          {(["open", "resolved", "all"] as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {f === "open" ? "Needs action" : f === "resolved" ? "Resolved" : "All"}
            </button>
          ))}
        </div>
      ) : null}

      {notice ? <p className={s.notice} role="status">{notice}</p> : null}

      {shown.length === 0 ? (
        <p className={s.empty}>{filter === "resolved" ? "No resolved decisions yet." : "No facility is below its lead time plus buffer. Nothing needs a decision."}</p>
      ) : (
        <ol className={s.list}>
          {shown.map(({ a: x, d }) => {
            const k = key(x.facilityId, x.medicineId);
            const run = runs[k];
            const f = fac.get(x.facilityId);
            const m = med.get(x.medicineId);
            const selected = state.selectedFacilityId === x.facilityId && state.selectedMedicineId === x.medicineId;
            const urgency = d ? urgencyOf(d) : null;
            const busy = run === "running" || run === "queued";
            return (
              <motion.li
                key={k}
                layout={reduce ? false : "position"}
                className={s.row}
                data-selected={selected || undefined}
                data-risk={x.risk}
                data-status={d?.status ?? "none"}
              >
                <button type="button" className={s.rowMain} onClick={() => select(x.facilityId, x.medicineId)} aria-label={`${f?.name ?? x.facilityId}, ${m?.name ?? x.medicineId}: open decision`}>
                  <span className={s.days}>
                    <b className={a.num}>{Number.isFinite(x.daysOfStock) ? (x.daysOfStock < 10 ? x.daysOfStock.toFixed(1) : Math.round(x.daysOfStock)) : "∞"}</b>
                    <small>days</small>
                  </span>
                  <span className={s.who}>
                    <span className={s.fac}>{f?.name ?? x.facilityId}</span>
                    <span className={s.med}>{m ? `${m.name} ${m.strength}` : x.medicineId} · {f?.block}</span>
                  </span>
                </button>

                <div className={s.ai}>
                  {busy && (!d || run) ? (
                    <span className={s.thinking}>
                      {run === "running" ? <><Spinner size={12} /> deciding…</> : <span className={`${a.shimmer} ${s.shimmerBar}`} aria-label="Queued" />}
                    </span>
                  ) : d ? (
                    <motion.span className={s.decision} key={d.id} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                      <span className={s.decisionTop}>
                        <ActionChip action={d.action} short={compact} />
                        <span className={`${a.num} ${s.conf}`} title="Confidence of the chosen action">{pct(d.confidence)}</span>
                      </span>
                      <MiniProbStack probabilities={d.probabilities} />
                    </motion.span>
                  ) : run === "error" ? (
                    <span className={s.err}>failed · <button type="button" onClick={() => runOne(x.facilityId, x.medicineId)}>retry</button></span>
                  ) : (
                    <button type="button" className={s.decideOne} onClick={() => runOne(x.facilityId, x.medicineId)}>
                      Decide
                    </button>
                  )}
                </div>

                {!compact ? (
                  <div className={s.meta}>
                    {urgency ? <UrgencyChip level={urgency} /> : null}
                    {d ? <SourceBadge source={d.source} reason={d.fallbackReason} /> : null}
                    {d && isAiDecision(d) && d.source === "live" ? <span className={`${a.num} ${a.muted} ${s.lat}`}>{fmtMs(d.ai.latencyMs)}</span> : null}
                  </div>
                ) : d ? (
                  <div className={s.meta}><SourceBadge source={d.source} reason={d.fallbackReason} /></div>
                ) : null}

                <div className={s.actions}>
                  {d?.status === "pending" && !busy ? (
                    <>
                      <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => onApprove(d)} title={APPROVE_LABEL[d.action]}>
                        {compact ? null : APPROVE_LABEL[d.action]}
                      </Button>
                      {!compact ? (
                        <>
                          <Button size="sm" variant="ghost" icon={<Eye size={13} />} onClick={() => acknowledge(d)} title="Acknowledge and keep monitoring" aria-label="Acknowledge" />
                          <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => reject(d)} title="Reject recommendation" aria-label="Reject" />
                        </>
                      ) : null}
                    </>
                  ) : d && d.status !== "pending" ? (
                    <span className={s.status} data-status={d.status}>{d.status}</span>
                  ) : null}
                </div>
              </motion.li>
            );
          })}
        </ol>
      )}
      {compact && rows.length > limit ? <p className={s.more}>+{rows.length - limit} more in the Decisions view</p> : null}

      <Drawer open={!!indentFor} onClose={closeIndent} title="Indent draft" subtitle="Quantities computed by code · justification written by the model" width={720}>
        {indentFor ? <IndentDraft facilityId={indentFor.facilityId} focusMedicineId={indentFor.medicineId} onApproved={() => onIndentDone("approved")} onSubmitted={() => onIndentDone("submitted")} /> : null}
      </Drawer>
    </section>
  );
}
