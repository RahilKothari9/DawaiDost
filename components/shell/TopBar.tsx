"use client";
import { ChevronDown, FastForward, Pause, Play, RotateCcw, Search, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useDistrict } from "@/lib/district/store";
import { Kbd } from "@/components/ui";
import { useShell } from "./ShellContext";
import { fmtClock } from "./format";

export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <Link href="/" className="topbar__brand" aria-label="Dawai Dost home">
          <BrandMark />
        </Link>
        <DistrictSwitcher />
      </div>
      <div className="topbar__right">
        <SimClock />
        <ApiStatusPill />
        <PaletteButton />
        <ResetButton />
      </div>
    </header>
  );
}

export function BrandMark({ size = 28 }: { size?: number }) {
  // A pill split by the decision line: medicine on one side, the choice on the other.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="brandmark" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--ink)" />
      <path d="M16 11.5h5a4.5 4.5 0 0 1 0 9h-5z" fill="var(--accent)" />
      <rect x="6.5" y="11.5" width="19" height="9" rx="4.5" fill="none" stroke="var(--surface)" strokeWidth="1.6" />
      <path d="M16 11.5v9" stroke="var(--surface)" strokeWidth="1.6" />
    </svg>
  );
}

function DistrictSwitcher() {
  const { state } = useDistrict();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const { district } = state;
  return (
    <div className="switcher" ref={ref}>
      <button type="button" className="switcher__btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="switcher__name">{district.name}</span>
        <span className="switcher__state">{district.state}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open ? (
        <div className="switcher__menu" role="menu">
          <p className="switcher__label">District</p>
          <button type="button" role="menuitemradio" aria-checked="true" className="switcher__item is-current" onClick={() => setOpen(false)}>
            <span>
              <strong>{district.name}</strong>
              <small>{state.facilities.length} facilities · {district.officer.name}</small>
            </span>
            <Check size={14} aria-hidden />
          </button>
          <p className="switcher__note">This prototype runs one synthetic district. More districts join in a pilot.</p>
        </div>
      ) : null}
      <span className="synthetic-tag" title="All clinics, counts and people in this scenario are fictional">Synthetic scenario</span>
    </div>
  );
}

function SimClock() {
  const { state, dispatch } = useDistrict();
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => dispatch({ type: "ADVANCE_CLOCK", hours: 2 }), 1400);
    return () => window.clearInterval(t);
  }, [playing, dispatch]);
  const { day, time } = fmtClock(state.now);
  return (
    <div className="clock" role="group" aria-label="Simulated clock">
      <div className="clock__face" aria-live="off">
        <span className="clock__time num">{time}</span>
        <span className="clock__day">{day} · IST</span>
      </div>
      <div className="clock__ctrls">
        <button type="button" className="clock__btn" onClick={() => dispatch({ type: "ADVANCE_CLOCK", hours: 6 })} title="Advance 6 hours">
          +6h
        </button>
        <button type="button" className="clock__btn" onClick={() => dispatch({ type: "ADVANCE_CLOCK", hours: 24 })} title="Advance one day">
          +1d
        </button>
        <button
          type="button"
          className={`clock__btn clock__btn--icon ${playing ? "is-on" : ""}`}
          aria-pressed={playing}
          aria-label={playing ? "Pause simulated time" : "Play simulated time"}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
      </div>
      {playing ? <FastForward size={12} className="clock__playing" aria-hidden /> : null}
    </div>
  );
}

export function ApiStatusPill({ verbose }: { verbose?: boolean }) {
  const { health, refreshHealth } = useShell();
  const { state } = useDistrict();
  // The key being configured is not the same as the API answering: reflect the latest real answer too.
  // Seeded history is synthetic; only decisions requested in this session say anything about the API.
  const last = state.decisions
    .filter((d) => !d.id.includes("seed"))
    .reduce<(typeof state.decisions)[number] | undefined>((acc, d) => (!acc || d.createdAt > acc.createdAt ? d : acc), undefined);
  const lastFellBack = health.state === "live" && last?.source === "demo_fallback";
  const mode = health.state === "live" ? (lastFellBack ? "degraded" : "live") : health.state;
  const label =
    mode === "live" ? "Decisions API · live" : mode === "degraded" ? "Decisions API · fallback" : mode === "demo" ? "Decisions API · demo mode" : mode === "offline" ? "Status unavailable" : "Checking API…";
  const title =
    mode === "live"
      ? `OpenAI key configured. Decisions: ${health.decisionsModel}. Voice: ${health.realtimeModel}.`
      : mode === "degraded"
        ? `Key configured, but the last decision used the labeled fallback (${last?.fallbackReason}). Click to re-check.`
        : mode === "demo"
          ? "No OpenAI key on the server. Every decision is a labeled deterministic fallback from the same stock rules."
          : "Could not reach /api/health.";
  return (
    <button type="button" className={`api-pill api-pill--${mode}`} title={title} onClick={refreshHealth}>
      <i className="api-pill__dot" aria-hidden />
      <span className="api-pill__label">{label}</span>
      {verbose && health.decisionsModel ? <span className="api-pill__model num">{health.decisionsModel}</span> : null}
    </button>
  );
}

function PaletteButton() {
  const { setPaletteOpen } = useShell();
  return (
    <button type="button" className="palette-btn" onClick={() => setPaletteOpen(true)} aria-label="Open command palette">
      <Search size={14} aria-hidden />
      <span className="palette-btn__label">Jump to…</span>
      <Kbd className="palette-btn__kbd">⌘K</Kbd>
    </button>
  );
}

function ResetButton() {
  const { dispatch } = useDistrict();
  const { pushToast } = useShell();
  return (
    <button
      type="button"
      className="ui-icon-btn"
      title="Reset scenario"
      aria-label="Reset scenario"
      onClick={() => {
        dispatch({ type: "RESET" });
        pushToast({ title: "Scenario reset", detail: "Back to the morning the Saraswati alert came in.", tone: "neutral" });
      }}
    >
      <RotateCcw size={15} />
    </button>
  );
}
