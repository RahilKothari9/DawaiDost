"use client";
// OWNER: evals agent. Expected (rows) × chosen (columns) heatmap. Shade = share of the row, one hue.
import { useRef, useState } from "react";
import { ChartTooltip } from "@/components/analytics/ChartTooltip";
import type { DecisionAction } from "@/lib/district/types";
import { EVAL_ACTIONS } from "@/lib/evals/metrics";
import { ACTION_SHORT, pct } from "./format";
import s from "./evals.module.css";

type Props = {
  confusion: Record<DecisionAction, Record<DecisionAction, number>>;
  /** Case ids per (expected, chosen) cell, for the tooltip. */
  cellCases?: Record<string, string[]>;
  onCell?: (expected: DecisionAction, chosen: DecisionAction) => void;
};

export function ConfusionMatrix({ confusion, cellCases, onCell }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; w: number; e: DecisionAction; c: DecisionAction } | null>(null);
  const show = (el: HTMLElement, e: DecisionAction, c: DecisionAction) => {
    const b = box.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (b) setTip({ x: r.right - b.left, y: r.top - b.top, w: b.width, e, c });
  };
  return (
    <div className={s.chartBox} ref={box} onMouseLeave={() => setTip(null)}>
      <div className={s.cm} role="table" aria-label="Confusion matrix: expected action by row, chosen action by column">
        <div role="row" style={{ display: "contents" }}>
          <span className={s.cmAxis} role="columnheader">Expected ↓ Chosen →</span>
          {EVAL_ACTIONS.map((a) => (
            <span key={a} className={s.cmColHead} role="columnheader">{ACTION_SHORT[a]}</span>
          ))}
        </div>
        {EVAL_ACTIONS.map((e) => {
          const rowTotal = EVAL_ACTIONS.reduce((t, c) => t + confusion[e][c], 0);
          return (
            <div key={e} role="row" style={{ display: "contents" }}>
              <span className={s.cmRowHead} role="rowheader">{ACTION_SHORT[e]}</span>
              {EVAL_ACTIONS.map((c) => {
                const n = confusion[e][c];
                const share = rowTotal ? n / rowTotal : 0;
                const bg = n ? `color-mix(in oklab, var(--accent) ${Math.round(8 + share * 92)}%, var(--surface))` : "var(--surface-2)";
                const fg = share > 0.5 ? "var(--accent-ink)" : "var(--ink)";
                return (
                  <button
                    key={c}
                    type="button"
                    role="cell"
                    className={s.cmCell}
                    data-diag={e === c}
                    data-zero={n === 0}
                    style={{ background: bg, color: n ? fg : undefined }}
                    aria-label={`Expected ${ACTION_SHORT[e]}, chosen ${ACTION_SHORT[c]}: ${n} of ${rowTotal}`}
                    onMouseEnter={(ev) => show(ev.currentTarget, e, c)}
                    onFocus={(ev) => show(ev.currentTarget, e, c)}
                    onBlur={() => setTip(null)}
                    onClick={() => n && onCell?.(e, c)}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {tip ? (
        <ChartTooltip
          x={tip.x}
          y={tip.y}
          containerWidth={tip.w}
          title={`Expected ${ACTION_SHORT[tip.e]} → chose ${ACTION_SHORT[tip.c]}`}
          rows={[
            { label: "Cases", value: confusion[tip.e][tip.c], kind: "blank" },
            { label: "Share of row", value: pct(EVAL_ACTIONS.reduce((t, c) => t + confusion[tip.e][c], 0) ? confusion[tip.e][tip.c] / EVAL_ACTIONS.reduce((t, c) => t + confusion[tip.e][c], 0) : 0), kind: "blank" },
          ]}
          note={cellCases?.[`${tip.e}|${tip.c}`]?.length ? cellCases[`${tip.e}|${tip.c}`].join(" · ") : undefined}
          width={210}
        />
      ) : null}
      <div className={s.cmLegend}>
        <span>0%</span>
        <span className={s.cmRamp} aria-hidden />
        <span>100% of the expected row</span>
        <span className={s.cmDiagKey} aria-hidden style={{ marginLeft: 12 }} />
        <span>correct (diagonal)</span>
      </div>
    </div>
  );
}
