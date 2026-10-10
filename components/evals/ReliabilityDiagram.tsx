"use client";
// OWNER: evals agent. Reliability diagram: mean stated confidence (x) vs. observed accuracy (y) per confidence bin.
import { useRef, useState } from "react";
import { ChartTooltip } from "@/components/analytics/ChartTooltip";
import type { ReliabilityBin } from "@/lib/evals/metrics";
import { pct } from "./format";
import s from "./evals.module.css";

export type ReliabilitySeries = { id: string; label: string; color: string; bins: ReliabilityBin[] };

const W = 420, H = 300, M = { t: 10, r: 14, b: 38, l: 44 };
const iw = W - M.l - M.r, ih = H - M.t - M.b;
const X = (v: number) => M.l + v * iw;
const Y = (v: number) => M.t + (1 - v) * ih;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

export function ReliabilityDiagram({ series }: { series: ReliabilitySeries[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; w: number; s: ReliabilitySeries; b: ReliabilityBin } | null>(null);
  const maxCount = Math.max(1, ...series.flatMap((x) => x.bins.map((b) => b.count)));
  const show = (el: Element, ser: ReliabilitySeries, b: ReliabilityBin) => {
    const host = box.current?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (host) setTip({ x: rect.left + rect.width / 2 - host.left, y: rect.top - host.top - 10, w: host.width, s: ser, b });
  };
  const r = (n: number) => 4 + Math.sqrt(n / maxCount) * 7;

  return (
    <div className={s.chartBox} ref={box} onMouseLeave={() => setTip(null)}>
      <div className={s.legend}>
        {series.map((x) => (
          <span key={x.id} className={s.legendItem}><i className={s.keyDot} style={{ background: x.color }} />{x.label}</span>
        ))}
        <span className={s.legendItem}><i className={s.keyDash} />Perfect calibration</span>
      </div>
      <svg className={s.svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Reliability diagram: stated confidence against observed accuracy">
        {TICKS.map((t) => (
          <g key={t}>
            <line x1={X(0)} x2={X(1)} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={M.l - 8} y={Y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" fontFamily="var(--font-mono)">{t * 100}%</text>
            <text x={X(t)} y={H - M.b + 16} textAnchor="middle" fontSize={11} fill="var(--muted)" fontFamily="var(--font-mono)">{t * 100}%</text>
          </g>
        ))}
        <text x={X(0.5)} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--ink-2)">Stated confidence</text>
        <text transform={`translate(11 ${Y(0.5)}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--ink-2)">Observed accuracy</text>
        <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="var(--line-strong)" strokeWidth={1} />
        {series.map((x) => (
          <g key={x.id}>
            {x.bins.length > 1 ? (
              <polyline points={x.bins.map((b) => `${X(b.meanConfidence)},${Y(b.accuracy)}`).join(" ")} fill="none" stroke={x.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ) : null}
            {x.bins.map((b) => (
              <circle
                key={b.lo}
                cx={X(b.meanConfidence)}
                cy={Y(b.accuracy)}
                r={r(b.count)}
                fill={x.color}
                stroke="var(--surface)"
                strokeWidth={2}
                tabIndex={0}
                aria-label={`${x.label}: confidence ${pct(b.meanConfidence)}, accuracy ${pct(b.accuracy)}, ${b.count} cases`}
                onMouseEnter={(ev) => show(ev.currentTarget, x, b)}
                onFocus={(ev) => show(ev.currentTarget, x, b)}
                onBlur={() => setTip(null)}
                style={{ cursor: "default", outline: "none" }}
              />
            ))}
          </g>
        ))}
      </svg>
      {tip ? (
        <ChartTooltip
          x={tip.x}
          y={tip.y}
          containerWidth={tip.w}
          title={`${tip.s.label} · confidence ${pct(tip.b.lo)}–${pct(tip.b.hi)}`}
          rows={[
            { label: "Mean confidence", value: pct(tip.b.meanConfidence, 1), color: tip.s.color, kind: "dot" },
            { label: "Observed accuracy", value: pct(tip.b.accuracy, 1), kind: "blank" },
            { label: "Cases in bin", value: tip.b.count, kind: "blank" },
          ]}
        />
      ) : null}
    </div>
  );
}
