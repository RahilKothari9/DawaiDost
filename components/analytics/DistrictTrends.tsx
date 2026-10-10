"use client";
// OWNER: analytics agent. District trends: cumulative stockout-days averted, plus small multiples per
// medicine (pooled coverage days vs threshold, facilities at risk per week).
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { max } from "d3-array";
import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, curveStepAfter, line } from "d3-shape";
import { useDistrict } from "@/lib/district/store";
import type { DistrictState, Medicine, StockAssessment } from "@/lib/district/types";
import { fmtDate, fmtDays, fmtInt, fmtSigned } from "@/lib/analytics/format";
import { useElementWidth } from "@/lib/analytics/hooks";
import { DAY_MS, RISK_VAR, avertedSeries, historyWeeks, medicineSnapshot, medicineWeekly, type AvertedPoint, type MedicineSnapshot, type WeekPoint } from "@/lib/analytics/metrics";
import { ChartTooltip, EmptyState } from "./ChartTooltip";
import { RiskChip } from "./RiskChip";
import bits from "./bits.module.css";
import s from "./DistrictTrends.module.css";

export type DistrictTrendsProps = {
  /** Initial / externally controlled medicine filter. Omit for "All". */
  medicineId?: string;
  onMedicineChange?: (medicineId: string | null) => void;
  /** Hide the cumulative stockout-days-averted card. */
  hideAverted?: boolean;
  className?: string;
};

type Series = { m: Medicine; snap: MedicineSnapshot; weeks: WeekPoint[] };

export function DistrictTrends({ medicineId, onMedicineChange, hideAverted = false, className }: DistrictTrendsProps) {
  const { state, assessments } = useDistrict();
  const [filter, setFilter] = useState<string | null>(medicineId ?? null);
  const [prevProp, setPrevProp] = useState(medicineId);
  if (prevProp !== medicineId) {
    setPrevProp(medicineId);
    setFilter(medicineId ?? null);
  }

  const { series, atRiskMax, averted } = useMemo(() => build(state, assessments), [state, assessments]);
  const shown = filter ? series.filter((x) => x.m.id === filter) : series;

  const choose = (id: string | null) => {
    setFilter(id);
    onMedicineChange?.(id);
  };

  if (!series.length) return <EmptyState title="No medicines tracked yet" />;

  return (
    <section className={[s.wrap, className].filter(Boolean).join(" ")} aria-label="District trends">
      <div className={s.filters} role="group" aria-label="Filter by medicine">
        <button type="button" className={s.chip} aria-pressed={filter === null} onClick={() => choose(null)}>
          All medicines
        </button>
        {series.map((x) => (
          <button key={x.m.id} type="button" className={s.chip} aria-pressed={filter === x.m.id} onClick={() => choose(x.m.id)}>
            {x.snap.atRisk > 0 && <i style={{ background: "var(--risk-critical)" }} aria-hidden />}
            {x.m.shortName ?? x.m.name}
          </button>
        ))}
      </div>

      {!hideAverted && <AvertedCard points={averted} state={state} medicineId={filter} />}

      <div className={s.grid} data-single={shown.length === 1 ? "true" : undefined}>
        {shown.map((x) => (
          <MedicineMultiple key={x.m.id} series={x} atRiskMax={atRiskMax} tall={shown.length === 1} />
        ))}
      </div>
      <p className={s.foot}>
        Pooled cover = site stock ÷ site daily use, district warehouse excluded. Each panel uses its own day scale; at-risk bars share one scale. Synthetic data.
      </p>
    </section>
  );
}

function build(state: DistrictState, assessments: StockAssessment[]) {
  const weeks = historyWeeks(state);
  const series: Series[] = state.medicines
    .map((m) => ({ m, snap: medicineSnapshot(state, assessments, m), weeks: medicineWeekly(state, m, weeks) }))
    .sort((a, b) => b.snap.atRisk - a.snap.atRisk || a.snap.coverageDays / a.snap.thresholdDays - b.snap.coverageDays / b.snap.thresholdDays);
  const atRiskMax = Math.max(1, ...series.flatMap((x) => x.weeks.map((w) => w.atRisk)));
  return { series, atRiskMax, averted: avertedSeries(state) };
}

// ------------------------------------------------------------------ small multiple

const MM = { top: 10, right: 30, bottom: 18, left: 26 };

function MedicineMultiple({ series, atRiskMax, tall }: { series: Series; atRiskMax: number; tall: boolean }) {
  const { m, snap, weeks } = series;
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const lineH = tall ? 150 : 84;
  const barH = tall ? 46 : 30;
  const gapH = 10;
  const H = MM.top + lineH + gapH + barH + MM.bottom;
  const iw = Math.max(10, width - MM.left - MM.right);
  const thr = snap.thresholdDays;

  const x = scaleLinear().domain([0, Math.max(1, weeks.length - 1)]).range([0, iw]);
  const yMax = Math.max(thr * 1.4, max(weeks, (w) => w.coverageDays) ?? 0) * 1.08;
  const y = scaleLinear().domain([0, yMax]).range([lineH, 0]).nice(3);
  const yb = scaleLinear().domain([0, atRiskMax]).range([barH, 0]);
  const pts = weeks.map((w, i) => [x(i), y(w.coverageDays)] as [number, number]);
  const path = line().curve(curveMonotoneX)(pts) ?? "";
  const wash = area().curve(curveMonotoneX).y0(lineH)(pts) ?? "";
  const step = Math.max(1, Math.ceil(weeks.length / Math.max(2, Math.floor(iw / 60))));
  const bw = Math.max(2, Math.min(14, (iw / Math.max(1, weeks.length)) * 0.6));
  const last = weeks[weeks.length - 1];
  const ref4 = weeks[Math.max(0, weeks.length - 5)];
  const delta = last && ref4 ? last.coverageDays - ref4.coverageDays : 0;
  const hiW = hi !== null ? weeks[hi] : undefined;
  const clipId = `below-${m.id}`;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const i = Math.round(x.invert(e.clientX - b.left));
    setHi(Math.max(0, Math.min(weeks.length - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Escape"].includes(e.key)) return;
    e.preventDefault();
    if (e.key === "Escape") return setHi(null);
    const cur = hi ?? weeks.length - 1;
    setHi(Math.max(0, Math.min(weeks.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
  };

  return (
    <article className={s.card} aria-label={`${m.name} ${m.strength} trend`}>
      <div className={s.cardHead}>
        <p className={s.cardTitle}>
          {m.name} {m.strength}
          <small>
            {snap.atRisk} of {snap.facilities} sites at risk · {snap.donors} donors
          </small>
        </p>
        <div>
          <p className={s.figure}>
            {fmtDays(snap.coverageDays)}
            <small>d</small>
          </p>
          <div className={s.figureSub}>
            <span title="Change in pooled cover vs 4 weeks ago">{fmtSigned(delta, 1)}d / 4 wk</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <RiskChip risk={snap.risk} size="sm" label="long" />
        {m.upstream && m.upstream.status !== "available" && (
          <span className={bits.chip} style={{ height: 18, fontSize: 10 }} title={m.upstream.note}>Upstream {m.upstream.status}</span>
        )}
      </div>
      <div ref={ref} className={s.plot} style={{ height: H }}>
        {width > 0 && weeks.length > 0 && (
          <svg
            className={s.svg}
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            role="img"
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setHi(null)}
            aria-label={`${m.name}: pooled cover ${fmtDays(snap.coverageDays)} days against ${thr}-day threshold; ${last?.atRisk ?? 0} sites at risk this week. ${weeks.length} weeks shown.`}
          >
            <g transform={`translate(${MM.left},${MM.top})`}>
              <defs>
                <clipPath id={clipId}><rect x={-2} y={y(thr)} width={iw + 4} height={lineH - y(thr) + 2} /></clipPath>
              </defs>
              {y.ticks(3).map((t) => (
                <g key={t}>
                  <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="var(--line)" />
                  <text className={s.axis} x={-6} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
                </g>
              ))}
              <rect x={0} y={y(thr)} width={iw} height={Math.max(0, lineH - y(thr))} fill="var(--risk-low)" opacity={0.1} />
              <line x1={0} x2={iw} y1={y(thr)} y2={y(thr)} stroke="var(--risk-low)" strokeWidth={1.25} strokeDasharray="4 3" />
              <text className={s.lab} x={iw + 4} y={y(thr)} dy="0.32em">{thr}d</text>
              <path d={wash} fill="var(--ink)" opacity={0.05} />
              <path d={path} fill="none" stroke="var(--ink-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <path d={path} fill="none" stroke="var(--risk-critical)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipId})`} />
              {pts.length > 0 && (
                <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={4} fill={RISK_VAR[snap.risk]} stroke="var(--surface)" strokeWidth={2} />
              )}

              {/* at-risk sites per week */}
              <g transform={`translate(0,${lineH + gapH})`}>
                <line x1={0} x2={iw} y1={barH} y2={barH} stroke="var(--line-strong)" />
                {weeks.map((w, i) => {
                  const h = barH - yb(w.atRisk);
                  if (h <= 0) return null;
                  const bx = x(i) - bw / 2;
                  const top = barH - h;
                  const rr = Math.min(2, bw / 2, h);
                  return (
                    <path
                      key={w.date}
                      d={`M${bx},${barH}V${top + rr}Q${bx},${top} ${bx + rr},${top}H${bx + bw - rr}Q${bx + bw},${top} ${bx + bw},${top + rr}V${barH}Z`}
                      fill={w.stockouts > 0 ? "var(--risk-stockout)" : "var(--risk-critical)"}
                      opacity={hi === null || hi === i ? 0.9 : 0.45}
                    />
                  );
                })}
                <text className={s.lab} x={iw + 4} y={barH - 2}>{last?.atRisk ?? 0}</text>
                <text className={s.axis} x={-6} y={4} textAnchor="end" dy="0.32em">{atRiskMax}</text>
                {weeks.map((w, i) =>
                  i % step === (weeks.length - 1) % step ? (
                    <text key={w.date} className={s.axis} x={x(i)} y={barH + 12} textAnchor="middle">{w.live ? "Now" : fmtDate(w.date)}</text>
                  ) : null,
                )}
              </g>

              {hiW && hi !== null && (
                <g pointerEvents="none">
                  <line x1={x(hi)} x2={x(hi)} y1={0} y2={lineH + gapH + barH} stroke="var(--ink)" />
                  <circle cx={x(hi)} cy={y(hiW.coverageDays)} r={4} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
                </g>
              )}
              <rect x={-MM.left / 2} y={-MM.top} width={iw + MM.left / 2} height={H} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHi(null)} />
            </g>
          </svg>
        )}
        {hiW && hi !== null && width > 0 && (
          <ChartTooltip
            x={MM.left + x(hi)}
            y={MM.top + Math.max(0, y(hiW.coverageDays) - 30)}
            containerWidth={width}
            width={176}
            title={hiW.live ? "This week · live" : `Week of ${fmtDate(hiW.date)}`}
            rows={[
              { label: "Pooled cover", value: `${fmtDays(hiW.coverageDays)} d`, color: "var(--ink-2)" },
              { label: "Sites at risk", value: String(hiW.atRisk), color: "var(--risk-critical)", kind: "dot" },
              { label: "Stockouts", value: String(hiW.stockouts), color: "var(--risk-stockout)", kind: "dot" },
              { label: `Site stock`, value: fmtInt(hiW.totalStock) },
            ]}
          />
        )}
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ averted

const AM = { top: 14, right: 16, bottom: 20, left: 30 };

function AvertedCard({ points, state, medicineId }: { points: AvertedPoint[]; state: DistrictState; medicineId: string | null }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const pts = useMemo(() => {
    if (!medicineId) return points;
    let total = 0;
    return points.filter((p) => p.transfer.medicineId === medicineId).map((p) => ({ ...p, total: (total += p.days) }));
  }, [points, medicineId]);
  const names = useMemo(() => new Map(state.facilities.map((f) => [f.id, f.name])), [state.facilities]);
  const meds = useMemo(() => new Map(state.medicines.map((m) => [m.id, m])), [state.medicines]);
  const total = pts.length ? pts[pts.length - 1]!.total : 0;
  const H = 150;
  const now = new Date(state.now).getTime();
  const weeks = historyWeeks(state);
  const start = Math.min(weeks.length ? new Date(weeks[0]!).getTime() : now - 28 * DAY_MS, pts[0]?.at ?? now);
  const iw = Math.max(10, width - AM.left - AM.right);
  const ih = H - AM.top - AM.bottom;
  const x = scaleTime().domain([start, now]).range([0, iw]);
  const y = scaleLinear().domain([0, Math.max(5, total * 1.15)]).range([ih, 0]).nice(3);
  const series: [number, number][] = [[x(start), y(0)], ...pts.map((p) => [x(p.at), y(p.total)] as [number, number]), [x(now), y(total)]];
  const path = line().curve(curveStepAfter)(series) ?? "";
  const wash = area().curve(curveStepAfter).y0(ih)(series) ?? "";
  const hiP = hi !== null ? pts[hi] : undefined;
  const transfers = pts.length;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    if (!pts.length) return;
    const b = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - b.left;
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(x(p.at) - px); if (d < bd) { bd = d; best = i; } });
    setHi(best);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!pts.length || !["ArrowLeft", "ArrowRight", "Escape"].includes(e.key)) return;
    e.preventDefault();
    if (e.key === "Escape") return setHi(null);
    const cur = hi ?? pts.length - 1;
    setHi(Math.max(0, Math.min(pts.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
  };

  return (
    <article className={`${s.card} ${s.hero}`} aria-label="Stockout-days averted">
      <div>
        <p className={s.heroLabel}>Stockout-days averted{medicineId ? ` · ${meds.get(medicineId)?.name ?? ""}` : ""}</p>
        <p className={s.heroValue}>
          {total.toFixed(1)}
          <small>days</small>
        </p>
        <p className={s.heroNote}>
          {transfers ? (
            <>
              From <b>{transfers}</b> approved {transfers === 1 ? "transfer" : "transfers"}. Each credits the days of cover it adds at the recipient, capped at the resupply lead time.
            </>
          ) : (
            <>No approved transfers yet{medicineId ? " for this medicine" : ""}. Approve a surplus transfer to start the count.</>
          )}
        </p>
      </div>
      <div ref={ref} className={s.plot} style={{ height: H }}>
        {width > 0 && (
          <svg className={s.svg} width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" tabIndex={pts.length ? 0 : -1} onKeyDown={onKey} onBlur={() => setHi(null)}
            aria-label={`Cumulative stockout-days averted: ${total.toFixed(1)} days from ${transfers} transfers.`}>
            <g transform={`translate(${AM.left},${AM.top})`}>
              {y.ticks(3).map((t) => (
                <g key={t}>
                  <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="var(--line)" />
                  <text className={s.axis} x={-6} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
                </g>
              ))}
              {x.ticks(Math.max(2, Math.floor(iw / 100))).map((t) => (
                <text key={+t} className={s.axis} x={x(t)} y={ih + 14} textAnchor="middle">{fmtDate(t)}</text>
              ))}
              <path d={wash} fill="var(--accent)" opacity={0.1} />
              <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
              {pts.map((p, i) => (
                <circle key={p.transfer.id} cx={x(p.at)} cy={y(p.total)} r={hi === i ? 5.5 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
              ))}
              {transfers > 0 && <text className={s.labStrong} x={iw} y={y(total) - 8} textAnchor="end">{total.toFixed(1)}d</text>}
              {hiP && <line x1={x(hiP.at)} x2={x(hiP.at)} y1={0} y2={ih} stroke="var(--ink)" pointerEvents="none" />}
              <rect x={0} y={-AM.top} width={iw} height={H} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHi(null)} />
            </g>
          </svg>
        )}
        {hiP && width > 0 && (
          <ChartTooltip
            x={AM.left + x(hiP.at)}
            y={AM.top + Math.max(0, y(hiP.total) - 30)}
            containerWidth={width}
            width={210}
            title={`${fmtDate(hiP.at)} · ${meds.get(hiP.transfer.medicineId)?.name ?? hiP.transfer.medicineId}`}
            rows={[
              { label: "Averted by this transfer", value: `+${hiP.days.toFixed(1)} d`, color: "var(--accent)", kind: "dot" },
              { label: "Cumulative", value: `${hiP.total.toFixed(1)} d`, color: "var(--accent)" },
              { label: "Quantity", value: fmtInt(hiP.transfer.quantity) },
            ]}
            note={`${names.get(hiP.transfer.fromId) ?? hiP.transfer.fromId} → ${names.get(hiP.transfer.toId) ?? hiP.transfer.toId} · ${hiP.transfer.status.replace("_", " ")}`}
          />
        )}
      </div>
    </article>
  );
}
