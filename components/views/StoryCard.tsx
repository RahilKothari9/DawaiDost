"use client";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { ArrowRight, Check, Mic, RotateCcw, SkipForward, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { useDistrict } from "@/lib/district/store";
import type { DecisionRecord, Transfer } from "@/lib/district/types";
import { VoiceConsole } from "@/components/voice/VoiceConsole";
import { DecisionCard } from "@/components/ai/DecisionCard";
import { Badge, Button } from "@/components/ui";
import { ACTION_LABEL, fmtDate, fmtDays } from "@/components/shell/format";
import { DecisionMark } from "./parts";

type Snapshot = { timeline: Set<string>; decisions: Set<string>; transfers: Set<string>; skipVoice: boolean };

const STEPS = [
  { key: "voice", name: "Voice check", by: "Pharmacist · Realtime API" },
  { key: "forecast", name: "Forecast", by: "Deterministic code" },
  { key: "decide", name: "Decide", by: "OpenAI Decisions API", ai: true },
  { key: "approve", name: "Approve", by: "District officer" },
  { key: "move", name: "Move medicine", by: "Transfer on the road" },
] as const;

/** The Saraswati metformin case, walked through the whole loop. All progress is derived from district state. */
export function StoryCard() {
  const { state, dispatch, assessments, getAssessment, getRecord } = useDistrict();
  const target = state.facilities.find((f) => f.id === "saraswati") ?? state.facilities.find((f) => /saraswati/i.test(f.name)) ?? state.facilities[0];
  const medicine = state.medicines.find((m) => m.id === "metformin-500") ?? state.medicines[0];
  const [run, setRun] = useState<Snapshot | null>(null);

  const a = target && medicine ? getAssessment(target.id, medicine.id) : undefined;
  const rec = target && medicine ? getRecord(target.id, medicine.id) : undefined;
  const donor = useMemo(() => {
    if (!medicine || !target) return undefined;
    const best = assessments.filter((x) => x.medicineId === medicine.id && x.facilityId !== target.id && x.transferable > 0).sort((x, y) => y.transferable - x.transferable)[0];
    return best ? { ...best, name: state.facilities.find((f) => f.id === best.facilityId)?.name ?? best.facilityId } : undefined;
  }, [assessments, medicine, target, state.facilities]);

  const progress = useMemo(() => {
    if (!run || !target || !medicine) return null;
    const isTarget = (x: { facilityId?: string; medicineId?: string }) => x.facilityId === target.id && x.medicineId === medicine.id;
    const voiceDone = run.skipVoice || state.timeline.some((e) => !run.timeline.has(e.id) && isTarget(e) && (e.kind === "voice_report" || e.kind === "count_verified"));
    const recount = state.timeline.some((e) => !run.timeline.has(e.id) && isTarget(e) && e.kind === "recount_requested");
    const decision: DecisionRecord | undefined = state.decisions.find((d) => !run.decisions.has(d.id) && isTarget(d));
    const approved = decision && (decision.status === "approved" || decision.status === "acknowledged");
    const rejected = decision?.status === "rejected";
    const transfer: Transfer | undefined = decision
      ? state.transfers.find((t) => (decision.transferId && t.id === decision.transferId) || t.decisionId === decision.id) ??
        state.transfers.find((t) => !run.transfers.has(t.id) && t.toId === target.id && t.medicineId === medicine.id)
      : undefined;
    return { voiceDone, recount, decision, approved, rejected, transfer };
  }, [run, state.timeline, state.decisions, state.transfers, target, medicine]);

  if (!target || !medicine) return null;

  const start = (skipVoice: boolean) => {
    dispatch({ type: "SELECT_FACILITY", facilityId: target.id });
    dispatch({ type: "SELECT_MEDICINE", medicineId: medicine.id });
    setRun({
      timeline: new Set(state.timeline.map((e) => e.id)),
      decisions: new Set(state.decisions.map((d) => d.id)),
      transfers: new Set(state.transfers.map((t) => t.id)),
      skipVoice,
    });
  };

  // Which loop step is current: 0..4, 5 = finished.
  let current = -1;
  if (progress) {
    const t = progress.transfer;
    const nonTransferDone = progress.approved && progress.decision?.action !== "transfer_surplus";
    if (!progress.voiceDone) current = 0;
    else if (!progress.decision || (!progress.approved && !progress.rejected)) current = 2;
    else if (progress.rejected) current = 3;
    else if (nonTransferDone || t?.status === "delivered") current = 5;
    else current = 4;
  }
  const stepState = (i: number) => {
    if (current < 0) return "";
    if (i === 1) return current >= 2 ? "is-done" : current === 0 ? "" : "is-active";
    if (i < current) return "is-done";
    if (i === current) return "is-active";
    return "";
  };

  const days = a?.daysOfStock ?? 0;
  const threshold = a?.thresholdDays ?? medicine.leadTimeDays + medicine.safetyBufferDays;
  const unit = medicine.unit.split(" ")[0];

  return (
    <section className="story" id="story" aria-labelledby="story-title">
      <div className="story__top">
        <div>
          <div className="story__eyebrow">
            <Badge dot>{a?.risk === "stockout" ? "Stocked out" : "Projected stockout"}</Badge>
            <span>{target.name} · {target.block} block · {medicine.name} {medicine.strength}</span>
          </div>
          <h2 className="story__title" id="story-title">
            {a && a.risk !== "ok" && a.risk !== "surplus" ? (
              <>
                {target.name.replace(/ PHC$/, "")} runs out of {medicine.name.toLowerCase()} in <em>{fmtDays(days)} days</em>. Resupply takes {medicine.leadTimeDays}.
              </>
            ) : (
              <>{target.name.replace(/ PHC$/, "")} has {fmtDays(days)} days of {medicine.name.toLowerCase()}. The shelf is covered.</>
            )}
          </h2>
          <div className="story__facts">
            <span><b>{rec?.stock ?? "—"}</b> {unit}s on the shelf</span>
            <span><b>{rec?.dailyUse ?? "—"}</b> used a day</span>
            {donor ? <span>{donor.name} can spare <b>{donor.transferable}</b></span> : <span>No nearby clinic has safe surplus</span>}
          </div>
        </div>
        <div className="story__gauge" aria-label={`${fmtDays(days)} days of stock against a ${threshold}-day threshold`}>
          <span className="story__days num">{fmtDays(days)}<small>days left</small></span>
          <div>
            <span className="story__vs">needs {threshold} · empty {a?.projectedStockoutDate ? fmtDate(a.projectedStockoutDate) : "—"}</span>
            <div className="story__runway" aria-hidden>
              <i style={{ width: `${Math.min(100, (Math.min(days, threshold * 1.5) / (threshold * 1.5)) * 100)}%` }} />
              <b style={{ left: `${(threshold / (threshold * 1.5)) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      <ol className="loop" aria-label="Response loop">
        {STEPS.map((s, i) => (
          <li key={s.key} className={`loop__step ${"ai" in s && s.ai ? "is-ai" : ""} ${stepState(i)}`} aria-current={current === i ? "step" : undefined}>
            <span className="loop__n">{stepState(i) === "is-done" ? <Check size={12} aria-label="done" /> : `0${i + 1}`}</span>
            <span className="loop__name">{s.name}</span>
            <span className="loop__by">{s.by}</span>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait" initial={false}>
        {!progress ? (
          <motion.div key="cta" className="story__cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p>
              Call the pharmacist in Hindi to confirm the count, let code forecast the gap, and let the Decisions API choose one of four district moves. You approve it.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="ghost" size="md" icon={<SkipForward size={15} />} onClick={() => start(true)} style={{ color: "#c9c5b8" }}>
                Use today&apos;s count
              </Button>
              <Button variant="decision" size="lg" icon={<Mic size={16} />} onClick={() => start(false)}>
                Run voice check + Decisions API
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="stage" className="story__stage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            {current === 0 ? (
              <>
                <div className="story__stage-head">
                  <div>
                    <h3>Voice check with {target.pharmacist.name}</h3>
                    <p>A short call in Hindi. The count is extracted, checked against last week, and written to the ledger.</p>
                  </div>
                  <Button size="sm" variant="ghost" icon={<SkipForward size={14} />} onClick={() => setRun((r) => (r ? { ...r, skipVoice: true } : r))}>
                    Skip call, use verified count
                  </Button>
                </div>
                <VoiceConsole facilityId={target.id} mode="checkin" />
              </>
            ) : null}

            {current === 2 || (current === 3 && progress.rejected) ? (
              <>
                <div className="story__stage-head">
                  <div>
                    <h3><DecisionMark size="lg" label="Decisions API" /></h3>
                    <p>
                      {progress.recount ? "The count check asked for a recount. " : "Count confirmed. "}
                      The API weighs the verified count, daily use, lead time and nearby surplus, then picks one of four moves.
                    </p>
                  </div>
                  {progress.decision ? <Badge tone="accent">{ACTION_LABEL[progress.decision.action]}</Badge> : null}
                </div>
                <DecisionCard facilityId={target.id} medicineId={medicine.id} />
              </>
            ) : null}

            {current === 4 && progress.transfer ? (
              <TransferStage transfer={progress.transfer} />
            ) : current === 4 ? (
              <div className="story__stage-head">
                <div>
                  <h3>Approved. Waiting for the transfer to be drafted.</h3>
                  <p>The transfer appears on the map and the transfers board as soon as it is created.</p>
                </div>
                <Link href="/transfers"><Button size="sm" trailing={<ArrowRight size={14} />}>Transfers board</Button></Link>
              </div>
            ) : null}

            {current === 5 ? (
              <div className="story__stage-head">
                <div className="story__done">
                  <strong>
                    {progress.transfer?.status === "delivered"
                      ? `Delivered. ${target.name} is covered before a patient met an empty shelf.`
                      : `${ACTION_LABEL[progress.decision!.action]}: approved and on the record.`}
                  </strong>
                  <p className="muted" style={{ fontSize: 13 }}>One call, one forecast, one decision, one approval. Every step is in the activity log with a time and an owner.</p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link href="/activity"><Button size="sm">Open the record</Button></Link>
                  <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setRun(null)}>Run again</Button>
                </div>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function TransferStage({ transfer }: { transfer: Transfer }) {
  const { state, dispatch } = useDistrict();
  const name = (id: string) => state.facilities.find((f) => f.id === id)?.name ?? id;
  const med = state.medicines.find((m) => m.id === transfer.medicineId);
  const moving = transfer.status === "in_transit";
  return (
    <div className="story__stage-head">
      <div>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Truck size={16} aria-hidden style={{ color: "var(--accent)" }} />
          {transfer.quantity} {med?.unit.split(" ")[0]}s · {name(transfer.fromId)} → {name(transfer.toId)}
        </h3>
        <p>
          {moving
            ? `On the road: ${transfer.distanceKm} km, about ${transfer.etaHours} hours. Watch it move on the map, or advance the clock.`
            : `Approved. ${name(transfer.fromId)} keeps its ${med?.reserveDays ?? 7}-day reserve. Dispatch when the vehicle is ready.`}
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {moving ? (
          <>
            <Button size="sm" onClick={() => dispatch({ type: "ADVANCE_CLOCK", hours: 6 })}>Advance 6 hours</Button>
            <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => dispatch({ type: "SET_TRANSFER_STATUS", transferId: transfer.id, status: "delivered" })}>
              Mark delivered
            </Button>
          </>
        ) : (
          <Button size="sm" variant="decision" icon={<Truck size={14} />} onClick={() => dispatch({ type: "SET_TRANSFER_STATUS", transferId: transfer.id, status: "in_transit" })}>
            Dispatch transfer
          </Button>
        )}
      </div>
    </div>
  );
}
