"use client";
// OWNER: ai agent. Morning brief: the Responses API writes a structured EN + HI brief from a compact district
// summary; "Listen" plays gpt-4o-mini-tts audio (browser voice as a labeled fallback).
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Pause, RefreshCw, Sunrise, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { requestBriefing, requestSpeech } from "@/lib/ai/client";
import { buildBriefingSummary } from "@/lib/ai/summary";
import type { Briefing } from "@/lib/ai/types";
import { useDistrict } from "@/lib/district/store";
import { fmtMs, LangToggle, SourceBadge, Spinner } from "./shared";
import a from "./ai.module.css";
import s from "./BriefingPanel.module.css";

export type BriefingPanelProps = {
  variant?: "full" | "compact";
  /** Generate on first mount (default true for "full"). */
  autoGenerate?: boolean;
};

// Survives view switches within the session.
let cachedBrief: Briefing | null = null;
let inflight: Promise<Briefing> | null = null;

type Voice = { state: "idle" | "loading" | "playing"; engine?: "tts" | "browser" };

export function BriefingPanel({ variant = "full", autoGenerate }: BriefingPanelProps) {
  const { state, dispatch, assessments } = useDistrict();
  const reduce = useReducedMotion();
  const compact = variant === "compact";
  const auto = autoGenerate ?? !compact;
  const [brief, setBrief] = useState<Briefing | null>(cachedBrief);
  const [loading, setLoading] = useState(auto && !cachedBrief);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [voice, setVoice] = useState<Voice>({ state: "idle" });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const snap = useRef({ state, assessments });
  useEffect(() => {
    snap.current = { state, assessments };
  }, [state, assessments]);

  const officerFirst = state.district.officer.name;

  const log = (b: Briefing) =>
    dispatch({ type: "ADD_TIMELINE", event: { id: `brief-${b.generatedAt}`, at: snap.current.state.now, kind: "briefing", title: "Morning brief generated", detail: b.headline.en, actor: b.source === "live" ? `Responses API (${b.model})` : "Template brief" } });

  useEffect(() => {
    if (!auto || cachedBrief) return;
    let cancelled = false;
    inflight ??= requestBriefing(buildBriefingSummary(snap.current.state, snap.current.assessments));
    inflight
      .then((b) => {
        if (!cachedBrief) log(b);
        cachedBrief = b;
        if (!cancelled) setBrief(b);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not write the brief."); })
      .finally(() => { inflight = null; if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per mount
  }, [auto]);

  useEffect(() => () => {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  async function regenerate() {
    setLoading(true);
    setError(null);
    stop();
    try {
      const b = await requestBriefing(buildBriefingSummary(state, assessments));
      cachedBrief = b;
      setBrief(b);
      log(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not write the brief.");
    } finally {
      setLoading(false);
    }
  }

  function stop() {
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    setVoice({ state: "idle" });
  }

  async function listen() {
    if (!brief) return;
    if (voice.state === "playing") return stop();
    const text = [brief.headline[lang], ...brief.bullets.map((b) => b[lang]), ...(brief.actions.length ? [lang === "hi" ? "आज के कदम:" : "Today's actions:", ...brief.actions.map((x) => x[lang])] : [])].join(" ");
    setVoice({ state: "loading" });
    const blob = await requestSpeech(text, lang).catch(() => null);
    if (blob) {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = urlRef.current;
      audio.onended = () => setVoice({ state: "idle", engine: "tts" });
      try {
        await audio.play();
        setVoice({ state: "playing", engine: "tts" });
        return;
      } catch {
        /* autoplay blocked or decode failure: fall through to browser voice */
      }
    }
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "hi" ? "hi-IN" : "en-IN";
      u.rate = 0.98;
      u.onend = () => setVoice({ state: "idle", engine: "browser" });
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      setVoice({ state: "playing", engine: "browser" });
    } else {
      setVoice({ state: "idle" });
    }
  }

  const hour = Number(state.now.slice(11, 13));
  const greeting = lang === "hi" ? "सुप्रभात" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <section className={`${s.panel} ${compact ? s.compact : ""}`} aria-label="Morning brief" aria-busy={loading}>
      <header className={s.head}>
        <span className={s.kicker}><Sunrise size={13} aria-hidden /> {greeting}, {officerFirst.split(" ").slice(0, 2).join(" ")}</span>
        <div className={s.tools}>
          <LangToggle lang={lang} onChange={setLang} />
          {brief ? (
            <Button size="sm" variant="ghost" icon={voice.state === "loading" ? <Spinner /> : voice.state === "playing" ? <Pause size={14} /> : <Volume2 size={14} />} onClick={listen} aria-pressed={voice.state === "playing"}>
              {voice.state === "playing" ? "Stop" : "Listen"}
            </Button>
          ) : null}
          <Button size="sm" variant={brief ? "ghost" : "decision"} icon={loading ? <Spinner /> : <RefreshCw size={14} />} onClick={regenerate} disabled={loading} aria-label={brief ? "Regenerate brief" : "Write brief"}>
            {brief ? null : "Write brief"}
          </Button>
        </div>
      </header>

      {error ? <p className={s.error} role="alert">{error}</p> : null}

      {loading && !brief ? (
        <div className={s.skeleton} aria-label="Writing brief">
          <span className={a.shimmer} style={{ height: 30, width: "85%" }} />
          {Array.from({ length: compact ? 2 : 4 }, (_, i) => <span key={i} className={a.shimmer} style={{ height: 14, width: `${90 - i * 8}%` }} />)}
        </div>
      ) : null}

      <AnimatePresence mode="wait">
        {brief ? (
          <motion.div key={`${brief.generatedAt}-${lang}`} className={s.body} lang={lang} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <h3 className={s.headline}>{brief.headline[lang]}</h3>
            <ul className={s.bullets}>
              {(compact ? brief.bullets.slice(0, 3) : brief.bullets).map((b, i) => (
                <li key={i} data-tone={b.tone}>{b[lang]}</li>
              ))}
            </ul>
            {!compact && brief.actions.length ? (
              <div className={s.actions}>
                <p className={s.actionsLabel}>{lang === "hi" ? "आज के कदम" : "Do this morning"}</p>
                <ol>
                  {brief.actions.map((x, i) => <li key={i}><ArrowRight size={13} aria-hidden /> {x[lang]}</li>)}
                </ol>
              </div>
            ) : null}
          </motion.div>
        ) : !loading && !error ? (
          <p className={s.empty}>A short, bilingual brief written from today&apos;s ledger: top risks, decisions waiting for you, transfers in motion and escalations.</p>
        ) : null}
      </AnimatePresence>

      {brief ? (
        <footer className={s.foot}>
          <SourceBadge source={brief.source} reason={brief.fallbackReason} />
          <span className={a.genLabel}>
            {brief.source === "live" ? `Written by ${brief.model} from the district summary · ${fmtMs(brief.latencyMs)}` : "Template brief from the district summary"}
            {voice.engine ? ` · voice: ${voice.engine === "tts" ? "gpt-4o-mini-tts" : "browser speech (fallback)"}` : ""}
          </span>
        </footer>
      ) : null}
    </section>
  );
}
