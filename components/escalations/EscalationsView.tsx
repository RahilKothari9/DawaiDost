"use client";
// OWNER: escalations agent. /escalations: supply gaps the district cannot close locally, raised to the state with evidence.
import Link from "next/link";
import { useMemo, useState } from "react";
import { FileText, Printer, Send, Sparkles } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import type { DecisionRecord } from "@/lib/district/types";
import { computeSupplyGaps, type SupplyGap } from "@/lib/escalations/gap";
import { computeLeadTimeWatches } from "@/lib/escalations/leadtime";
import {
  STAGES, STAGE_ACTION, STAGE_LABEL, activeEscalation, deriveEscalations, linkedDecisions, memoReference, newEscalationId, nextStage, stageEvent,
  type Escalation, type EscalationStage,
} from "@/lib/escalations/lifecycle";
import { buildMemoFacts, fmtLongDate, fmtUnits, type MemoResponse } from "@/lib/escalations/memo";
import { Button, Panel } from "@/components/ui";
import { RiskChip } from "@/components/analytics/RiskChip";
import { ViewHeader } from "@/components/views/parts";
import { useShell } from "@/components/shell/ShellContext";
import { fmtAgo, fmtDate, fmtDateTime } from "@/components/shell/format";
import { GapBoard, StagePill, StatusLabel } from "./GapBoard";
import { GapWaterfall } from "./GapWaterfall";
import { LeadTimeWatch } from "./LeadTimeWatch";
import { MemoSheet, PrintPortal } from "./MemoSheet";
import s from "./escalations.module.css";

/** Memos survive route changes for the session (the store keeps the lifecycle; memo text is only cached here). */
const memoCache = new Map<string, MemoResponse>();

const nonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const dateOnly = (iso: string) => fmtDate(`${iso}T12:00:00+05:30`);

const FALLBACK_REASON: Record<NonNullable<MemoResponse["fallbackReason"]>, string> = {
  missing_api_key: "no API key configured",
  upstream_unavailable: "OpenAI API unavailable",
  unexpected_response: "model output failed validation",
  unverified_number: "model cited a figure not in the ledger",
  request_failed: "request failed",
};

export function EscalationsView({ initialMedicineId }: { initialMedicineId?: string }) {
  const { state, dispatch } = useDistrict();
  const { pushToast } = useShell();
  const gaps = useMemo(() => computeSupplyGaps(state), [state]);
  const watches = useMemo(() => computeLeadTimeWatches(state), [state]);
  const escalations = useMemo(() => deriveEscalations(state.timeline, state.decisions), [state.timeline, state.decisions]);
  const [picked, setPicked] = useState<string | null>(initialMedicineId && state.medicines.some((m) => m.id === initialMedicineId) ? initialMedicineId : null);
  const selectedId = picked ?? gaps[0]?.medicineId ?? null;
  const gap = gaps.find((g) => g.medicineId === selectedId) ?? null;

  const escalate = gaps.filter((g) => g.status === "escalate");
  const affectedIds = new Set(escalate.flatMap((g) => g.affected.map((a) => a.facilityId)));
  const people = state.facilities.filter((f) => affectedIds.has(f.id)).reduce((n, f) => n + f.catchmentPopulation, 0);
  const earliest = [...gaps].filter((g) => g.status === "escalate" || g.status === "watch").sort((a, b) => (a.daysToDistrictStockout ?? Infinity) - (b.daysToDistrictStockout ?? Infinity))[0];
  const open = escalations.filter((e) => e.stage !== "resolved");

  const select = (id: string) => {
    setPicked(id);
    dispatch({ type: "SELECT_MEDICINE", medicineId: id });
  };

  return (
    <div className="view">
      <ViewHeader
        kicker="State escalations"
        title="Gaps the district cannot close"
        lede={escalate.length
          ? `${escalate.length === 1 ? "One medicine is" : `${escalate.length} medicines are`} short beyond what every safe surplus and the district warehouse can cover. Moving stock between clinics will not fix this; the state has to supply it. Every figure here comes from the stock ledger.`
          : "Every current shortage can be closed with safe surplus or the district warehouse. Medicines appear here as soon as that stops being true."}
      />

      <section className={s.summary} aria-label="Escalation summary">
        <div className={s.stat}>
          <span className={s.statLabel}>Medicines needing state supply</span>
          <span className={s.statValue}>{escalate.length}<small>of {gaps.length}</small></span>
          <span className={s.statNote}>{escalate.map((g) => g.medicine.name).join(", ") || "None"}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>Facilities below required cover</span>
          <span className={s.statValue}>{affectedIds.size}<small>facilities</small></span>
          <span className={s.statNote}>{fmtUnits(people)} people in their catchments</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>Earliest district-wide stockout</span>
          <span className={s.statValue}>{earliest?.districtStockoutDate ? dateOnly(earliest.districtStockoutDate) : "None"}</span>
          <span className={s.statNote}>{earliest ? `${earliest.medicine.name}, even with full redistribution` : "No projected district stockout"}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>Open escalations</span>
          <span className={s.statValue}>{open.length}</span>
          <span className={s.statNote}>{open.length ? open.map((e) => `${state.medicines.find((m) => m.id === e.medicineId)?.name ?? e.medicineId}: ${STAGE_LABEL[e.stage].toLowerCase()}`).join("; ") : "Nothing raised yet"}</span>
        </div>
      </section>

      <Panel kicker="All medicines, worst first" title="Supply-gap board">
        <GapBoard
          gaps={gaps}
          selected={selectedId}
          onSelect={select}
          escalationFor={(id) => activeEscalation(escalations, id) ?? escalations.find((e) => e.medicineId === id)}
          decisionsFor={(id) => linkedDecisions(state.decisions, id).length}
        />
      </Panel>

      {gap ? <GapDetail gap={gap} escalations={escalations} key={gap.medicineId} pushToast={pushToast} /> : null}

      {escalations.length ? (
        <Panel kicker={`${escalations.length} raised`} title="Escalation register">
          <ul className={s.register}>
            {escalations.map((e) => {
              const m = state.medicines.find((x) => x.id === e.medicineId);
              return (
                <li key={e.id}>
                  <button type="button" className={s.regRow} onClick={() => select(e.medicineId)}>
                    <span className={s.regMed}>{m ? `${m.name} ${m.strength}` : e.medicineId}</span>
                    <StagePill esc={e} />
                    <span className={s.regRef}>{e.memoRef ?? e.id}</span>
                    <span className={s.dots} aria-label={`Stage ${STAGES.indexOf(e.stage) + 1} of ${STAGES.length}`}>
                      {STAGES.map((st, i) => <i key={st} data-on={i <= STAGES.indexOf(e.stage)} />)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      <Panel kicker="Is supply arriving when planned?" title="Lead-time watch">
        <LeadTimeWatch state={state} watches={watches} selected={selectedId} onSelect={select} />
      </Panel>
    </div>
  );
}

function GapDetail({ gap, escalations, pushToast }: { gap: SupplyGap; escalations: Escalation[]; pushToast: ReturnType<typeof useShell>["pushToast"] }) {
  const { state } = useDistrict();
  const label = `${gap.medicine.name} ${gap.medicine.strength}`;
  const shown = gap.affected.slice(0, 8);
  return (
    <div className={s.detail}>
      <div className={s.stack}>
        <Panel kicker={label} title={gap.gapUnits > 0 ? `${fmtUnits(gap.gapUnits)} ${gap.medicine.unit} short after every local option` : "Local options cover the need"} actions={<StatusLabel status={gap.status} />}>
          {gap.needUnits > 0 ? <GapWaterfall gap={gap} /> : <p className={s.empty}>No facility is below {gap.thresholdDays} days of {gap.medicine.name}.</p>}
          <ul className={s.reasons}>
            {gap.reasons.map((r) => <li key={r}>{r}</li>)}
            <li>
              Upstream: {gap.upstream.status}. {gap.upstream.note}
              {gap.upstream.expectedOn ? ` Next consignment ${dateOnly(gap.upstream.expectedOn)}.` : ""}
            </li>
            {gap.districtStockoutDate ? <li>At current use the district runs out on {dateOnly(gap.districtStockoutDate)} even if every unit is moved to where it is needed.</li> : null}
          </ul>
        </Panel>
        {gap.affected.length ? (
          <Panel kicker={`${gap.affected.length} facilities · ${fmtUnits(gap.affectedPopulation)} people`} title="Who runs short">
            <table className={s.facTable}>
              <thead>
                <tr><th scope="col">Facility</th><th scope="col">Block</th><th scope="col">Status</th><th scope="col" className={s.r}>Stock</th><th scope="col" className={s.r}>Needs</th><th scope="col" className={s.r}>Catchment</th></tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.facilityId}>
                    <td>{a.name}</td>
                    <td className="muted">{a.block}</td>
                    <td><RiskChip risk={a.risk} days={a.daysOfStock ?? undefined} size="sm" /></td>
                    <td className={`${s.r} num`}>{fmtUnits(a.stock)}</td>
                    <td className={`${s.r} num`}>{fmtUnits(a.needUnits)}</td>
                    <td className={`${s.r} num`}>{fmtUnits(a.population)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {gap.affected.length > shown.length ? <p className={s.more}>and {gap.affected.length - shown.length} more; the memo annexure lists all.</p> : null}
          </Panel>
        ) : null}
      </div>
      <EscalationPanel gap={gap} escalations={escalations} decisions={state.decisions} pushToast={pushToast} />
    </div>
  );
}

function EscalationPanel({ gap, escalations, decisions, pushToast }: {
  gap: SupplyGap;
  escalations: Escalation[];
  decisions: DecisionRecord[];
  pushToast: ReturnType<typeof useShell>["pushToast"];
}) {
  const { state, dispatch } = useDistrict();
  const esc = activeEscalation(escalations, gap.medicineId);
  const last = escalations.find((e) => e.medicineId === gap.medicineId && e.stage === "resolved");
  const [memos, setMemos] = useState<Record<string, MemoResponse>>({});
  const memo = esc ? memos[esc.id] ?? memoCache.get(esc.id) ?? null : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const actor = `${state.district.officer.name} (DHO)`;
  const label = `${gap.medicine.name} ${gap.medicine.strength}`;
  const linked = linkedDecisions(decisions, gap.medicineId);
  const ref = esc ? memoReference(state.district.name, esc.id, gap.medicineId, esc.openedAt) : null;

  const open = () => {
    const id = newEscalationId(gap.medicineId, state.now, nonce().slice(-4));
    const ids = linked.map((d) => d.id);
    dispatch({
      type: "ADD_TIMELINE",
      event: stageEvent({
        escalationId: id, medicineId: gap.medicineId, stage: "draft", at: state.now, actor, nonce: nonce(),
        title: `Escalation opened: ${label}, ${fmtUnits(gap.gapUnits)} ${gap.medicine.unit} short district-wide`,
        detail: `Need ${fmtUnits(gap.needUnits)}, safe surplus ${fmtUnits(gap.transferableUnits)}, warehouse ${fmtUnits(gap.warehouseStock)}; ${gap.affected.length} facilities, ${fmtUnits(gap.affectedPopulation)} people.${ids.length ? ` decisions: ${ids.join(",")}` : ""}`,
      }),
    });
    pushToast({ title: `Escalation opened for ${label}`, detail: "Draft the memo, then mark it sent once it is dispatched.", tone: "risk" });
  };

  const draft = async () => {
    if (!esc || !ref) return;
    setBusy(true);
    setError(null);
    try {
      const lead = computeLeadTimeWatches(state).find((w) => w.medicineId === gap.medicineId) ?? null;
      const facts = buildMemoFacts(state, gap, lead, ref);
      const res = await fetch("/api/escalations/memo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facts }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MemoResponse;
      memoCache.set(esc.id, json);
      setMemos((m) => ({ ...m, [esc.id]: json }));
    } catch (e) {
      setError(`Could not draft the memo (${e instanceof Error ? e.message : "network error"}). Try again.`);
    } finally {
      setBusy(false);
    }
  };

  const advance = (to: EscalationStage) => {
    if (!esc) return;
    const text = note.trim();
    const titles: Record<EscalationStage, string> = {
      draft: "",
      sent: `Escalation sent to state: ${label}${memo ? `, requesting ${fmtUnits(gap.gapUnits)} ${gap.medicine.unit} by ${fmtLongDate(memo.memo.requestedDeliveryDate)}` : ""}`,
      acknowledged: `State acknowledged ${label} escalation`,
      scheduled: `State supply scheduled: ${label}`,
      resolved: `Escalation resolved: ${label}`,
    };
    const detail = [text, to === "sent" && ref ? `ref: ${ref}` : "", to === "sent" && memo ? `Memo: ${memo.memo.subject}` : ""].filter(Boolean).join(" · ");
    dispatch({ type: "ADD_TIMELINE", event: stageEvent({ escalationId: esc.id, medicineId: gap.medicineId, stage: to, at: state.now, actor, nonce: nonce(), title: titles[to], detail: detail || undefined }) });
    if (to === "sent") {
      // The officer has acted on any pending escalate_supply_gap recommendation for this medicine.
      for (const d of linked.filter((x) => x.status === "pending")) dispatch({ type: "SET_DECISION_STATUS", decisionId: d.id, status: "approved", actor });
    }
    setNote("");
    pushToast({ title: titles[to], tone: to === "resolved" ? "success" : "neutral" });
  };

  const next = esc ? nextStage(esc.stage) : null;
  const reached = (st: EscalationStage) => (esc ? STAGES.indexOf(st) <= STAGES.indexOf(esc.stage) : false);
  const entryFor = (st: EscalationStage) => esc?.history.filter((h) => h.stage === st).at(-1);

  return (
    <div className={s.stack}>
      <Panel kicker={esc ? (ref ?? esc.id) : "Escalation"} title={esc ? `Escalation: ${STAGE_LABEL[esc.stage].toLowerCase()}` : "Not raised"}>
        {esc ? (
          <>
            <ol className={s.steps} aria-label="Escalation stages">
              {STAGES.map((st) => {
                const e = entryFor(st);
                const state_ = esc.stage === st ? "current" : reached(st) ? "done" : "todo";
                return (
                  <li key={st} className={s.step} data-state={state_} aria-current={esc.stage === st ? "step" : undefined}>
                    <i aria-hidden />
                    <span>{STAGE_LABEL[st]}</span>
                    {e ? <time dateTime={e.at}>{fmtDate(e.at)}</time> : null}
                  </li>
                );
              })}
            </ol>
            <div className={s.actions}>
              {esc.stage === "draft" ? (
                <Button variant={memo ? "secondary" : "primary"} size="sm" icon={<FileText size={14} />} onClick={draft} loading={busy}>
                  {memo ? "Redraft memo" : "Draft memo"}
                </Button>
              ) : null}
              {memo ? <Button size="sm" variant="secondary" icon={<Printer size={14} />} onClick={() => window.print()}>Print</Button> : null}
              {next ? (
                <>
                  {next !== "sent" ? <input className={s.noteInput} value={note} onChange={(e) => setNote(e.target.value)} placeholder={next === "scheduled" ? "Dispatch date and quantity from the state" : "Note (optional)"} aria-label="Note for this stage" /> : null}
                  <Button size="sm" variant={next === "sent" && !memo ? "secondary" : "primary"} icon={next === "sent" ? <Send size={14} /> : undefined} onClick={() => advance(next)}>
                    {STAGE_ACTION[next]}
                  </Button>
                </>
              ) : null}
            </div>
            {error ? <p className={s.err} role="alert">{error}</p> : null}
            {esc.stage === "draft" && !memo ? <p className={s.explain} style={{ marginTop: 10 }}>Draft the memo first. Code computes every figure; the model only writes the wording, and any number it uses is checked against the ledger.</p> : null}
            <ol className={s.history} aria-label="Stage history">
              {[...esc.history].reverse().map((h) => (
                <li key={h.eventId}>
                  <time dateTime={h.at}>{fmtDateTime(h.at)}</time>
                  <p>{STAGE_LABEL[h.stage]}<small>{h.actor}{h.note ? ` · ${h.note.replace(/ ?decisions: [\w,.-]+/, "").replace(/ ?· ?ref: \S+/, "")}` : ""}</small></p>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <p className={s.explain}>
              {gap.status === "escalate"
                ? `${fmtUnits(gap.gapUnits)} ${gap.medicine.unit} cannot be found anywhere in the district. Opening an escalation records it on the timeline and drafts a memo to the state with the figures above.`
                : gap.status === "watch"
                  ? "Local stock covers today's need, but the state supply line is not reliable. You can raise it early."
                  : "Local options cover the need. An escalation is not needed unless the supply line changes."}
            </p>
            {last ? <p className={s.more}>Last escalation resolved {fmtAgo(last.updatedAt, state.now)}.</p> : null}
            <div className={s.actions} style={{ marginTop: 12 }}>
              <Button variant={gap.status === "escalate" ? "primary" : "secondary"} size="sm" onClick={open} disabled={gap.status === "clear"}>
                {STAGE_ACTION.draft}
              </Button>
            </div>
          </>
        )}
        <div className={s.linked}>
          <div className={s.linkedHead}>
            <span>Decisions API: escalate_supply_gap for {gap.medicine.name}</span>
            <Link href="/decisions">All decisions</Link>
          </div>
          {linked.length ? (
            <ul>
              {linked.slice(0, 5).map((d) => (
                <li key={d.id}>
                  <span>
                    <Sparkles size={12} aria-hidden style={{ display: "inline", verticalAlign: "-1px", color: "var(--accent)", marginRight: 6 }} />
                    {state.facilities.find((f) => f.id === d.facilityId)?.name ?? d.facilityId}
                    <span className="muted"> · {d.status}{d.source === "demo_fallback" ? " · demo fallback" : ""}</span>
                  </span>
                  <span className={s.conf}>{Math.round(d.confidence * 100)}%</span>
                </li>
              ))}
            </ul>
          ) : <p className={s.more} style={{ paddingTop: 0 }}>No recommendation to escalate yet. When the Decisions API picks escalate_supply_gap for this medicine, it is linked here.</p>}
        </div>
      </Panel>

      {esc && memo ? (
        <Panel kicker={memo.memo.ref} title="Memo to the state">
          <div className={s.memoBar}>
            <span className={s.source} data-live={memo.source === "live"}>
              {memo.source === "live" ? <Sparkles aria-hidden /> : <FileText aria-hidden />}
              {memo.source === "live" ? `Drafted by ${memo.model ?? "OpenAI"} · numbers verified` : `Template memo · ${FALLBACK_REASON[memo.fallbackReason ?? "request_failed"]}`}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>Requested by {dateOnly(memo.memo.requestedDeliveryDate)}</span>
          </div>
          <MemoSheet memo={memo.memo} response={memo} district={state.district.name} officer={state.district.officer} />
          <PrintPortal>
            <MemoSheet memo={memo.memo} response={memo} district={state.district.name} officer={state.district.officer} />
          </PrintPortal>
        </Panel>
      ) : null}
    </div>
  );
}
