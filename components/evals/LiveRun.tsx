"use client";
// OWNER: evals agent. Streams a fresh run of a small case subset through /api/evals/run and grades it as it arrives.
import { Play, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import type { DecisionAction } from "@/lib/district/types";
import type { CaseResult, LiveEvent, PromptVariantId } from "@/lib/evals/types";
import { ACTION_SHORT, ms, pct } from "./format";
import s from "./evals.module.css";

type Row = { caseId: string; title: string; expected: DecisionAction; acceptable: DecisionAction[]; baseline?: DecisionAction; result?: CaseResult };

const MODELS = ["gpt-6-luna"];
const VARIANTS: { value: PromptVariantId; label: string }[] = [
  { value: "product", label: "Product call" },
  { value: "action_only", label: "Action only" },
  { value: "minimal", label: "Minimal prompt" },
  { value: "policy", label: "Explicit criteria" },
];

const ok = (r: Row, a: DecisionAction | null | undefined) => !!a && (a === r.expected || r.acceptable.includes(a));

export function LiveRun({ subset }: { subset: { id: string; title: string; expected: DecisionAction; acceptable: DecisionAction[] }[] }) {
  const [model, setModel] = useState("gpt-6-luna");
  const [variant, setVariant] = useState<PromptVariantId>("product");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<Extract<LiveEvent, { type: "done" }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function start() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRows(subset.map((c) => ({ caseId: c.id, title: c.title, expected: c.expected, acceptable: c.acceptable })));
    setSummary(null);
    setError(null);
    setRunning(true);
    try {
      const res = await fetch("/api/evals/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, variant, caseIds: subset.map((c) => c.id) }), signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`Run endpoint returned HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as LiveEvent;
          if (ev.type === "result") setRows((rs) => rs.map((r) => (r.caseId === ev.caseId ? { ...r, baseline: ev.baseline, result: ev.result } : r)));
          else if (ev.type === "done") setSummary(ev);
          else if (ev.type === "error") setError(ev.message);
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  const failures = rows.filter((r) => r.result && !r.result.ok);
  const quota = failures.find((r) => /quota|credit/i.test(r.result?.error ?? ""));

  return (
    <div>
      <div className={s.liveControls}>
        <label className="sr-only" htmlFor="live-model">Model</label>
        <select id="live-model" className={s.select} value={model} onChange={(e) => setModel(e.target.value)} disabled={running}>
          {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="sr-only" htmlFor="live-variant">Prompt</label>
        <select id="live-variant" className={s.select} value={variant} onChange={(e) => setVariant(e.target.value as PromptVariantId)} disabled={running}>
          {VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        {running ? (
          <Button variant="secondary" icon={<Square size={14} />} onClick={() => abort.current?.abort()}>Stop</Button>
        ) : (
          <Button variant="decision" icon={<Play size={14} />} onClick={start}>Run {subset.length} cases live</Button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>Calls the Decisions API now, 4 at a time. Results are not saved.</span>
      </div>

      {rows.length ? (
        <div className={s.liveRows} role="table" aria-label="Live run results">
          <div className={`${s.liveRow} ${s.liveHead}`} role="row">
            <span role="columnheader">Case</span><span role="columnheader">Scenario</span><span role="columnheader">Expected</span><span role="columnheader">Model</span><span role="columnheader">Rules</span><span role="columnheader">Conf.</span><span role="columnheader">Latency</span>
          </div>
          {rows.map((r) => {
            const res = r.result;
            return (
              <div key={r.caseId} className={s.liveRow} role="row" aria-busy={!res}>
                <span className="num muted" role="cell">{r.caseId}</span>
                <span role="cell" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                <span role="cell" className={s.choice}>{ACTION_SHORT[r.expected]}{r.acceptable.length ? "*" : ""}</span>
                <span role="cell" className={`${s.choice} ${res?.ok && !ok(r, res.choice) ? s.choiceWrong : ""} ${!res ? s.pending : ""}`}>
                  {!res ? (running ? "…" : "–") : res.ok ? ACTION_SHORT[res.choice!] : "failed"}
                </span>
                <span role="cell" className={`${s.choice} ${r.baseline && !ok(r, r.baseline) ? s.choiceWrong : ""}`}>{r.baseline ? ACTION_SHORT[r.baseline] : "–"}</span>
                <span role="cell" className="num">{res?.ok ? pct(res.confidence) : "–"}</span>
                <span role="cell" className="num">{res?.ok ? ms(res.latencyMs) : "–"}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {summary ? (
        <p className={s.liveSummary}>
          Model correct <b>{summary.correct}/{summary.total - summary.failed}</b> answered · rules correct <b>{summary.baselineCorrect}/{summary.total}</b> · failed calls <b>{summary.failed}</b> · wall time <b>{ms(summary.elapsedMs)}</b>. * marks ambiguous cases where an alternative is also accepted.
        </p>
      ) : null}
      {quota ? <p className={s.liveError}>The Decisions API refused the call ({quota.result?.error}). The API key has no remaining credit, so a live run cannot complete until it is topped up.</p> : null}
      {error ? <p className={s.liveError}>{error}</p> : null}
    </div>
  );
}
