"use client";
// OWNER: escalations agent. Horizontal waterfall: facility need, minus safe surplus, minus warehouse issue, leaves the state gap.
import { useState } from "react";
import { scaleLinear } from "d3-scale";
import { ChartTooltip } from "@/components/analytics/ChartTooltip";
import { useElementWidth } from "@/lib/analytics/hooks";
import type { SupplyGap } from "@/lib/escalations/gap";
import { fmtUnits } from "@/lib/escalations/memo";
import s from "./escalations.module.css";

type Step = { key: string; label: string; from: number; to: number; color: string; value: number; note?: string; strong?: boolean };

const ROW = 34;
const BAR = 18;
const LABEL_W = 168;
const AXIS_H = 22;

export function GapWaterfall({ gap }: { gap: SupplyGap }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const u = gap.medicine.unit;
  const afterSurplus = gap.needUnits - gap.surplusApplied;
  const afterWarehouse = afterSurplus - gap.warehouseApplied;
  const steps: Step[] = [
    { key: "need", label: "Facility need", from: 0, to: gap.needUnits, color: "var(--ink-2)", value: gap.needUnits, note: `${gap.affected.length} facilities below ${gap.thresholdDays} days` },
    { key: "surplus", label: "Safe surplus moved", from: afterSurplus, to: gap.needUnits, color: "var(--risk-surplus)", value: -gap.surplusApplied, note: `${fmtUnits(gap.transferableUnits)} transferable at ${gap.donorFacilities} sites` },
    { key: "wh", label: "Warehouse issue", from: afterWarehouse, to: afterSurplus, color: "var(--muted)", value: -gap.warehouseApplied, note: `${fmtUnits(gap.warehouseStock)} in district warehouse` },
    { key: "gap", label: "Short: state supply", from: 0, to: gap.gapUnits, color: "var(--risk-stockout)", value: gap.gapUnits, strong: true, note: gap.gapUnits > 0 ? "Cannot be closed inside the district" : "Closed locally" },
  ];
  const plotW = Math.max(120, width - LABEL_W - 64);
  const max = Math.max(1, gap.needUnits);
  const x = scaleLinear().domain([0, max]).range([0, plotW]).nice(4);
  const ticks = x.ticks(4);
  const h = steps.length * ROW + AXIS_H;

  return (
    <div className={s.wf} ref={ref}>
      {width > 0 ? (
        <svg width={width} height={h} role="img" aria-label={`Waterfall for ${gap.medicine.name}: need ${gap.needUnits}, surplus ${gap.surplusApplied}, warehouse ${gap.warehouseApplied}, short ${gap.gapUnits} ${u}`}>
          <g transform={`translate(${LABEL_W},0)`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(${x(t)},0)`}>
                <line className={s.wfGrid} y1={0} y2={steps.length * ROW} />
                <text className={s.wfAxis} y={steps.length * ROW + 15} textAnchor="middle">{fmtUnits(t)}</text>
              </g>
            ))}
            {steps.map((st, i) => {
              const y = i * ROW + (ROW - BAR) / 2;
              const x0 = x(Math.min(st.from, st.to));
              const w = Math.max(st.to - st.from > 0 ? 2 : 0, x(Math.abs(st.to - st.from)));
              const next = steps[i + 1];
              const connectAt = st.key === "need" ? st.to : st.from;
              return (
                <g key={st.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect className={s.wfHit} x={-LABEL_W} y={i * ROW} width={LABEL_W + plotW + 60} height={ROW} />
                  {w > 0 ? <rect x={x0} y={y} width={w} height={BAR} rx={st.key === "need" || st.key === "gap" ? 3 : 2} fill={st.color} opacity={hover === null || hover === i ? 1 : 0.55} /> : null}
                  {next ? <line className={s.wfConn} x1={x(connectAt)} x2={x(connectAt)} y1={y + BAR} y2={(i + 1) * ROW + (ROW - BAR) / 2} /> : null}
                  <text className={s.wfValue} x={x0 + w + 6} y={y + BAR / 2 + 4} fontWeight={st.strong ? 600 : 400}>
                    {st.value < 0 ? "−" : ""}{fmtUnits(Math.abs(st.value))}
                  </text>
                </g>
              );
            })}
          </g>
          {steps.map((st, i) => (
            <text key={st.key} className={st.strong ? s.wfLabelStrong : s.wfLabel} x={0} y={i * ROW + ROW / 2 + 4}>{st.label}</text>
          ))}
        </svg>
      ) : <div style={{ height: h }} />}
      {hover !== null && width > 0 ? (
        <ChartTooltip
          x={LABEL_W + x(Math.max(steps[hover].from, steps[hover].to))}
          y={hover * ROW}
          containerWidth={width}
          title={steps[hover].label}
          rows={[
            { label: u, value: `${steps[hover].value < 0 ? "−" : ""}${fmtUnits(Math.abs(steps[hover].value))}`, color: steps[hover].color },
            { label: "Running total", value: fmtUnits(steps[hover].key === "gap" ? gap.gapUnits : steps[hover].key === "need" ? gap.needUnits : steps[hover].from), kind: "blank" },
          ]}
          note={steps[hover].note}
        />
      ) : null}
      <table className="sr-only">
        <caption>Supply gap waterfall, {u}</caption>
        <tbody>
          {steps.map((st) => <tr key={st.key}><th scope="row">{st.label}</th><td>{st.value}</td><td>{st.note}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
