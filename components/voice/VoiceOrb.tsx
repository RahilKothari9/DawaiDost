"use client";
// Animated voice orb (agent audio) with a radial waveform ring (mic), plus a segmented mic level meter.
// Reads live AnalyserNodes when connected; synthesises a gentle level for labeled sample calls.
import { useEffect, useRef, type RefObject } from "react";
import type { Analysers } from "./useRealtimeCall";
import styles from "./voice.module.css";

export type OrbActivity = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "done";

type Props = {
  analysersRef: RefObject<Analysers>;
  activity: OrbActivity;
  /** When true (sample call), animate from `activity` instead of real audio. */
  simulated?: boolean;
  /** Who is talking in a simulated call. */
  simulatedSpeaker?: "agent" | "user" | null;
  size?: number;
};

function level(a: AnalyserNode | null, buf: Uint8Array<ArrayBuffer>): number {
  if (!a) return 0;
  a.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / buf.length) * 4);
}

function wave(a: AnalyserNode | null, buf: Uint8Array<ArrayBuffer>, points: number, t: number, fake: number): number[] {
  const out = new Array(points).fill(0);
  if (a) {
    a.getByteFrequencyData(buf);
    for (let i = 0; i < points; i++) out[i] = buf[Math.floor((i / points) * buf.length * 0.6)] / 255;
  } else if (fake > 0) {
    for (let i = 0; i < points; i++) out[i] = fake * (0.45 + 0.55 * Math.abs(Math.sin(i * 0.9 + t * 7) * Math.cos(i * 0.37 - t * 3)));
  }
  return out;
}

export function VoiceOrb({ analysersRef, activity, simulated, simulatedSpeaker, size = 176 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ activity, simulated, simulatedSpeaker });
  useEffect(() => { stateRef.current = { activity, simulated, simulatedSpeaker }; }, [activity, simulated, simulatedSpeaker]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(canvas);
    const accent = css.getPropertyValue("--accent").trim() || "#3d2fe0";
    const ink = css.getPropertyValue("--ink-2").trim() || "#3b3a35";
    const line = css.getPropertyValue("--line").trim() || "#dcd8cc";
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const buf = new Uint8Array(new ArrayBuffer(256));
    const fbuf = new Uint8Array(new ArrayBuffer(256));
    let raf = 0;
    let smoothOut = 0;
    let smoothMic = 0;
    const segments = meterRef.current ? Array.from(meterRef.current.children) as HTMLElement[] : [];

    const draw = (ms: number) => {
      const t = ms / 1000;
      const { activity: act, simulated: sim, simulatedSpeaker: sp } = stateRef.current;
      const an = analysersRef.current;
      const fakeOut = sim && sp === "agent" ? 0.35 + 0.25 * Math.abs(Math.sin(t * 9)) : 0;
      const fakeMic = sim && sp === "user" ? 0.3 + 0.3 * Math.abs(Math.sin(t * 11 + 1)) : 0;
      const outL = sim ? fakeOut : level(an?.out ?? null, buf);
      const micL = sim ? fakeMic : level(an?.mic ?? null, buf);
      smoothOut += (outL - smoothOut) * 0.25;
      smoothMic += (micL - smoothMic) * 0.3;

      const c = size / 2;
      ctx.clearRect(0, 0, size, size);

      // Mic waveform ring.
      const pts = 64;
      const w = wave(sim ? null : an?.mic ?? null, fbuf, pts, t, fakeMic);
      ctx.beginPath();
      for (let i = 0; i <= pts; i++) {
        const ang = (i / pts) * Math.PI * 2 - Math.PI / 2;
        const r = c * 0.78 + w[i % pts] * c * 0.18;
        const x = c + Math.cos(ang) * r, y = c + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = smoothMic > 0.04 ? ink : line;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Agent orb.
      const breathe = reduce ? 0 : Math.sin(t * (act === "thinking" ? 5 : 1.6)) * 0.03;
      const base = act === "idle" || act === "done" ? 0.42 : 0.48;
      const r = c * (base + breathe + smoothOut * 0.22);
      const blob = (radius: number, alpha: number, wobble: number, phase: number) => {
        ctx.beginPath();
        const n = 48;
        for (let i = 0; i <= n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const k = reduce ? 0 : Math.sin(ang * 3 + t * 1.7 + phase) * wobble + Math.cos(ang * 5 - t * 1.3 + phase) * wobble * 0.6;
          const rr = radius * (1 + k);
          const x = c + Math.cos(ang) * rr, y = c + Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = act === "idle" ? ink : accent;
        ctx.fill();
        ctx.globalAlpha = 1;
      };
      const wob = 0.02 + smoothOut * 0.08;
      blob(r * 1.18, 0.12, wob * 1.4, 1.1);
      blob(r * 1.06, 0.22, wob * 1.2, 2.3);
      blob(r, act === "connecting" ? 0.5 + 0.3 * Math.sin(t * 6) : 0.92, wob, 0);

      // Mic meter segments.
      const lit = Math.round(smoothMic * segments.length * 1.4);
      segments.forEach((s, i) => { s.dataset.on = i < lit ? "1" : "0"; });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analysersRef, size]);

  return (
    <div className={styles.orbWrap}>
      <canvas ref={canvasRef} className={styles.orb} style={{ width: size, height: size }} aria-hidden="true" />
      <div className={styles.meter} ref={meterRef} role="presentation" aria-label="Microphone level">
        {Array.from({ length: 14 }, (_, i) => <span key={i} data-on="0" />)}
      </div>
    </div>
  );
}
