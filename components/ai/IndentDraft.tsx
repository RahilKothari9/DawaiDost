"use client";
// OWNER: ai agent. Consumption-based indent: quantities from code, justification lines from the Responses API.
// Renders a printable requisition with approve / mark-submitted controls.
import { Check, FileText, Printer, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { requestIndent } from "@/lib/ai/client";
import { compactState } from "@/lib/ai/compact";
import type { IndentDocument } from "@/lib/ai/types";
import { useDistrict } from "@/lib/district/store";
import { SourceBadge, Spinner, fmtMs } from "./shared";
import a from "./ai.module.css";
import s from "./IndentDraft.module.css";

export type IndentDraftProps = {
  facilityId?: string;
  /** Highlight this medicine's line (e.g. the one a decision was about) and draft immediately. */
  focusMedicineId?: string;
  /** Draft immediately on mount (default: true when focusMedicineId is set). */
  autoStart?: boolean;
  onApproved?: (doc: IndentDocument) => void;
  onSubmitted?: (doc: IndentDocument) => void;
};

const REVIEW_OPTIONS = [15, 30, 45];
type Phase = "draft" | "approved" | "submitted";

export function IndentDraft({ facilityId, focusMedicineId, autoStart, onApproved, onSubmitted }: IndentDraftProps) {
  const { state, dispatch } = useDistrict();
  const sites = state.facilities.filter((f) => f.type !== "WAREHOUSE");
  const [picked, setPicked] = useState<string | null>(null);
  const fid = facilityId ?? picked ?? state.selectedFacilityId ?? sites[0]?.id ?? "";
  const facility = state.facilities.find((f) => f.id === fid);
  const shouldAuto = autoStart ?? !!focusMedicineId;
  const [review, setReview] = useState(30);
  const [doc, setDoc] = useState<IndentDocument | null>(null);
  const [loading, setLoading] = useState(shouldAuto);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("draft");
  const docRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Auto-draft once when opened from a decision. All state updates happen after the request resolves.
  useEffect(() => {
    if (!shouldAuto || !fid) return;
    const ctrl = new AbortController();
    requestIndent({ facilityId: fid, state: compactState(stateRef.current), reviewPeriodDays: 30 }, ctrl.signal)
      .then((d) => { setDoc(d); setPhase("draft"); })
      .catch((e: unknown) => { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Could not draft the indent."); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [shouldAuto, fid]);

  async function draft() {
    if (!fid) return;
    setLoading(true);
    setError(null);
    try {
      setDoc(await requestIndent({ facilityId: fid, state: compactState(state), reviewPeriodDays: review }));
      setPhase("draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not draft the indent.");
    } finally {
      setLoading(false);
    }
  }

  function approve() {
    if (!doc) return;
    setPhase("approved");
    onApproved?.(doc);
  }

  function submit() {
    if (!doc) return;
    const units = doc.lines.reduce((t, l) => t + l.required, 0);
    dispatch({
      type: "ADD_TIMELINE",
      event: {
        id: `indent-${doc.id}`,
        at: state.now,
        kind: "indent",
        title: `Indent ${doc.id} submitted for ${doc.facilityName}`,
        detail: `${doc.lines.length} line${doc.lines.length === 1 ? "" : "s"}, ${units.toLocaleString("en-IN")} units total, ${doc.reviewPeriodDays}-day review period. Sent to the District Drug Store.`,
        facilityId: doc.facilityId,
        medicineId: focusMedicineId,
        actor: `${state.district.officer.name} (DHO)`,
      },
    });
    setPhase("submitted");
    onSubmitted?.(doc);
  }

  function print() {
    const node = docRef.current;
    if (!node) return;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(frame);
    const w = frame.contentWindow;
    if (!w) return;
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${doc?.id ?? "Indent"}</title><style>${PRINT_CSS}</style></head><body>${node.outerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
      setTimeout(() => frame.remove(), 1000);
    }, 50);
  }

  const total = doc?.lines.reduce((t, l) => t + l.required, 0) ?? 0;

  return (
    <div className={s.wrap}>
      <div className={s.controls}>
        {!facilityId ? (
          <label className={s.field}>
            <span>Facility</span>
            <select value={fid} onChange={(e) => { setPicked(e.target.value); setDoc(null); }}>
              {sites.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className={s.field}>
          <span>Review period</span>
          <select value={review} onChange={(e) => setReview(Number(e.target.value))}>
            {REVIEW_OPTIONS.map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
        <Button variant={doc ? "secondary" : "decision"} size="sm" icon={loading ? <Spinner /> : <FileText size={14} />} onClick={draft} disabled={loading || !fid}>
          {doc ? "Redraft" : `Draft indent${facility ? ` for ${facility.name}` : ""}`}
        </Button>
      </div>

      {error ? <p className={s.error} role="alert">{error}</p> : null}
      {loading && !doc ? (
        <div className={s.skeleton} aria-label="Drafting indent">
          <span className={a.shimmer} style={{ height: 18, width: "60%" }} />
          <span className={a.shimmer} style={{ height: 12, width: "90%" }} />
          <span className={a.shimmer} style={{ height: 80 }} />
        </div>
      ) : null}

      {doc ? (
        <>
          <div className={s.provenance}>
            <SourceBadge source={doc.source} reason={doc.fallbackReason} />
            <span className={a.genLabel}>
              Quantities: code · Justifications: {doc.source === "live" ? `${doc.model} (${fmtMs(doc.latencyMs)})` : "template"}
            </span>
          </div>

          <div ref={docRef} className={`${s.doc} indent-doc`} data-phase={phase}>
            <header className="ind-head">
              <div>
                <p className="ind-kicker">Indent requisition · synthetic demo</p>
                <h3 className="ind-title">{doc.facilityName}</h3>
                <p className="ind-sub">{doc.block} block · {doc.district}</p>
              </div>
              <dl className="ind-meta">
                <div><dt>No.</dt><dd>{doc.id}</dd></div>
                <div><dt>Date</dt><dd>{doc.createdAt.slice(0, 10)}</dd></div>
                <div><dt>To</dt><dd>District Drug Store</dd></div>
                <div><dt>Status</dt><dd className="ind-status">{phase === "draft" ? "Draft" : phase === "approved" ? "Approved" : "Submitted"}</dd></div>
              </dl>
            </header>

            <p className="ind-note">{doc.coveringNote}</p>

            {doc.lines.length ? (
              <table className="ind-table">
                <thead>
                  <tr><th>#</th><th>Item</th><th className="n">Avg/day</th><th className="n">Cover</th><th className="n">On hand</th><th className="n">Inbound</th><th className="n">Indent qty</th></tr>
                </thead>
                <tbody>
                  {doc.lines.map((l, i) => (
                    <tr key={l.medicineId} data-focus={l.medicineId === focusMedicineId || undefined}>
                      <td className="n">{i + 1}</td>
                      <td>
                        <b>{l.name} {l.strength}</b> <span className="ind-unit">{l.unit}</span>
                        <p className="ind-just">{l.justification}</p>
                      </td>
                      <td className="n" title={l.basis === "ledger" ? "From the 8-week dispensing ledger" : "Reported daily use"}>{l.avgDailyUse}{l.basis === "ledger" ? "" : "*"}</td>
                      <td className="n">{l.coverDays}d</td>
                      <td className="n">{l.stock}</td>
                      <td className="n">{l.inbound || "–"}</td>
                      <td className="n qty">{l.required.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={6}>Total units</td><td className="n qty">{total.toLocaleString("en-IN")}</td></tr>
                </tfoot>
              </table>
            ) : (
              <p className="ind-empty">No line needs replenishment for this review period.</p>
            )}

            <p className="ind-formula">Indent qty = avg daily use × (lead time + safety buffer + {doc.reviewPeriodDays}-day review) − on hand − inbound. * reported daily use where no ledger exists.</p>
            <footer className="ind-sign">
              <div><span>Prepared by</span><b>Dawai Dost (auto-draft)</b></div>
              <div><span>Approved by</span><b>{phase === "draft" ? "________________" : doc.officer}</b></div>
            </footer>
          </div>

          <div className={s.actions}>
            <Button size="sm" variant="ghost" icon={<Printer size={14} />} onClick={print}>Print</Button>
            {phase === "draft" ? <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={approve} disabled={!doc.lines.length}>Approve indent</Button> : null}
            {phase === "approved" ? <Button size="sm" variant="decision" icon={<Send size={14} />} onClick={submit}>Mark submitted</Button> : null}
            {phase === "submitted" ? <span className={s.done}><Check size={14} /> Submitted · logged to timeline</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

// Standalone print stylesheet (the doc is printed from an isolated iframe so the app's styles never leak).
const PRINT_CSS = `
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { font: 11pt/1.45 Georgia, "Times New Roman", serif; color: #111; margin: 0; }
.ind-head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111; padding-bottom: 10px; }
.ind-kicker { font: 600 8pt/1 ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; margin: 0 0 6px; }
.ind-title { font-size: 18pt; margin: 0; }
.ind-sub { margin: 2px 0 0; color: #444; }
.ind-meta { display: grid; grid-template-columns: auto auto; gap: 2px 10px; margin: 0; font-size: 9pt; }
.ind-meta div { display: contents; } .ind-meta dt { color: #555; } .ind-meta dd { margin: 0; font-weight: 600; }
.ind-note { margin: 12px 0; }
.ind-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
.ind-table th, .ind-table td { border-bottom: 1px solid #bbb; padding: 6px 5px; vertical-align: top; text-align: left; }
.ind-table th { font: 600 8pt/1.2 ui-monospace, monospace; text-transform: uppercase; border-bottom: 1.5px solid #111; }
.ind-table .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ind-table .qty { font-weight: 700; }
.ind-table tfoot td { border-top: 1.5px solid #111; font-weight: 700; }
.ind-unit { color: #555; font-size: 8.5pt; }
.ind-just { margin: 3px 0 0; color: #333; font-size: 9pt; }
.ind-formula { font-size: 8pt; color: #555; margin-top: 10px; }
.ind-sign { display: flex; justify-content: space-between; margin-top: 36px; }
.ind-sign div { display: flex; flex-direction: column; gap: 4px; }
.ind-sign span { font-size: 8pt; color: #555; text-transform: uppercase; letter-spacing: .08em; }
`;
