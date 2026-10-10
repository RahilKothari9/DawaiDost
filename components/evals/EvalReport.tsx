"use client";
// OWNER: evals agent. The /evals report: reads one committed results file and renders every metric from it.
import { useMemo, useState } from "react";
import { Panel } from "@/components/ui";
import { ViewHeader, DecisionMark } from "@/components/views/parts";
import { CATEGORY_LABELS, type EvalCategory } from "@/lib/evals/cases";
import { compareSystems, type Prediction } from "@/lib/evals/metrics";
import { buildReport, type ConfigReport } from "@/lib/evals/report";
import type { DecisionAction } from "@/lib/district/types";
import type { ResultsFile } from "@/lib/evals/types";
import { CaseExplorer } from "./CaseExplorer";
import { ConfusionMatrix } from "./ConfusionMatrix";
import { LiveRun } from "./LiveRun";
import { ReliabilityDiagram } from "./ReliabilityDiagram";
import { ACTION_SHORT, int, ms, num, pct } from "./format";
import s from "./evals.module.css";

const VARIANT_LABEL: Record<string, string> = { product: "Product call", action_only: "Action only", minimal: "Minimal prompt", policy: "Explicit criteria", fallback: "lib/ai/decide.ts" };

type Props = { data: ResultsFile; file: string | null; recorded: boolean; liveSubset: { id: string; title: string; expected: DecisionAction; acceptable: DecisionAction[] }[]; rerun: string };

export function EvalReport({ data, file, recorded, liveSubset, rerun }: Props) {
  const report = useMemo(() => buildReport(data), [data]);
  const primary = report.configs.find((c) => c.id === "gpt-6-luna:product") ?? report.configs[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(primary?.id ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = report.configs.find((c) => c.id === selectedId) ?? primary;
  const base = report.baseline;
  const shown: ConfigReport = selected ?? base;

  const predMap = useMemo(() => new Map((selected?.predictions ?? []).map((p) => [p.caseId, p])), [selected]);
  const rawMap = useMemo(() => new Map(data.results.filter((r) => r.configId === selected?.id).map((r) => [r.caseId, r])), [data.results, selected]);
  const baseMap = useMemo(() => new Map(data.baseline.results.map((r) => [r.caseId, r])), [data.baseline.results]);
  const caseById = useMemo(() => new Map(data.cases.map((c) => [c.id, c])), [data.cases]);
  const split = selected ? compareSystems(selected.predictions, base.predictions) : null;
  const cellCases = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const p of shown.predictions) if (p.choice) (out[`${p.expected}|${p.choice}`] ??= []).push(p.caseId);
    return out;
  }, [shown]);

  const m = shown.metrics;
  const bm = base.metrics;
  const delta = selected ? m.accuracy - bm.accuracy : null;
  const correctN = Math.round(m.accuracy * m.n);
  const runDate = new Date(data.startedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const cats = [...new Set(data.cases.map((c) => c.category))] as EvalCategory[];

  return (
    <div className="view">
      <ViewHeader
        kicker={<><DecisionMark label="Decisions API evaluation" /> <span>{data.cases.length} labeled cases · policy {data.policyVersion}</span></>}
        title="Does the model pick the right action?"
        lede={recorded
          ? `${data.cases.length} synthetic district cases with known answers, sent to the live Decisions API in the exact snapshot shape the product uses. ${report.configs.length} model and prompt configurations were run on ${runDate}; every number below is computed from ${file}.`
          : `${data.cases.length} synthetic district cases with known answers, in the exact snapshot shape the product uses. No Decisions API run is committed yet, so this page shows the deterministic rules baseline only.`}
      />

      {!recorded ? (
        <div className={s.notice} role="status">
          <span><strong>No committed Decisions API results yet.</strong> Run <code>{rerun}</code> with a working <code>OPENAI_API_KEY</code>; this page reads the newest <code>data/evals/results-*.json</code>.</span>
        </div>
      ) : null}

      <section className={s.headline} aria-label="Headline metrics">
        <div className={s.hero}>
          <span className={s.heroLabel}>{selected ? `${selected.id} accuracy` : "Rules baseline accuracy"}</span>
          <span className={s.heroValue}>{pct(m.accuracy)}</span>
          <span className={s.heroSub}><b>{correctN}</b> of {m.n} cases acceptable{m.failed ? ` · ${m.failed} failed calls counted wrong` : ""} · strict match {pct(m.strictAccuracy)}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>Unambiguous cases</span>
          <span className={s.statValue}>{pct(m.unambiguousAccuracy)}</span>
          <span className={s.statNote}>{m.unambiguousN} cases with one defensible answer</span>
        </div>
        {delta === null ? (
          <div className={s.stat}>
            <span className={s.statLabel}>Ambiguous cases</span>
            <span className={s.statValue}>{pct(m.ambiguousAccuracy)}</span>
            <span className={s.statNote}>{m.ambiguousN} cases where an alternative is also accepted</span>
          </div>
        ) : (
          <div className={s.stat}>
            <span className={s.statLabel}>Rules baseline</span>
            <span className={s.statValue}>{pct(bm.accuracy)}</span>
            <span className={s.statNote}>Model is <span className={delta >= 0 ? s.up : s.down}>{delta >= 0 ? "+" : "−"}{Math.abs(Math.round(delta * 100))} pts</span> vs rules on the same cases</span>
          </div>
        )}
        <div className={s.stat}>
          <span className={s.statLabel}>Calibration error (ECE)</span>
          <span className={s.statValue}>{selected ? num(m.ece, 3) : "–"}</span>
          <span className={s.statNote}>{selected ? `Mean confidence ${pct(m.meanConfidence)} vs accuracy ${pct(m.accuracy)}` : "Needs a model run"}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>Latency p50 / p95</span>
          <span className={s.statValue}>{selected ? `${ms(m.latency.p50)}` : "–"}</span>
          <span className={s.statNote}>{selected ? `p95 ${ms(m.latency.p95)} · ${int(m.tokens.perCase)} tokens per call` : "Needs a model run"}</span>
        </div>
      </section>

      <Panel title="Models and prompts" kicker="Select a row to drive the charts and case table below" flush>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>System</th>
                <th>Accuracy</th>
                <th className={s.numCell}>Unambiguous</th>
                <th className={s.numCell}>Strict</th>
                <th className={s.numCell}>Macro F1</th>
                <th className={s.numCell}>ECE</th>
                <th className={s.numCell}>Brier</th>
                <th className={s.numCell}>p50 / p95</th>
                <th className={s.numCell}>Tokens / call</th>
                <th className={s.numCell}>Cost</th>
                <th className={s.numCell}>Failed</th>
              </tr>
            </thead>
            <tbody>
              {report.configs.map((c) => (
                <tr key={c.id} className={`${s.rowButton} ${c.id === selected?.id ? s.rowSelected : ""}`} onClick={() => setSelectedId(c.id)} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelectedId(c.id))} aria-selected={c.id === selected?.id}>
                  <td><span className={s.sysName}><b>{c.model}</b><span>{VARIANT_LABEL[c.variant] ?? c.variant}</span></span></td>
                  <td><AccBar v={c.metrics.accuracy} /></td>
                  <td className={s.numCell}>{pct(c.metrics.unambiguousAccuracy)}</td>
                  <td className={s.numCell}>{pct(c.metrics.strictAccuracy)}</td>
                  <td className={s.numCell}>{num(c.metrics.macroF1, 2)}</td>
                  <td className={s.numCell}>{num(c.metrics.ece, 3)}</td>
                  <td className={s.numCell}>{num(c.metrics.brier, 3)}</td>
                  <td className={s.numCell}>{ms(c.metrics.latency.p50)} / {ms(c.metrics.latency.p95)}</td>
                  <td className={s.numCell}>{int(c.metrics.tokens.perCase)}</td>
                  <td className={s.numCell} title={c.metrics.costUsd === null ? "No verified price set in lib/evals/report.ts PRICING" : undefined}>{c.metrics.costUsd === null ? "–" : `$${c.metrics.costUsd.toFixed(4)}`}</td>
                  <td className={s.numCell}>{c.metrics.failed}</td>
                </tr>
              ))}
              <tr className={s.rowBaseline}>
                <td><span className={s.sysName}><b>rules</b><span>Deterministic fallback</span></span></td>
                <td><AccBar v={bm.accuracy} rules /></td>
                <td className={s.numCell}>{pct(bm.unambiguousAccuracy)}</td>
                <td className={s.numCell}>{pct(bm.strictAccuracy)}</td>
                <td className={s.numCell}>{num(bm.macroF1, 2)}</td>
                <td className={s.numCell} title="Rules emit fixed template probabilities">{num(bm.ece, 3)}</td>
                <td className={s.numCell}>{num(bm.brier, 3)}</td>
                <td className={s.numCell}>&lt;1 ms</td>
                <td className={s.numCell}>0</td>
                <td className={s.numCell}>$0</td>
                <td className={s.numCell}>0</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={s.chartNote} style={{ padding: "0 18px 14px" }}>
          Accuracy counts the expected action, or a listed alternative on the {m.ambiguousN} ambiguous cases. Strict counts only the expected label. Brier is the multi-class score against the expected label on unambiguous cases (0 is perfect). The rules baseline&apos;s probabilities are fixed templates, so its ECE and Brier describe those templates, not judgment. Cost is blank until verified per-token prices are set in <code className={s.code}>lib/evals/report.ts</code>.
        </p>
      </Panel>

      <div className={s.grid2}>
        <Panel title="Confusion matrix" kicker={shown === base ? "Rules baseline" : shown.id}>
          <ConfusionMatrix confusion={m.confusion} cellCases={cellCases} onCell={(e, c) => {
            const first = shown.predictions.find((p) => p.expected === e && p.choice === c);
            if (first) setOpenId(first.caseId);
          }} />
          <p className={s.chartNote}>Rows are the policy label, columns what was chosen. Off-diagonal cells on ambiguous cases may still be accepted alternatives. Select a cell to open its first case.</p>
        </Panel>
        <Panel title="Reliability" kicker="When it says 80%, is it right 80% of the time?">
          {selected ? (
            <ReliabilityDiagram series={[
              { id: selected.id, label: selected.id, color: "var(--accent)", bins: m.reliability },
              { id: "rules", label: "Rules templates", color: "var(--ink-2)", bins: bm.reliability },
            ]} />
          ) : (
            <ReliabilityDiagram series={[{ id: "rules", label: "Rules templates", color: "var(--ink-2)", bins: bm.reliability }]} />
          )}
          <p className={s.chartNote}>Five equal-width confidence bins; dot area is the number of cases. Points under the diagonal are overconfident. ECE {selected ? num(m.ece, 3) : "–"} for the selected model, {num(bm.ece, 3)} for the rules templates.</p>
        </Panel>
      </div>

      {selected && split ? (
        <Panel title="Where model judgment differs from the rules" kicker={`${selected.id} vs deterministic fallback, same ${data.cases.length} cases`}>
          <div className={s.splitList}>
            <SplitCol title="Model right, rules wrong" ids={split.aOnly} preds={selected.predictions} baseline={baseMap} cases={caseById} onOpen={setOpenId} />
            <SplitCol title="Rules right, model wrong" ids={split.bOnly} preds={selected.predictions} baseline={baseMap} cases={caseById} onOpen={setOpenId} />
          </div>
          <p className={s.chartNote}>Both right on {split.both.length} cases, both wrong on {split.neither.length}. The rules were written from the same policy as the labels, so they are a strong baseline on the cases they anticipate; the interesting cases are the ones they do not.</p>
        </Panel>
      ) : null}

      {selected && m.highConfidenceErrors.length ? (
        <Panel title="High-confidence errors" kicker={`Wrong with confidence ≥ 70% · ${selected.id}`}>
          <div className={s.caseLinks}>
            {m.highConfidenceErrors.map((e) => (
              <button key={e.caseId} type="button" className={s.caseLink} onClick={() => setOpenId(e.caseId)}>
                <span className={s.caseId}>{e.caseId}</span>
                <span className={s.caseTitle}>{caseById.get(e.caseId)?.title}</span>
                <span className={s.caseMeta}>expected {ACTION_SHORT[e.expected]} · chose {ACTION_SHORT[e.choice]} at {pct(e.confidence)}</span>
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title="By category" kicker="Where each system gets it right" flush>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Category</th>
                <th className={s.numCell}>Cases</th>
                {report.configs.map((c) => <th key={c.id} className={s.numCell}>{c.model}<br /><span style={{ fontWeight: 400 }}>{VARIANT_LABEL[c.variant]}</span></th>)}
                <th className={s.numCell}>Rules</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((cat) => {
                const b = bm.byCategory.find((x) => x.category === cat);
                return (
                  <tr key={cat}>
                    <td>{CATEGORY_LABELS[cat]}</td>
                    <td className={s.numCell}>{b?.n ?? 0}</td>
                    {report.configs.map((c) => {
                      const x = c.metrics.byCategory.find((y) => y.category === cat);
                      return <td key={c.id} className={s.numCell}>{x ? `${x.correct}/${x.n}` : "–"}</td>;
                    })}
                    <td className={s.numCell}>{b ? `${b.correct}/${b.n}` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Cases" kicker="Select a case to see the exact snapshot, the expected action and the probabilities" flush>
        <CaseExplorer cases={data.cases} configLabel={selected?.id ?? null} predictions={predMap} raw={rawMap} baseline={baseMap} openId={openId} onOpen={setOpenId} />
      </Panel>

      <Panel tone="decision" title="Run it live" kicker={`${liveSubset.length} cases, one or more per action, including an ambiguous one`}>
        <LiveRun subset={liveSubset} />
      </Panel>

      <Panel title="Method" kicker="How the labels were set and how to rerun">
        <div className={s.method}>
          <div>
            <p>Each case is a facts-only snapshot built by the same derivations as <code className={s.code}>lib/ai/facts.ts</code>: days of stock, gap to lead time plus buffer, donor surplus after its 7-day reserve, upstream and warehouse status. The model calculates nothing. Labels come from the written policy on the right, applied before any model was run; ambiguous cases list every action a reasonable officer would accept.</p>
            <p>The product variant sends the exact multi-question call <code className={s.code}>/api/decisions/district</code> makes. Action only keeps the product instructions but asks one question. Minimal sends a one-line instruction and bare choice labels with the same snapshot, which isolates what the prompt design contributes.</p>
            <p>Calls run {data.concurrency} at a time with up to {data.maxAttempts} attempts on 429 and 5xx; a call that still fails counts as wrong. Rerun: <code className={s.code}>{rerun}</code></p>
          </div>
          <pre className={s.pre} style={{ maxHeight: 320, whiteSpace: "pre-wrap" }}>{data.policy}</pre>
        </div>
      </Panel>
    </div>
  );
}

function AccBar({ v, rules }: { v: number; rules?: boolean }) {
  return (
    <span className={s.accCell}>
      <span className={s.accTrack} aria-hidden><span className={`${s.accFill} ${rules ? s.accFillRules : ""}`} style={{ width: `${v * 100}%` }} /></span>
      <span className={s.accValue}>{pct(v)}</span>
    </span>
  );
}

function SplitCol({ title, ids, preds, baseline, cases, onOpen }: { title: string; ids: string[]; preds: Prediction[]; baseline: Map<string, { choice: DecisionAction }>; cases: Map<string, { title: string; expected: DecisionAction }>; onOpen: (id: string) => void }) {
  return (
    <div className={s.splitCol}>
      <h3>{title} <span>{ids.length}</span></h3>
      {ids.length ? (
        <div className={s.caseLinks}>
          {ids.map((id) => {
            const p = preds.find((x) => x.caseId === id);
            const c = cases.get(id);
            return (
              <button key={id} type="button" className={s.caseLink} onClick={() => onOpen(id)}>
                <span className={s.caseId}>{id}</span>
                <span className={s.caseTitle}>{c?.title}</span>
                <span className={s.caseMeta}>model {p?.choice ? ACTION_SHORT[p.choice] : "failed"} · rules {ACTION_SHORT[baseline.get(id)!.choice]}</span>
              </button>
            );
          })}
        </div>
      ) : <p className={s.empty}>None.</p>}
    </div>
  );
}
