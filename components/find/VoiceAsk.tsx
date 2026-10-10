"use client";
// OWNER: find agent. Ask by voice: record ≤ 8 s → POST /api/find/ask → fill the search and speak the answer.
// Falls back to typing whenever the mic, the network or the voice service is unavailable.
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Square } from "lucide-react";
import type { FindSnapshot, Origin } from "@/lib/find/answer";
import type { Lang } from "@/lib/find/copy";
import type { AskResponse } from "@/lib/find/schema";
import { t, type StringKey } from "./strings";
import s from "./find.module.css";

const MAX_MS = 8000;

type Phase = { kind: "idle" } | { kind: "recording"; startedAt: number } | { kind: "thinking" } | { kind: "error"; message: StringKey };

type Props = {
  lang: Lang;
  snapshot: FindSnapshot;
  origin: Origin | null;
  onResult: (r: AskResponse) => void;
  onFallback: () => void;
};

function pickMime(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) ?? "";
}

const ext = (mime: string) => (mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm");

export function VoiceAsk({ lang, snapshot, origin, onResult, onFallback }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [transcript, setTranscript] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (phase.kind !== "recording") return;
    const id = setInterval(() => setElapsed(Date.now() - phase.startedAt), 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    recorder.current?.stream.getTracks().forEach((tr) => tr.stop());
  }, []);

  const fail = (message: StringKey) => {
    setPhase({ kind: "error", message });
    onFallback();
  };

  const send = async (blob: Blob, mime: string) => {
    setPhase({ kind: "thinking" });
    const form = new FormData();
    form.set("audio", new File([blob], `question.${ext(mime)}`, { type: mime || "audio/webm" }));
    form.set("lang", lang);
    form.set("snapshot", JSON.stringify(snapshot));
    if (origin) form.set("origin", JSON.stringify(origin));
    try {
      const res = await fetch("/api/find/ask", { method: "POST", body: form });
      if (!res.ok) return fail("voiceUnavailable");
      const json = (await res.json()) as AskResponse;
      setTranscript(json.transcript);
      setPhase(json.needs === "medicine" ? { kind: "error", message: "voiceNoMedicine" } : json.needs === "place" ? { kind: "error", message: "voiceNeedsPlace" } : { kind: "idle" });
      onResult(json);
    } catch {
      fail("voiceUnavailable");
    }
  };

  const start = async () => {
    setTranscript(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return fail("voiceUnavailable");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return fail("micDenied");
    }
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (timer.current) clearTimeout(timer.current);
      const blob = new Blob(chunks, { type: rec.mimeType || mime });
      if (blob.size < 800) return fail("voiceNoMedicine");
      void send(blob, rec.mimeType || mime);
    };
    recorder.current = rec;
    rec.start();
    setElapsed(0);
    setPhase({ kind: "recording", startedAt: Date.now() });
    timer.current = setTimeout(() => rec.state === "recording" && rec.stop(), MAX_MS);
  };

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  const recording = phase.kind === "recording";
  const thinking = phase.kind === "thinking";
  const secondsLeft = Math.max(0, Math.ceil((MAX_MS - elapsed) / 1000));

  return (
    <div className={s.voice}>
      <button
        type="button"
        className={s.micBtn}
        data-state={phase.kind}
        onClick={recording ? stop : start}
        disabled={thinking}
        aria-label={recording ? t("stop", lang) : t("ask", lang)}
      >
        {thinking ? <LoaderCircle size={30} className={s.spin} aria-hidden /> : recording ? <Square size={26} fill="currentColor" aria-hidden /> : <Mic size={30} aria-hidden />}
      </button>
      <div className={s.voiceText} aria-live="polite">
        <span className={s.voiceLabel}>
          {recording ? `${t("listening", lang)} · ${secondsLeft}` : thinking ? t("thinking", lang) : t("ask", lang)}
        </span>
        {phase.kind === "idle" && !transcript && <span className={s.voiceHint}>{t("askHint", lang)}</span>}
        {transcript && <span className={s.voiceHint}>{t("youAsked", lang)}: “{transcript}”</span>}
        {phase.kind === "error" && <span className={s.voiceError}>{t(phase.message, lang)}</span>}
      </div>
    </div>
  );
}
