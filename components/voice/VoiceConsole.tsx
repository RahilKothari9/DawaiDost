"use client";
// OWNER: voice agent. Three-mode OpenAI Realtime voice console:
//  - pharmacist_sim: the browser plays the Dawai Dost caller; Realtime plays the facility's pharmacist (fixed facts).
//  - caller_agent:   you are the pharmacist (live mic); Realtime is the check-in agent with check_count/confirm_count tools.
//  - availability:   ASHA / patient line; Realtime answers via check_availability from the district store.
// Every path has a clearly labeled scripted fallback. Completed calls dispatch RECORD_VOICE_REPORT / REQUEST_RECOUNT.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, CircleCheck, HeartHandshake, Languages, LoaderCircle, Mic, MicOff, Phone, PhoneOff, RotateCcw,
  Sparkles, Timer, TriangleAlert, UserRound, Volume2, Wrench,
} from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import type { VoiceReport } from "@/lib/district/types";
import { availabilityAnswerHindi, checkAvailability } from "@/lib/voice/availability";
import { requestExtraction, requestGloss, playVoiceNote, stopVoiceNote, VOICE_CALL_EVENT, type VoiceCallRequest } from "@/lib/voice/client";
import { buildDirectory, buildFacilityFacts, hindiMedicineName } from "@/lib/voice/facts";
import { fallbackExtract } from "@/lib/voice/fallbackExtract";
import { callerAgentScript, callerPrompts, pharmacistSimScript, recountVoiceNote, type ScriptStep } from "@/lib/voice/scripts";
import type { Capture, ExtractResponse, FacilityRef, MedicineFact, SessionResponse, Speaker, TranscriptLine, VoiceFacts, VoiceMode } from "@/lib/voice/types";
import { checkCount, toVoiceReport } from "@/lib/voice/validate";
import { CaptureChips } from "./CaptureChips";
import { TranscriptView } from "./TranscriptView";
import { RealtimeError, useRealtimeCall, type RealtimeFailure, type RealtimeServerEvent } from "./useRealtimeCall";
import { VoiceOrb, type OrbActivity } from "./VoiceOrb";
import styles from "./voice.module.css";

export type VoiceConsoleProps = {
  facilityId?: string;
  /** Legacy prop: "checkin" opens the simulated-pharmacist mode. */
  mode?: "checkin" | "availability";
  /** Preferred: open directly in one of the three modes. */
  initialMode?: VoiceMode;
  /** Start a call as soon as the console mounts. */
  autoStart?: boolean;
  /** Called after reports are dispatched to the store. */
  onReports?: (reports: VoiceReport[]) => void;
  className?: string;
};

type CallState = "idle" | "connecting" | "live" | "extracting" | "complete" | "sample" | "error";

type FacilityFacts = VoiceFacts & { facility: FacilityRef; medicines: MedicineFact[] };

type AvailabilityLog = { id: string; question: string; answer: string; medicine?: string; facility?: string; available?: boolean; alt?: string };

const MODE_META: Record<VoiceMode, { label: string; hint: string; icon: typeof Bot }> = {
  pharmacist_sim: { label: "Simulated pharmacist", hint: "Realtime plays the PHC pharmacist with this facility's synthetic counts.", icon: Bot },
  caller_agent: { label: "You are the pharmacist", hint: "Speak Hindi into your mic. The Dawai Dost agent asks for each count and reads it back.", icon: UserRound },
  availability: { label: "Availability line", hint: "An ASHA worker or patient asks whether a medicine is in stock at a PHC.", icon: HeartHandshake },
};

const FAILURE_COPY: Record<RealtimeFailure, string> = {
  mic_denied: "Microphone permission was blocked.",
  mic_unavailable: "No microphone is available in this browser.",
  session_unavailable: "Live Realtime credentials are unavailable.",
  connect_failed: "Could not connect Realtime audio.",
  timeout: "Realtime did not connect within 12 seconds.",
  api_error: "The Realtime API returned an error.",
};

const BENIGN_ERRORS = new Set(["conversation_already_has_active_response", "response_cancel_not_active", "input_audio_buffer_commit_empty"]);
const DEVANAGARI = /[ऀ-ॿ]/;

let lineSeq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(lineSeq++).toString(36)}`;

function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceConsole(props: VoiceConsoleProps) {
  const { state, dispatch } = useDistrict();
  const realtime = useRealtimeCall();

  const initialMode: VoiceMode = props.initialMode ?? (props.mode === "availability" ? "availability" : "pharmacist_sim");
  const [mode, setMode] = useState<VoiceMode>(initialMode);
  const [localFacilityId, setLocalFacilityId] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [activity, setActivity] = useState<OrbActivity>("idle");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [captures, setCaptures] = useState<Record<string, Capture>>({});
  const [result, setResult] = useState<(ExtractResponse & { dispatched: boolean }) | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [sampleSpeaker, setSampleSpeaker] = useState<"agent" | "user" | null>(null);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [, setTick] = useState(0);
  const [callFacts, setCallFacts] = useState<FacilityFacts | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [injectSlip, setInjectSlip] = useState(false);
  const [glossSource, setGlossSource] = useState<"live" | "fallback" | "script" | null>(null);
  const [availabilityLog, setAvailabilityLog] = useState<AvailabilityLog[]>([]);
  const [voiceNote, setVoiceNote] = useState<{ medicineId: string; via: string } | null>(null);

  const facilities = useMemo(() => state.facilities.filter((f) => f.type !== "WAREHOUSE" && state.stock.some((s) => s.facilityId === f.id)), [state.facilities, state.stock]);
  const facilityId = localFacilityId ?? props.facilityId ?? state.selectedFacilityId ?? facilities[0]?.id ?? "";
  const facility = state.facilities.find((f) => f.id === facilityId);

  // Live preview of the facts the next call would use (frozen into callRef at call start).
  const previewFacts = useMemo<FacilityFacts | null>(
    () => (facility ? buildFacilityFacts(state, facility.id) : null),
    [state, facility],
  );

  const callRef = useRef({
    mode: initialMode as VoiceMode,
    facts: null as FacilityFacts | null,
    directory: null as ReturnType<typeof buildDirectory> | null,
    promptIndex: 0,
    prompts: [] as ReturnType<typeof callerPrompts>,
    endRequested: false,
    finished: false,
    confirmed: new Map<string, { count: number; insisted: boolean }>(),
    lastMedicineAsked: null as string | null,
  });
  const linesRef = useRef<TranscriptLine[]>([]);
  const capturesRef = useRef<Record<string, Capture>>({});
  const timersRef = useRef<number[]>([]);
  const glossQueueRef = useRef<string[]>([]);
  const glossTimerRef = useRef<number | null>(null);
  const handlerRef = useRef<(e: RealtimeServerEvent) => void>(() => undefined);
  const pendingStartRef = useRef<{ mode: VoiceMode } | null>(null);

  // ---------- small state helpers ----------
  const mutateLines = useCallback((fn: (l: TranscriptLine[]) => TranscriptLine[]) => {
    linesRef.current = fn(linesRef.current);
    setLines(linesRef.current);
  }, []);

  const setCapture = useCallback((medicineId: string, patch: Partial<Capture>) => {
    const prev = capturesRef.current[medicineId] ?? { medicineId, state: "pending" as const };
    capturesRef.current = { ...capturesRef.current, [medicineId]: { ...prev, ...patch, medicineId } };
    setCaptures(capturesRef.current);
  }, []);

  const flushGloss = useCallback(async () => {
    glossTimerRef.current = null;
    const ids = glossQueueRef.current.splice(0, 12);
    const targets = ids.map((id) => linesRef.current.find((l) => l.id === id)).filter((l): l is TranscriptLine => Boolean(l?.text));
    if (!targets.length) return;
    const { glosses, source } = await requestGloss(targets.map((t) => t.text));
    setGlossSource(source);
    mutateLines((all) => all.map((l) => {
      const i = targets.findIndex((t) => t.id === l.id);
      return i >= 0 && glosses[i] ? { ...l, gloss: glosses[i] } : l;
    }));
  }, [mutateLines]);

  const queueGloss = useCallback((id: string, text: string) => {
    if (!DEVANAGARI.test(text)) return;
    glossQueueRef.current.push(id);
    if (glossTimerRef.current === null) glossTimerRef.current = window.setTimeout(() => void flushGloss(), 700);
  }, [flushGloss]);

  const addLine = useCallback((speaker: Speaker, text: string, opts: { id?: string; gloss?: string; final?: boolean } = {}) => {
    const line: TranscriptLine = { id: opts.id ?? newId(speaker), speaker, text, gloss: opts.gloss, final: opts.final ?? true, at: Date.now() };
    mutateLines((l) => [...l, line]);
    if (line.final && !opts.gloss && speaker !== "tool" && speaker !== "system") queueGloss(line.id, text);
    return line.id;
  }, [mutateLines, queueGloss]);

  const upsertLine = useCallback((id: string, speaker: Speaker, text: string, final: boolean) => {
    const exists = linesRef.current.some((l) => l.id === id);
    if (exists) mutateLines((all) => all.map((l) => (l.id === id ? { ...l, text, final } : l)));
    else mutateLines((all) => [...all, { id, speaker, text, final, at: Date.now() }]);
    if (final) queueGloss(id, text);
  }, [mutateLines, queueGloss]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  useEffect(() => () => {
    clearTimers();
    if (glossTimerRef.current) window.clearTimeout(glossTimerRef.current);
    stopVoiceNote();
  }, [clearTimers]);

  // Call timer.
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt, endedAt]);
  const elapsed = startedAt ? Math.max(0, (endedAt ?? nowMs) - startedAt) : 0;

  // ---------- completion: extraction → validation → store ----------
  const finishCheckin = useCallback(async (source: "live" | "sample") => {
    const call = callRef.current;
    if (call.finished) return;
    call.finished = true;
    clearTimers();
    realtime.disconnect();
    setEndedAt(Date.now());
    setActivity("done");
    setSampleSpeaker(null);
    const facts = call.facts;
    if (!facts || call.mode === "availability") {
      setCallState("complete");
      return;
    }
    setCallState("extracting");
    const transcript = linesRef.current.filter((l) => l.speaker !== "tool" && l.speaker !== "system" && l.text.trim()).map((l) => ({ speaker: l.speaker, text: l.text }));
    const extraction = transcript.length ? await requestExtraction(facts, transcript) : { reports: [], source: "fallback" as const, fallbackReason: "empty_transcript" };

    // Tool-confirmed counts (caller_agent) are authoritative; extraction fills the rest.
    const merged = new Map<string, VoiceReport>(extraction.reports.map((r) => [r.medicineId, r]));
    for (const [medicineId, c] of call.confirmed) {
      const fact = facts.medicines.find((m) => m.id === medicineId);
      if (!fact) continue;
      const prior = merged.get(medicineId);
      if (!prior || prior.count !== c.count) {
        merged.set(medicineId, toVoiceReport(facts.facility, fact, { count: c.count, confidence: 0.95, transcript: prior?.transcript ?? `Confirmed on call: ${c.count} ${fact.unit}`, pharmacistInsisted: c.insisted }));
      }
    }
    const reports = facts.medicines.map((m) => merged.get(m.id)).filter((r): r is VoiceReport => Boolean(r));

    const actor = `${facts.facility.pharmacistName} (pharmacist)`;
    for (const r of reports) {
      if (r.needsRecount) {
        dispatch({ type: "REQUEST_RECOUNT", facilityId: r.facilityId, medicineId: r.medicineId, reason: r.reason ?? "Count could not be verified." });
        setCapture(r.medicineId, { state: "recount", count: r.count, note: r.reason });
      } else {
        dispatch({ type: "RECORD_VOICE_REPORT", report: r, actor });
        setCapture(r.medicineId, { state: "confirmed", count: r.count });
      }
    }
    for (const m of facts.medicines) if (!merged.has(m.id)) setCapture(m.id, { state: "pending", note: "No count captured" });
    setResult({ ...extraction, reports, dispatched: true });
    setCallState("complete");
    if (source === "sample") setNotice((n) => n ?? { tone: "info", text: "Sample call (scripted) — reports recorded from synthetic data." });
    props.onReports?.(reports);
  }, [clearTimers, dispatch, props, realtime, setCapture]);

  // ---------- scripted (labeled) sample calls ----------
  const playScript = useCallback((steps: ScriptStep[], onDone: () => void) => {
    setIsSample(true);
    setCallState("sample");
    let t = 300;
    steps.forEach((step, i) => {
      t += step.delayMs ?? 700;
      timersRef.current.push(window.setTimeout(() => {
        const human = step.speaker === "pharmacist" ? callRef.current.mode !== "pharmacist_sim" : step.speaker === "caller";
        setSampleSpeaker(step.speaker === "tool" ? null : human ? "user" : "agent");
        setActivity(step.speaker === "tool" ? "thinking" : human ? "listening" : "speaking");
        addLine(step.speaker, step.text, { gloss: step.gloss });
        if (step.capture) setCapture(step.capture.medicineId, { state: step.capture.state, count: step.capture.count, note: step.capture.note });
        if (i === steps.length - 1) timersRef.current.push(window.setTimeout(onDone, 900));
      }, t));
      t += Math.min(2600, 500 + step.text.length * 22);
    });
    setGlossSource("script");
  }, [addLine, setCapture]);

  const startSample = useCallback((reason: string) => {
    realtime.disconnect();
    clearTimers();
    const call = callRef.current;
    setNotice({ tone: "warn", text: `${reason} Playing a clearly labeled sample call instead.` });
    setSession(null);
    if (call.mode === "availability") {
      setIsSample(true);
      setCallState("sample");
      setActivity("listening");
      return;
    }
    // Restart the transcript with the scripted conversation (same facts as the live session).
    mutateLines(() => []);
    const facts = call.facts;
    if (!facts) return;
    const steps = call.mode === "caller_agent" ? callerAgentScript(facts) : pharmacistSimScript(facts);
    playScript(steps, () => void finishCheckin("sample"));
  }, [clearTimers, finishCheckin, mutateLines, playScript, realtime]);

  // ---------- live Realtime event handling ----------
  const sendPrompt = useCallback((index: number) => {
    const call = callRef.current;
    const prompt = call.prompts[index];
    if (!prompt) return;
    call.promptIndex = index;
    if (prompt.medicineId) {
      call.lastMedicineAsked = prompt.medicineId;
      setCapture(prompt.medicineId, { state: "asking" });
    }
    addLine("agent", prompt.text, { gloss: prompt.gloss });
    realtime.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: prompt.text }] } });
    realtime.send({ type: "response.create", response: { output_modalities: ["audio"] } });
  }, [addLine, realtime, setCapture]);

  const resolveFact = useCallback((idOrName: unknown): MedicineFact | undefined => {
    const facts = callRef.current.facts;
    if (!facts || typeof idOrName !== "string") return undefined;
    const q = idOrName.toLowerCase();
    return facts.medicines.find((m) => m.id === idOrName) ?? facts.medicines.find((m) => q.includes(m.name.toLowerCase()) || m.id.startsWith(q));
  }, []);

  const handleTool = useCallback((name: string, callId: string, rawArgs: string) => {
    const call = callRef.current;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(rawArgs || "{}"); } catch { /* keep empty */ }
    let output: unknown = { error: "unknown tool" };

    if (name === "check_count") {
      const fact = resolveFact(args.medicine_id);
      const count = Number(args.count);
      if (!fact) output = { error: `Unknown medicine_id ${String(args.medicine_id)}. Use one of: ${call.facts?.medicines.map((m) => m.id).join(", ")}` };
      else {
        const check = checkCount(fact, count);
        setCapture(fact.id, { state: check.plausible ? "heard" : "recount", count, note: check.reason });
        addLine("tool", `check_count(${fact.id}, ${count}) → ${check.plausible ? "plausible" : `implausible · expected ${check.expectedRange[0]}–${check.expectedRange[1]}`}`);
        // The model gets the verdict and guidance, not the expected number to parrot back.
        output = { medicine_id: fact.id, count, plausible: check.plausible, guidance: check.guidance };
      }
    } else if (name === "confirm_count") {
      const fact = resolveFact(args.medicine_id);
      const count = Number(args.count);
      if (!fact || !Number.isFinite(count)) output = { error: "medicine_id and numeric count are required" };
      else {
        const insisted = Boolean(args.pharmacist_insisted);
        call.confirmed.set(fact.id, { count, insisted });
        const check = checkCount(fact, count);
        setCapture(fact.id, { state: check.plausible ? "confirmed" : "recount", count, note: check.plausible ? undefined : "Pharmacist repeated an implausible count" });
        addLine("tool", `confirm_count(${fact.id}, ${count}${insisted ? ", insisted" : ""}) → recorded`);
        const remaining = call.facts?.medicines.filter((m) => !call.confirmed.has(m.id)).map((m) => m.id) ?? [];
        output = { recorded: true, remaining_medicines: remaining, next: remaining.length ? `Ask for ${remaining[0]} next.` : "All done: thank them and call end_call." };
      }
    } else if (name === "end_call") {
      call.endRequested = true;
      addLine("tool", `end_call()${typeof args.summary === "string" && args.summary ? ` · ${args.summary}` : ""}`);
      output = { ok: true };
      timersRef.current.push(window.setTimeout(() => void finishCheckin("live"), 5000));
    } else if (name === "check_availability") {
      const answer = checkAvailability(state, String(args.medicine ?? ""), String(args.facility ?? ""));
      const alt = answer.alternatives?.[0];
      addLine("tool", `check_availability(${String(args.medicine)}, ${String(args.facility)}) → ${answer.found ? (answer.available ? `in stock · ${answer.risk}` : "not available") : "no match"}${alt ? ` · nearest: ${alt.name} ${alt.distanceKm} km` : ""}`);
      setAvailabilityLog((log) => [{ id: callId, question: `${String(args.medicine)} @ ${String(args.facility)}`, answer: "", medicine: answer.medicine?.name, facility: answer.facility?.name, available: answer.available, alt: alt ? `${alt.name} · ${alt.distanceKm} km` : undefined }, ...log].slice(0, 6));
      output = answer;
    }

    realtime.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
    if (name !== "end_call") realtime.send({ type: "response.create" });
  }, [addLine, finishCheckin, realtime, resolveFact, setCapture, state]);

  const handleEvent = useCallback((e: RealtimeServerEvent) => {
    const call = callRef.current;
    const aiSpeaker: Speaker = call.mode === "pharmacist_sim" ? "pharmacist" : "agent";
    const humanSpeaker: Speaker = call.mode === "caller_agent" ? "pharmacist" : "caller";
    switch (e.type) {
      case "response.output_audio_transcript.delta": {
        const id = `ai-${e.item_id}`;
        const prev = linesRef.current.find((l) => l.id === id)?.text ?? "";
        upsertLine(id, aiSpeaker, prev + (e.delta ?? ""), false);
        setActivity("speaking");
        break;
      }
      case "response.output_audio_transcript.done": {
        const id = `ai-${e.item_id}`;
        upsertLine(id, aiSpeaker, e.transcript ?? linesRef.current.find((l) => l.id === id)?.text ?? "", true);
        if (call.mode === "pharmacist_sim" && call.facts && call.lastMedicineAsked) {
          // Instant chip preview from the deterministic parser; structured extraction confirms at the end.
          const fact = call.facts.medicines.find((m) => m.id === call.lastMedicineAsked);
          const quick = fact ? fallbackExtract(call.facts.facility, [fact], [{ speaker: "agent", text: fact.name }, { speaker: "pharmacist", text: e.transcript ?? "" }]) : [];
          if (quick[0]) setCapture(quick[0].medicineId, { state: quick[0].needsRecount ? "recount" : "heard", count: quick[0].count, note: quick[0].reason });
        }
        break;
      }
      case "input_audio_buffer.speech_started":
        setActivity("listening");
        upsertLine(`hu-${e.item_id}`, humanSpeaker, "…", false);
        break;
      case "input_audio_buffer.speech_stopped":
        setActivity("thinking");
        break;
      case "conversation.item.input_audio_transcription.delta": {
        const id = `hu-${e.item_id}`;
        const prev = linesRef.current.find((l) => l.id === id)?.text ?? "";
        upsertLine(id, humanSpeaker, (prev === "…" ? "" : prev) + (e.delta ?? ""), false);
        break;
      }
      case "conversation.item.input_audio_transcription.completed":
        upsertLine(`hu-${e.item_id}`, humanSpeaker, (e.transcript ?? "").trim() || "(inaudible)", true);
        break;
      case "output_audio_buffer.started":
        setActivity("speaking");
        break;
      case "output_audio_buffer.stopped":
        setActivity(call.mode === "pharmacist_sim" ? "thinking" : "listening");
        if (call.endRequested) void finishCheckin("live");
        break;
      case "response.function_call_arguments.done":
        handleTool(e.name, e.call_id, e.arguments);
        break;
      case "response.done":
        if (call.mode === "pharmacist_sim" && e.response?.status !== "cancelled") {
          const next = call.promptIndex + 1;
          if (next < call.prompts.length) timersRef.current.push(window.setTimeout(() => sendPrompt(next), 700));
          else timersRef.current.push(window.setTimeout(() => void finishCheckin("live"), 1800));
        }
        break;
      case "error": {
        const code = e.error?.code ?? "";
        if (BENIGN_ERRORS.has(code)) break;
        const hasConversation = linesRef.current.some((l) => l.speaker !== "tool" && l.speaker !== "system" && l.final);
        if (!hasConversation) startSample(FAILURE_COPY.api_error);
        else setNotice({ tone: "warn", text: `Realtime error: ${e.error?.message ?? code ?? "unknown"}` });
        break;
      }
    }
  }, [finishCheckin, handleTool, sendPrompt, setCapture, startSample, upsertLine]);

  useEffect(() => { handlerRef.current = handleEvent; }, [handleEvent]);

  // ---------- start / stop ----------
  const resetCall = useCallback(() => {
    clearTimers();
    realtime.disconnect();
    stopVoiceNote();
    linesRef.current = [];
    capturesRef.current = {};
    setLines([]);
    setCaptures({});
    setResult(null);
    setNotice(null);
    setIsSample(false);
    setSampleSpeaker(null);
    setSession(null);
    setStartedAt(null);
    setEndedAt(null);
    setActivity("idle");
    setCallState("idle");
    setGlossSource(null);
    setAvailabilityLog([]);
    setVoiceNote(null);
    setCallFacts(null);
    setMicMuted(false);
  }, [clearTimers, realtime]);

  const startCall = useCallback(async (forMode: VoiceMode = mode) => {
    if (!facility) return;
    resetCall();
    const facts = buildFacilityFacts(state, facility.id, { slipMedicineId: forMode === "pharmacist_sim" && injectSlip ? (buildFacilityFacts(state, facility.id).medicines[0]?.id ?? null) : null });
    const directory = buildDirectory(state);
    callRef.current = {
      mode: forMode, facts, directory, promptIndex: 0, prompts: forMode === "pharmacist_sim" ? callerPrompts(facts) : [],
      endRequested: false, finished: false, confirmed: new Map(), lastMedicineAsked: null,
    };
    capturesRef.current = Object.fromEntries(facts.medicines.map((m) => [m.id, { medicineId: m.id, state: "pending" as const }]));
    setCaptures(capturesRef.current);
    setCallFacts(facts);
    const t0 = Date.now();
    setStartedAt(t0);
    setNowMs(t0);
    setCallState("connecting");
    setActivity("connecting");

    const sessionFacts: VoiceFacts = forMode === "availability"
      ? { directory, districtName: state.district.name, now: state.now }
      : forMode === "caller_agent"
        ? { ...facts, medicines: facts.medicines.map(({ shelfCount: _omit, ...m }) => { void _omit; return m; }) }
        : facts;

    try {
      const s = await realtime.connect({
        mode: forMode,
        facilityId: facility.id,
        facts: sessionFacts,
        mic: forMode !== "pharmacist_sim",
        onEvent: (ev) => handlerRef.current(ev),
        onDisconnect: () => {
          if (!callRef.current.finished && callRef.current.mode !== "availability") setNotice({ tone: "warn", text: "Realtime connection dropped." });
        },
      });
      setSession(s);
      setCallState("live");
      if (forMode === "pharmacist_sim") {
        setActivity("thinking");
        timersRef.current.push(window.setTimeout(() => sendPrompt(0), 400));
      } else {
        setActivity("speaking");
        realtime.send({ type: "response.create", response: { instructions: forMode === "caller_agent" ? "Begin the call now: greet the pharmacist by name and ask for the first medicine's count." : "Greet the caller now in one short Hindi sentence and ask what they need." } });
      }
    } catch (err) {
      const kind: RealtimeFailure = err instanceof RealtimeError ? err.kind : "connect_failed";
      if (forMode === "availability" && (kind === "mic_denied" || kind === "mic_unavailable")) {
        // Availability still works with typed preset questions over a text-in / audio-out session.
        try {
          const s = await realtime.connect({ mode: forMode, facilityId: facility.id, facts: sessionFacts, mic: false, onEvent: (ev) => handlerRef.current(ev) });
          setSession(s);
          setCallState("live");
          setActivity("idle");
          setNotice({ tone: "info", text: `${FAILURE_COPY[kind]} Use the question buttons — answers are still spoken live.` });
          return;
        } catch { /* fall through to sample */ }
      }
      startSample(FAILURE_COPY[kind]);
    }
  }, [facility, injectSlip, mode, realtime, resetCall, sendPrompt, startSample, state]);

  const endCall = useCallback(() => {
    const call = callRef.current;
    if (callState === "connecting") {
      resetCall();
      return;
    }
    if (call.mode === "availability" || !call.facts) {
      clearTimers();
      realtime.disconnect();
      setEndedAt(Date.now());
      setActivity("done");
      setCallState("complete");
      call.finished = true;
      return;
    }
    if (callState === "sample") {
      // Fast-forward the script so the officer still gets reports.
      clearTimers();
      const steps = call.mode === "caller_agent" ? callerAgentScript(call.facts) : pharmacistSimScript(call.facts);
      mutateLines(() => steps.map((s) => ({ id: newId(s.speaker), speaker: s.speaker, text: s.text, gloss: s.gloss, final: true, at: Date.now() })));
      steps.forEach((s) => s.capture && setCapture(s.capture.medicineId, { state: s.capture.state, count: s.capture.count, note: s.capture.note }));
      void finishCheckin("sample");
      return;
    }
    void finishCheckin("live");
  }, [callState, clearTimers, finishCheckin, mutateLines, realtime, resetCall, setCapture]);

  // ---------- availability presets ----------
  const presets = useMemo(() => {
    const target = facility ?? facilities[0];
    if (!target) return [];
    const meds = state.stock.filter((s) => s.facilityId === target.id).slice(0, 2).map((s) => state.medicines.find((m) => m.id === s.medicineId)).filter(Boolean) as typeof state.medicines;
    const out = meds.map((m) => ({ medicine: m.name, facility: target.name, text: `क्या ${target.name} में ${hindiMedicineName(m.name)} ${m.strength} उपलब्ध है?` }));
    const emptyRecord = state.stock.find((s) => s.stock <= 0);
    if (emptyRecord) {
      const f = state.facilities.find((x) => x.id === emptyRecord.facilityId);
      const m = state.medicines.find((x) => x.id === emptyRecord.medicineId);
      if (f && m && !out.some((o) => o.facility === f.name && o.medicine === m.name)) out.push({ medicine: m.name, facility: f.name, text: `${f.name} में ${hindiMedicineName(m.name)} मिलेगी क्या? मरीज़ को भेजना है।` });
    }
    return out.slice(0, 3);
  }, [facility, facilities, state]);

  const askPreset = useCallback(async (p: { medicine: string; facility: string; text: string }) => {
    if (callState === "live") {
      addLine("caller", p.text);
      setActivity("thinking");
      realtime.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: p.text }] } });
      realtime.send({ type: "response.create" });
      return;
    }
    // Deterministic fallback answer, spoken via gpt-4o-mini-tts or the browser voice.
    if (callState !== "sample") {
      resetCall();
      callRef.current = { ...callRef.current, mode: "availability", facts: null, finished: false };
      setIsSample(true);
      setCallState("sample");
      const t0 = Date.now();
      setStartedAt(t0);
      setNowMs(t0);
      setNotice({ tone: "warn", text: "Live Realtime not connected. Answers come from the store, spoken by text-to-speech (labeled sample)." });
    }
    addLine("caller", p.text);
    const answer = checkAvailability(state, p.medicine, p.facility);
    const alt = answer.alternatives?.[0];
    addLine("tool", `check_availability(${p.medicine}, ${p.facility}) → ${answer.available ? `in stock · ${answer.risk}` : "not available"}${alt ? ` · nearest: ${alt.name} ${alt.distanceKm} km` : ""}`);
    const reply = availabilityAnswerHindi(answer, hindiMedicineName(p.medicine));
    addLine("agent", reply);
    setAvailabilityLog((log) => [{ id: newId("av"), question: `${p.medicine} @ ${p.facility}`, answer: reply, medicine: answer.medicine?.name, facility: answer.facility?.name, available: answer.available, alt: alt ? `${alt.name} · ${alt.distanceKm} km` : undefined }, ...log].slice(0, 6));
    setSampleSpeaker("agent");
    setActivity("speaking");
    const via = await playVoiceNote(reply);
    setNotice({ tone: "warn", text: `Sample availability answer from store data · voice: ${via === "openai_tts" ? "gpt-4o-mini-tts" : via === "browser_tts" ? "browser speech (offline fallback)" : "text only"}.` });
    timersRef.current.push(window.setTimeout(() => { setSampleSpeaker(null); setActivity("listening"); }, 2500));
  }, [addLine, callState, realtime, resetCall, state]);

  // ---------- external "Call now" requests ----------
  useEffect(() => {
    const onRequest = (ev: Event) => {
      const detail = (ev as CustomEvent<VoiceCallRequest>).detail;
      if (!detail?.facilityId) return;
      setLocalFacilityId(detail.facilityId);
      const nextMode = detail.mode ?? "pharmacist_sim";
      setMode(nextMode);
      if (detail.autoStart !== false) pendingStartRef.current = { mode: nextMode };
      setTick((t) => t + 1);
    };
    window.addEventListener(VOICE_CALL_EVENT, onRequest);
    return () => window.removeEventListener(VOICE_CALL_EVENT, onRequest);
  }, []);

  useEffect(() => {
    const pending = pendingStartRef.current;
    if (!pending || !facility || facility.id !== facilityId) return;
    pendingStartRef.current = null;
    void startCall(pending.mode);
  });

  const autoStarted = useRef(false);
  useEffect(() => {
    if (props.autoStart && !autoStarted.current && facility) {
      autoStarted.current = true;
      void startCall(initialMode);
    }
  }, [facility, initialMode, props.autoStart, startCall]);

  // ---------- derived view ----------
  const busy = callState === "connecting" || callState === "live" || callState === "sample" || callState === "extracting";
  const shownFacts = (busy || callState === "complete") && callFacts ? callFacts : previewFacts;
  const chipFacts = mode === "availability" ? [] : shownFacts?.medicines ?? [];
  const meta = MODE_META[mode];
  const badge = callState === "connecting" ? "Connecting" : callState === "live" ? (activity === "speaking" ? "Speaking" : activity === "listening" ? "Listening" : activity === "thinking" ? "Thinking" : "Live")
    : callState === "sample" ? "Sample call" : callState === "extracting" ? "Extracting" : callState === "complete" ? (result?.dispatched ? "Recorded" : "Ended") : callState === "error" ? "Failed" : "Ready";
  const steps = mode === "availability" ? ["Connect", "Ask", "Look up", "Answer"] : ["Connect", "Converse", "Extract", "Record"];
  const stepIndex = callState === "idle" ? -1 : callState === "connecting" ? 0 : callState === "live" || callState === "sample" ? (mode === "availability" ? (activity === "thinking" ? 2 : activity === "speaking" ? 3 : 1) : 1) : callState === "extracting" ? 2 : 3;

  const playNote = async (medicineId: string) => {
    if (!shownFacts) return;
    setVoiceNote({ medicineId, via: "…" });
    const via = await playVoiceNote(recountVoiceNote(shownFacts, medicineId));
    setVoiceNote({ medicineId, via: via === "openai_tts" ? "gpt-4o-mini-tts" : via === "browser_tts" ? "browser voice (fallback)" : "unavailable" });
  };

  return (
    <section id="voice-console" className={`${styles.console} ${props.className ?? ""}`} aria-label="Dawai Dost voice console" data-state={callState}>
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>OpenAI Realtime · voice line</p>
            <h2 className={styles.title}>Voice check-in</h2>
          </div>
          <div className={styles.statusCluster}>
            <span className={styles.badge} data-tone={callState === "live" ? "live" : callState === "sample" ? "sample" : callState === "complete" ? "done" : callState === "extracting" || callState === "connecting" ? "busy" : "idle"}>
              {callState === "live" && <span className={styles.liveDot} aria-hidden="true" />}
              {(callState === "connecting" || callState === "extracting") && <LoaderCircle size={12} className={styles.spin} aria-hidden="true" />}
              {badge}
            </span>
            <span className={styles.timer} aria-label="Call duration"><Timer size={12} aria-hidden="true" />{formatClock(elapsed)}</span>
          </div>
        </div>

        <div className={styles.modeTabs} role="tablist" aria-label="Voice mode">
          {(Object.keys(MODE_META) as VoiceMode[]).map((m) => {
            const Icon = MODE_META[m].icon;
            return (
              <button key={m} role="tab" aria-selected={mode === m} className={styles.modeTab} disabled={busy} onClick={() => { resetCall(); setMode(m); }}>
                <Icon size={14} aria-hidden="true" />{MODE_META[m].label}
              </button>
            );
          })}
        </div>
        <p className={styles.hint}>{meta.hint}</p>

        <div className={styles.controls}>
          <label className={styles.field}>
            <span>{mode === "availability" ? "Caller near" : "Facility"}</span>
            <select value={facilityId} disabled={busy} onChange={(e) => { setLocalFacilityId(e.target.value); dispatch({ type: "SELECT_FACILITY", facilityId: e.target.value }); }}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.block}</option>)}
            </select>
          </label>
          {mode === "pharmacist_sim" && (
            <label className={styles.toggle} title="The simulated pharmacist misreads one shelf, to demonstrate the recount path.">
              <input type="checkbox" checked={injectSlip} disabled={busy} onChange={(e) => setInjectSlip(e.target.checked)} />
              <span>Inject a miscount</span>
            </label>
          )}
          <div className={styles.callButtons}>
            {!busy ? (
              <button className={styles.primary} onClick={() => void startCall()} disabled={!facility}>
                {mode === "caller_agent" ? <Mic size={15} aria-hidden="true" /> : <Phone size={15} aria-hidden="true" />}
                {callState === "complete" ? "Call again" : mode === "caller_agent" ? "Start mic call" : mode === "availability" ? "Open line" : "Start call"}
              </button>
            ) : (
              <button className={styles.danger} onClick={endCall} disabled={callState === "extracting"}>
                <PhoneOff size={15} aria-hidden="true" />{callState === "sample" && mode !== "availability" ? "Skip to end" : "End call"}
              </button>
            )}
            {mode !== "pharmacist_sim" && callState === "live" && session?.transcriptionModel && (
              <button className={styles.ghost} onClick={() => { realtime.setMicEnabled(micMuted); setMicMuted(!micMuted); }} aria-pressed={micMuted}>
                {micMuted ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}{micMuted ? "Unmute" : "Mute"}
              </button>
            )}
            {callState === "complete" && (
              <button className={styles.ghost} onClick={resetCall}><RotateCcw size={14} aria-hidden="true" />Reset</button>
            )}
          </div>
        </div>
      </header>

      <ol className={styles.stepper} aria-label="Call progress">
        {steps.map((s, i) => <li key={s} data-on={i <= stepIndex ? "1" : "0"} data-current={i === stepIndex ? "1" : "0"}>{s}</li>)}
      </ol>

      {notice && (
        <p className={styles.notice} data-tone={notice.tone} role="status">
          {notice.tone === "warn" ? <TriangleAlert size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}{notice.text}
        </p>
      )}

      <div className={styles.stage}>
        <div className={styles.orbCol}>
          <VoiceOrb analysersRef={realtime.analysersRef} activity={activity} simulated={isSample} simulatedSpeaker={sampleSpeaker} />
          <p className={styles.orbCaption}>
            {mode === "pharmacist_sim" ? `${facility?.pharmacist.name ?? "Pharmacist"} · AI role-play` : mode === "caller_agent" ? "Dawai Dost agent · you answer" : "Dawai Dost availability line"}
          </p>
          <dl className={styles.stack}>
            {isSample ? (
              <><dt>Source</dt><dd className={styles.sampleTag}>Sample call · scripted</dd></>
            ) : session ? (
              <>
                <dt>Voice</dt><dd>{session.model} · WebRTC</dd>
                {session.transcriptionModel && <><dt>Ears</dt><dd>{session.transcriptionModel} · hi/en</dd></>}
                {session.tools.length > 0 && <><dt>Tools</dt><dd>{session.tools.join(", ")}</dd></>}
              </>
            ) : (
              <><dt>Voice</dt><dd>gpt-realtime-2.1 · not connected</dd></>
            )}
          </dl>
        </div>

        <div className={styles.transcriptCol}>
          <div className={styles.colHead}>
            <span>Live transcript</span>
            <span className={styles.glossTag}><Languages size={12} aria-hidden="true" />EN gloss · {glossSource === "live" ? "gpt-5.4-mini" : glossSource === "fallback" ? "keyword (offline)" : glossSource === "script" ? "scripted" : "—"}</span>
          </div>
          <TranscriptView lines={lines} mode={mode} pharmacistName={facility?.pharmacist.name} emptyText={mode === "availability" ? "Open the line and speak, or tap a question below." : mode === "caller_agent" ? "Start the mic call. The agent greets you in Hindi and asks for each count." : "Start the call to hear the simulated pharmacist answer in Hindi."} />
          {mode === "availability" && (
            <div className={styles.presets}>
              {presets.map((p) => (
                <button key={p.text} className={styles.preset} onClick={() => void askPreset(p)} disabled={callState === "connecting" || callState === "extracting"}>
                  <Volume2 size={13} aria-hidden="true" />{p.text}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {mode !== "availability" && chipFacts.length > 0 && (
        <CaptureChips facts={chipFacts} captures={captures} />
      )}

      {mode === "availability" && availabilityLog.length > 0 && (
        <ul className={styles.availList} aria-label="Availability lookups">
          {availabilityLog.map((a) => (
            <li key={a.id} data-ok={a.available ? "1" : "0"}>
              <strong>{a.medicine ?? a.question}</strong> @ {a.facility ?? "—"}
              <span>{a.available ? "Available" : "Not available"}</span>
              {a.alt && <em>Nearest with stock: {a.alt}</em>}
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div className={styles.results}>
          <div className={styles.colHead}>
            <span>Structured report → district store</span>
            <span className={styles.glossTag} data-live={result.source === "live" ? "1" : "0"}>
              {result.source === "live" ? `Responses API · ${result.model} · structured outputs` : `Offline parser · fallback (${result.fallbackReason ?? "unavailable"})`}
            </span>
          </div>
          {result.englishSummary && <p className={styles.summary}>{result.englishSummary}</p>}
          {result.reports.length === 0 && <p className={styles.summary}>No counts were captured. Nothing was recorded.</p>}
          <ul className={styles.reportList}>
            {result.reports.map((r) => {
              const m = state.medicines.find((x) => x.id === r.medicineId);
              return (
                <li key={r.medicineId} data-recount={r.needsRecount ? "1" : "0"}>
                  <span className={styles.reportName}>{m?.name ?? r.medicineId} <small>{m?.strength}</small></span>
                  <span className={styles.reportCount}>{r.count} <small>{r.unit}</small></span>
                  <span className={styles.reportConf}>{Math.round(r.confidence * 100)}%</span>
                  {r.needsRecount ? (
                    <span className={styles.reportStatus}>
                      <TriangleAlert size={13} aria-hidden="true" />Recount requested
                      <button className={styles.noteBtn} onClick={() => void playNote(r.medicineId)} title="Preview the Hindi voice note sent to the pharmacist">
                        <Volume2 size={12} aria-hidden="true" />{voiceNote?.medicineId === r.medicineId ? voiceNote.via : "Hindi voice note"}
                      </button>
                    </span>
                  ) : (
                    <span className={styles.reportStatus} data-ok="1"><CircleCheck size={13} aria-hidden="true" />Recorded · map updated</span>
                  )}
                  {r.reason && <p className={styles.reportReason}><Wrench size={11} aria-hidden="true" />{r.reason}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
