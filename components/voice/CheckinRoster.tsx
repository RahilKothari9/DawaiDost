"use client";
// OWNER: voice agent. Weekly voice check-in roster for every facility, with "Call now" and a
// sequential "Run all due calls" simulation (scripted pharmacist answers → live structured extraction → store).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CircleCheck, LoaderCircle, Mic, PhoneCall, PhoneMissed, Play, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import type { DistrictState, VoiceReport } from "@/lib/district/types";
import { requestExtraction, requestVoiceCall } from "@/lib/voice/client";
import { buildFacilityFacts, slipMedicineFor } from "@/lib/voice/facts";
import { buildRoster, needsCall, relativeTime, simulatedNoAnswer, STATUS_ORDER, type RosterEntry, type RosterStatus } from "@/lib/voice/roster";
import { pharmacistSimScript, scriptToTranscript } from "@/lib/voice/scripts";
import type { VoiceMode } from "@/lib/voice/types";
import styles from "./roster.module.css";

export type CheckinRosterProps = {
  onStartCall?: (facilityId: string, mode?: VoiceMode) => void;
  /** Max rows before the list scrolls (default: all). */
  maxRows?: number;
  className?: string;
};

const STATUS_LABEL: Record<RosterStatus, string> = { reported: "Reported", due: "Due today", overdue: "Overdue", recount: "Recount requested", unreachable: "Unreachable" };

type RunOutcome = { facilityId: string; name: string; phase: "dialing" | "talking" | "extracting" | "done" | "no_answer"; line?: string; recorded?: number; recounts?: number; source?: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function CheckinRoster({ onStartCall, maxRows, className }: CheckinRosterProps) {
  const { state, dispatch } = useDistrict();
  const [unreachable, setUnreachable] = useState<Set<string>>(() => new Set());
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<RunOutcome[]>([]);
  const [filter, setFilter] = useState<RosterStatus | "all">("all");
  const stateRef = useRef<DistrictState>(state);
  const cancelRef = useRef(false);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => () => { cancelRef.current = true; }, []);

  const roster = useMemo(() => buildRoster(state, unreachable).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name)), [state, unreachable]);
  const counts = useMemo(() => roster.reduce<Record<RosterStatus, number>>((acc, e) => ({ ...acc, [e.status]: acc[e.status] + 1 }), { reported: 0, due: 0, overdue: 0, recount: 0, unreachable: 0 }), [roster]);
  const dueList = roster.filter(needsCall);
  const shown = filter === "all" ? roster : roster.filter((e) => e.status === filter);
  const activeId = running ? outcomes.find((o) => o.phase !== "done" && o.phase !== "no_answer")?.facilityId : undefined;

  const startCall = useCallback((facilityId: string, mode: VoiceMode = "pharmacist_sim") => {
    dispatch({ type: "SELECT_FACILITY", facilityId });
    if (onStartCall) onStartCall(facilityId, mode);
    else requestVoiceCall({ facilityId, mode, autoStart: true });
  }, [dispatch, onStartCall]);

  const update = (facilityId: string, patch: Partial<RunOutcome>) =>
    setOutcomes((all) => all.map((o) => (o.facilityId === facilityId ? { ...o, ...patch } : o)));

  const runAll = useCallback(async () => {
    const targets = buildRoster(stateRef.current, unreachable).filter(needsCall).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    if (!targets.length) return;
    cancelRef.current = false;
    setRunning(true);
    setOutcomes(targets.map((t) => ({ facilityId: t.facilityId, name: t.name, phase: "dialing" })));
    const weekKey = String(Math.floor(new Date(stateRef.current.now).getTime() / (7 * 864e5)));

    for (const entry of targets) {
      if (cancelRef.current) break;
      dispatch({ type: "SELECT_FACILITY", facilityId: entry.facilityId });
      await wait(650);
      if (simulatedNoAnswer(entry.facilityId, entry.status, weekKey)) {
        update(entry.facilityId, { phase: "no_answer", line: "No answer after 3 rings — retry scheduled" });
        setUnreachable((s) => new Set(s).add(entry.facilityId));
        dispatch({ type: "ADD_TIMELINE", event: { id: `voice-noanswer-${entry.facilityId}-${Date.now()}`, at: stateRef.current.now, kind: "system", title: `No answer from ${entry.name}`, detail: "Weekly voice check-in unanswered; retry scheduled and block supervisor notified (simulated).", facilityId: entry.facilityId, actor: "Dawai Dost voice agent" } });
        continue;
      }
      const base = buildFacilityFacts(stateRef.current, entry.facilityId);
      const slip = entry.status === "recount" ? null : slipMedicineFor(entry.facilityId, base.medicines.map((m) => m.id), weekKey);
      const facts = slip ? buildFacilityFacts(stateRef.current, entry.facilityId, { slipMedicineId: slip }) : base;
      const steps = pharmacistSimScript(facts);
      update(entry.facilityId, { phase: "talking" });
      for (const s of steps) {
        if (cancelRef.current) break;
        update(entry.facilityId, { line: s.text });
        await wait(170);
      }
      if (cancelRef.current) break;
      update(entry.facilityId, { phase: "extracting", line: "Structured extraction…" });
      const extraction = await requestExtraction(facts, scriptToTranscript(steps));
      const actor = `${facts.facility.pharmacistName} (pharmacist)`;
      let recorded = 0, recounts = 0;
      extraction.reports.forEach((r: VoiceReport) => {
        if (r.needsRecount) {
          recounts++;
          dispatch({ type: "REQUEST_RECOUNT", facilityId: r.facilityId, medicineId: r.medicineId, reason: r.reason ?? "Count could not be verified." });
        } else {
          recorded++;
          dispatch({ type: "RECORD_VOICE_REPORT", report: r, actor });
        }
      });
      setUnreachable((s) => { if (!s.has(entry.facilityId)) return s; const n = new Set(s); n.delete(entry.facilityId); return n; });
      update(entry.facilityId, { phase: "done", recorded, recounts, source: extraction.source === "live" ? `live · ${extraction.model}` : `fallback parser` , line: undefined });
      await wait(250);
    }
    setRunning(false);
  }, [dispatch, unreachable]);

  const stop = () => { cancelRef.current = true; setRunning(false); };

  return (
    <section className={`${styles.roster} ${className ?? ""}`} aria-label="Weekly voice check-in roster">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}><CalendarClock size={12} aria-hidden="true" />Weekly voice check-ins</p>
          <h2 className={styles.title}>Call roster</h2>
        </div>
        {running ? (
          <button className={styles.ghost} onClick={stop}><Square size={13} aria-hidden="true" />Stop run</button>
        ) : (
          <button className={styles.primary} onClick={() => void runAll()} disabled={!dueList.length} title="Plays a quick simulated check-in for each due facility, extracts counts, and records them.">
            <Play size={14} aria-hidden="true" />{dueList.length ? `Run all due calls (${dueList.length})` : "No calls due"}
          </button>
        )}
      </header>

      <div className={styles.summary} role="group" aria-label="Filter by status">
        <button data-active={filter === "all"} onClick={() => setFilter("all")}><b>{roster.length}</b>All</button>
        {(["reported", "due", "overdue", "recount", "unreachable"] as RosterStatus[]).map((s) => (
          <button key={s} data-status={s} data-active={filter === s} onClick={() => setFilter(filter === s ? "all" : s)}>
            <b>{counts[s]}</b>{STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <div className={styles.progress} aria-hidden="true">
        {(["reported", "recount", "due", "overdue", "unreachable"] as RosterStatus[]).map((s) => (
          <span key={s} data-status={s} style={{ flexGrow: counts[s] }} />
        ))}
      </div>

      {outcomes.length > 0 && (
        <div className={styles.runLog} aria-live="polite">
          <p className={styles.runHead}>
            {running ? <LoaderCircle size={12} className={styles.spin} aria-hidden="true" /> : <CircleCheck size={12} aria-hidden="true" />}
            {running ? "Running due calls · simulated pharmacist answers, live extraction" : `Run complete · ${outcomes.filter((o) => o.phase === "done").length} reported, ${outcomes.filter((o) => o.phase === "no_answer").length} unanswered`}
            {!running && <button className={styles.linkBtn} onClick={() => setOutcomes([])}><RotateCcw size={11} aria-hidden="true" />Clear</button>}
          </p>
          <ol>
            {outcomes.map((o) => (
              <li key={o.facilityId} data-phase={o.phase}>
                <span className={styles.runName}>{o.name}</span>
                <span className={styles.runPhase}>
                  {o.phase === "dialing" && "Waiting"}
                  {o.phase === "talking" && "On call"}
                  {o.phase === "extracting" && "Extracting"}
                  {o.phase === "no_answer" && "No answer"}
                  {o.phase === "done" && `${o.recorded} recorded${o.recounts ? ` · ${o.recounts} recount` : ""}`}
                </span>
                {o.line && <span className={styles.runLine} lang="hi">{o.line}</span>}
                {o.source && <span className={styles.runSource}>{o.source}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <ul className={styles.list} style={maxRows ? { maxHeight: maxRows * 58 } : undefined}>
        {shown.map((e: RosterEntry) => (
          <li key={e.facilityId} className={styles.row} data-status={e.status} data-active={activeId === e.facilityId ? "1" : "0"} data-selected={state.selectedFacilityId === e.facilityId ? "1" : "0"}>
            <span className={styles.dot} data-status={e.status} aria-hidden="true" />
            <div className={styles.who}>
              <button className={styles.nameBtn} onClick={() => dispatch({ type: "SELECT_FACILITY", facilityId: e.facilityId })}>{e.name}</button>
              <span className={styles.meta}>{e.pharmacistName} · {e.block} · {e.language === "hi" ? "हिन्दी" : "English"}</span>
            </div>
            <div className={styles.when}>
              <span className={styles.status} data-status={e.status}>
                {e.status === "unreachable" ? <PhoneMissed size={11} aria-hidden="true" /> : e.status === "recount" ? <TriangleAlert size={11} aria-hidden="true" /> : null}
                {STATUS_LABEL[e.status]}
              </span>
              <span className={styles.meta}>
                {e.status === "recount" && e.recountMedicines.length ? `${e.recountMedicines.length} medicine${e.recountMedicines.length > 1 ? "s" : ""} · ` : ""}
                last {relativeTime(e.lastReportAt, state.now)} · slot {e.slotLabel}
              </span>
            </div>
            <div className={styles.actions}>
              <button className={styles.call} onClick={() => startCall(e.facilityId, "pharmacist_sim")} disabled={running} aria-label={`Call ${e.name} now`}>
                <PhoneCall size={13} aria-hidden="true" />Call now
              </button>
              <button className={styles.iconBtn} onClick={() => startCall(e.facilityId, "caller_agent")} disabled={running} title="Answer this check-in yourself as the pharmacist (mic)" aria-label={`Answer ${e.name} check-in with your microphone`}>
                <Mic size={13} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className={styles.emptyRow}>No facilities with this status.</li>}
      </ul>
    </section>
  );
}
