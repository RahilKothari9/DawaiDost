"use client";
// OWNER: analytics agent. One facility × medicine: weekly closing-stock history, dashed projection with
// inbound transfers as step-ups, lead-time / threshold bands, donor reserve line, stockout marker.
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { max } from "d3-array";
import { scaleLinear, scaleTime } from "d3-scale";
import { area, line } from "d3-shape";
import { useDistrict } from "@/lib/district/store";
import { fmtDate, fmtDays, fmtInt } from "@/lib/analytics/format";
import { useElementWidth } from "@/lib/analytics/hooks";
import { DAY_MS, RISK_VAR, horizonFor, openInbound, projectStock, thresholdOf, weeklyDailyUse } from "@/lib/analytics/metrics";
import { ChartTooltip, EmptyState, type TipRow } from "./ChartTooltip";
import { RiskChip } from "./RiskChip";
import bits from "./bits.module.css";
import s from "./ForecastChart.module.css";

export type ForecastChartProps = {
  facilityId: string;
  medicineId: string;
  /** Total SVG height including axes (default 260). */
  height?: number;
  /** Title and key facts above the plot (default true). */
  showHeader?: boolean;
  /** Legend row under the plot (default true). */
  showLegend?: boolean;
  className?: string;
};

type Snap = { t: number; kind: "history" | "projection"; stock: number; dispensed?: number; note?: string };

const M = { top: 24, right: 16, bottom: 24, left: 40 };

export function ForecastChart({ facilityId, medicineId, height = 260, showHeader = true, showLegend = true, className }: ForecastChartProps) {
  const { state, getAssessment } = useDistrict();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);

  const model = useMemo(() => {
    const r = state.stock.find((x) => x.facilityId === facilityId && x.medicineId === medicineId);
    const m = state.medicines.find((x) => x.id === medicineId);
    const f = state.facilities.find((x) => x.id === facilityId);
    if (!r || !m || !f) return null;
    const inbound = openInbound(state, facilityId, medicineId);
    const horizon = horizonFor(r, m);
    const proj = projectStock(r, state.now, horizon, inbound);
    const now = new Date(state.now).getTime();
    const history = r.history
      .map((h) => ({ t: Math.min(new Date(h.weekOf).getTime() + 3.5 * DAY_MS, now - 2 * DAY_MS), stock: Math.max(0, h.closingStock), dispensed: h.dispensed, weekOf: h.weekOf }))
      .filter((h) => Number.isFinite(h.t))
      .sort((a, b) => a.t - b.t);
    const snaps: Snap[] = [
      ...history.map((h) => ({ t: h.t, kind: "history" as const, stock: h.stock, dispensed: h.dispensed, note: `Week of ${fmtDate(h.weekOf)}` })),
      ...Array.from({ length: horizon + 1 }, (_, i) => {
        const t = now + i * DAY_MS;
        return { t, kind: "projection" as const, stock: proj.stockAt(t + (i === 0 ? 0 : 1)) };
      }),
    ];
    const names = new Map(state.facilities.map((x) => [x.id, x.name]));
    return { r, m, f, inbound, proj, history, snaps, now, names };
  }, [state, facilityId, medicineId]);

  const a = getAssessment(facilityId, medicineId);

  if (!model || !a) {
    return <EmptyState title="No stock line for this selection">This facility has not reported this medicine.</EmptyState>;
  }

  const { r, m, f, proj, history, snaps, now, names } = model;
  const d = r.dailyUse;
  const thrUnits = thresholdOf(m) * d;
  const leadUnits = m.leadTimeDays * d;
  const reserveUnits = m.reserveDays * d;

  const W = Math.max(0, width);
  const H = height;
  const iw = Math.max(10, W - M.left - M.right);
  const ih = Math.max(10, H - M.top - M.bottom);
  const t0 = history.length ? history[0]!.t - 4 * DAY_MS : now - 7 * DAY_MS;
  const x = scaleTime().domain([t0, proj.horizonEnd]).range([0, iw]);
  const yMax = (max([...history.map((h) => h.stock), ...proj.points.map((p) => p.stock), thrUnits * 1.25, reserveUnits * 1.1, 1]) ?? 1) * 1.08;
  const y = scaleLinear().domain([0, yMax]).range([ih, 0]).nice(4);
  const yTicks = y.ticks(4);
  const xTicks = x.ticks(Math.max(2, Math.floor(iw / 90)));
  const weekPx = x(t0 + 7 * DAY_MS) - x(t0);
  const barW = Math.max(3, Math.min(22, weekPx * 0.55));

  const projLine = line<{ t: number; stock: number }>().x((p) => x(p.t)).y((p) => y(p.stock))(proj.points) ?? "";
  const projArea = area<{ t: number; stock: number }>().x((p) => x(p.t)).y0(ih).y1((p) => y(p.stock))(proj.points) ?? "";

  // stretches at zero inside the projection
  const zeroRuns: [number, number][] = [];
  for (let i = 1; i < proj.points.length; i++) {
    const p0 = proj.points[i - 1]!, p1 = proj.points[i]!;
    if (p0.stock <= 0 && p1.stock <= 0 && p1.t > p0.t) zeroRuns.push([p0.t, p1.t]);
  }

  const hiSnap = hi !== null ? snaps[hi] : undefined;
  const nearest = (px: number) => {
    let best = 0, bd = Infinity;
    snaps.forEach((sn, i) => {
      const dd = Math.abs(x(sn.t) - px);
      if (dd < bd) { bd = dd; best = i; }
    });
    return best;
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHi(nearest(e.clientX - box.left));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key)) return;
    e.preventDefault();
    if (e.key === "Escape") return setHi(null);
    const todayIdx = snaps.findIndex((sn) => sn.kind === "projection");
    const cur = hi ?? todayIdx;
    const next = e.key === "Home" ? 0 : e.key === "End" ? snaps.length - 1 : cur + (e.key === "ArrowRight" ? 1 : -1);
    setHi(Math.max(0, Math.min(snaps.length - 1, next)));
  };

  const tipRows = (sn: Snap): TipRow[] => {
    if (sn.kind === "history") {
      const du = weeklyDailyUse(sn.dispensed ?? 0, d);
      return [
        { label: "Closing stock", value: fmtInt(sn.stock), color: "var(--line-strong)", kind: "dot" },
        { label: "Dispensed (week)", value: fmtInt(sn.dispensed ?? 0) },
        { label: "Days of cover", value: `${fmtDays(du > 0 ? sn.stock / du : Infinity)} d` },
      ];
    }
    return [
      { label: "Projected stock", value: fmtInt(sn.stock), color: "var(--ink)" },
      { label: "Days of cover", value: `${fmtDays(d > 0 ? sn.stock / d : Infinity)} d` },
      { label: "Threshold", value: fmtInt(thrUnits) },
    ];
  };
  const tipNote = (sn: Snap) => {
    if (sn.kind !== "projection") return undefined;
    const arr = proj.arrivals.find((ar) => Math.abs(ar.at - sn.t) < DAY_MS / 2 || (ar.at > sn.t - DAY_MS && ar.at <= sn.t + DAY_MS / 2));
    if (arr) return `Transfer +${fmtInt(arr.transfer.quantity)} from ${names.get(arr.transfer.fromId) ?? arr.transfer.fromId} arrives ${fmtDate(arr.at)}`;
    if (sn.stock <= 0) return "Shelf empty — patients turned away";
    return undefined;
  };

  const riskColor = RISK_VAR[a.risk];
  const reserveLabelY = Math.abs(y(reserveUnits) - y(thrUnits)) < 14 ? y(reserveUnits) + 12 : y(reserveUnits) - 4;
  const lowZoneH = y(leadUnits) - y(thrUnits);
  const critZoneH = ih - y(leadUnits);
  const summary = `${f.name}, ${m.name}: ${fmtInt(r.stock)} ${m.unit} on shelf, ${fmtDays(a.daysOfStock)} days of stock. ${proj.stockoutAt ? `Projected stockout ${fmtDate(proj.stockoutAt)}.` : "No stockout projected in the window."} ${proj.arrivals.length ? `${proj.arrivals.length} inbound transfer(s).` : ""}`;

  return (
    <figure className={[s.wrap, className].filter(Boolean).join(" ")} style={{ margin: 0 }}>
      {showHeader && (
        <figcaption>
          <div className={s.head}>
            <p className={s.title}>
              <small>{f.name} · forecast</small>
              {m.name} {m.strength}
            </p>
            <p className={s.facts}>
              <span><b>{fmtInt(r.stock)}</b> {m.unit}</span>
              <span><b>{d < 10 ? d.toFixed(1) : fmtInt(d)}</b>/day</span>
              <RiskChip risk={a.risk} days={a.daysOfStock} size="sm" />
              {proj.stockoutAt ? <span>Out <b>{fmtDate(proj.stockoutAt)}</b></span> : <span>No stockout in {Math.round((proj.horizonEnd - now) / DAY_MS)} d</span>}
            </p>
          </div>
        </figcaption>
      )}

      <div ref={ref} className={s.plot} style={{ height: H }}>
        {W > 0 && (
          <svg
            className={s.svg}
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={summary}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setHi(null)}
          >
            <g transform={`translate(${M.left},${M.top})`}>
              {/* zones */}
              {critZoneH > 0 && <rect x={0} y={y(leadUnits)} width={iw} height={critZoneH} fill="var(--risk-critical)" opacity={0.08} />}
              {lowZoneH > 0 && <rect x={0} y={y(thrUnits)} width={iw} height={lowZoneH} fill="var(--risk-low)" opacity={0.12} />}

              {/* grid + y axis */}
              {yTicks.map((t) => (
                <g key={t}>
                  <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                  <text className={s.axis} x={-8} y={y(t)} dy="0.32em" textAnchor="end">{fmtInt(t)}</text>
                </g>
              ))}
              {/* x axis */}
              {xTicks.map((t) => (
                <text key={+t} className={s.axis} x={x(t)} y={ih + 16} textAnchor="middle">{fmtDate(t)}</text>
              ))}

              {/* threshold + reserve */}
              {thrUnits > 0 && (
                <>
                  <line x1={0} x2={iw} y1={y(thrUnits)} y2={y(thrUnits)} stroke="var(--risk-low)" strokeWidth={1.5} strokeDasharray="4 3" />
                  <text className={s.zoneLabel} x={iw - 4} y={y(thrUnits) - 5} textAnchor="end">Threshold {thresholdOf(m)}d · {fmtInt(thrUnits)}</text>
                </>
              )}
              {reserveUnits > 0 && reserveUnits < yMax && (
                <>
                  <line x1={0} x2={iw} y1={y(reserveUnits)} y2={y(reserveUnits)} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="1 3" strokeLinecap="round" />
                  <text className={s.lineLabel} x={iw - 4} y={reserveLabelY} textAnchor="end">Donor reserve {m.reserveDays}d</text>
                </>
              )}

              {/* history bars: 4px rounded data-end, square baseline */}
              {history.map((h, i) => {
                const bx = x(h.t) - barW / 2;
                const top = y(h.stock);
                const bh = ih - top;
                const rr = Math.min(4, barW / 2, bh);
                const isHi = hiSnap?.kind === "history" && hiSnap.t === h.t;
                return (
                  <path
                    key={i}
                    d={bh <= 0 ? "" : `M${bx},${ih}V${top + rr}Q${bx},${top} ${bx + rr},${top}H${bx + barW - rr}Q${bx + barW},${top} ${bx + barW},${top + rr}V${ih}Z`}
                    fill={isHi ? "var(--ink-2)" : i === history.length - 1 ? "var(--muted)" : "var(--line-strong)"}
                  />
                );
              })}

              {/* today */}
              <line x1={x(now)} x2={x(now)} y1={-10} y2={ih} stroke="var(--ink)" strokeWidth={1} opacity={0.5} />
              {(() => {
                const clash = proj.stockoutAt !== null && Math.abs(x(proj.stockoutAt) - x(now)) < 90;
                return (
                  <text className={s.todayLabel} x={clash ? x(now) - 4 : x(now) + 4} y={-12} textAnchor={clash ? "end" : "start"}>Today</text>
                );
              })()}

              {/* projection */}
              <path className={s.projection} d={projArea} fill="var(--ink)" opacity={0.05} />
              <path className={s.projection} d={projLine} fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" />

              {/* days at zero */}
              {zeroRuns.map(([a0, a1], i) => (
                <line key={i} x1={x(a0)} x2={x(a1)} y1={ih} y2={ih} stroke="var(--risk-stockout)" strokeWidth={4} strokeLinecap="round" />
              ))}

              {/* inbound arrivals */}
              {proj.arrivals.map((ar, i) => {
                const ax = x(ar.at);
                const label = `+${fmtInt(ar.transfer.quantity)} ${names.get(ar.transfer.fromId)?.replace(/ (PHC|CHC|DH)$/, "") ?? ""}`.trim();
                const lw = label.length * 6.2 + 12;
                const lx = Math.min(iw - lw, Math.max(0, ax - lw / 2));
                const ly = Math.max(-2, y(ar.after) - 26);
                return (
                  <g key={ar.transfer.id ?? i}>
                    <line x1={ax} x2={ax} y1={y(ar.before)} y2={y(ar.after)} stroke="var(--accent)" strokeWidth={2} />
                    <circle cx={ax} cy={y(ar.after)} r={4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                    <rect x={lx} y={ly} width={lw} height={17} rx={8.5} fill="var(--accent)" />
                    <text className={s.pillText} x={lx + lw / 2} y={ly + 12} textAnchor="middle">{label}</text>
                  </g>
                );
              })}

              {/* stockout marker */}
              {proj.stockoutAt !== null && (() => {
                const sx = x(proj.stockoutAt);
                const label = `OUT ${fmtDate(proj.stockoutAt).toUpperCase()}`;
                const lw = label.length * 6.4 + 12;
                const lx = Math.min(iw - lw, Math.max(0, sx - 1));
                return (
                  <g>
                    <line x1={sx} x2={sx} y1={10} y2={ih} stroke="var(--risk-stockout)" strokeWidth={1.5} />
                    <rect x={lx} y={-8} width={lw} height={17} rx={3} fill="var(--risk-stockout)" />
                    <text className={s.pillText} x={lx + lw / 2} y={4} textAnchor="middle">{label}</text>
                    <circle cx={sx} cy={ih} r={4.5} fill="var(--risk-stockout)" stroke="var(--surface)" strokeWidth={2} />
                  </g>
                );
              })()}

              {/* current point */}
              <circle cx={x(now)} cy={y(r.stock)} r={5} fill={riskColor} stroke="var(--surface)" strokeWidth={2} />

              {/* crosshair */}
              {hiSnap && (
                <g pointerEvents="none">
                  <line x1={x(hiSnap.t)} x2={x(hiSnap.t)} y1={0} y2={ih} stroke="var(--ink)" strokeWidth={1} />
                  <circle cx={x(hiSnap.t)} cy={y(hiSnap.stock)} r={4} fill={hiSnap.kind === "history" ? "var(--ink-2)" : "var(--ink)"} stroke="var(--surface)" strokeWidth={2} />
                </g>
              )}
              <rect
                x={0}
                y={-M.top}
                width={iw}
                height={ih + M.top}
                fill="transparent"
                onPointerMove={onMove}
                onPointerDown={onMove}
                onPointerLeave={() => setHi(null)}
              />
            </g>
          </svg>
        )}
        {hiSnap && W > 0 && (
          <ChartTooltip
            x={M.left + x(hiSnap.t)}
            y={M.top + Math.max(0, y(hiSnap.stock) - 40)}
            containerWidth={W}
            title={hiSnap.kind === "history" ? hiSnap.note : hiSnap.t === now ? `Today · ${fmtDate(hiSnap.t)}` : `${fmtDate(hiSnap.t)} · projected`}
            rows={tipRows(hiSnap)}
            note={tipNote(hiSnap)}
          />
        )}
      </div>

      {showLegend && (
        <ul className={s.legend} aria-hidden>
          <li><svg width={10} height={12}><rect x={1} y={2} width={8} height={10} rx={2} fill="var(--line-strong)" /></svg>Weekly closing stock</li>
          <li><svg width={18} height={4}><line x1={0} x2={18} y1={2} y2={2} stroke="var(--ink)" strokeWidth={2} strokeDasharray="5 3" /></svg>Projection at current use</li>
          <li><svg width={14} height={10}><rect width={14} height={10} rx={2} fill="var(--risk-low)" opacity={0.3} /></svg>Below threshold ({thresholdOf(m)}d)</li>
          <li><svg width={14} height={10}><rect width={14} height={10} rx={2} fill="var(--risk-critical)" opacity={0.22} /></svg>Inside lead time ({m.leadTimeDays}d)</li>
          <li><svg width={18} height={4}><line x1={0} x2={18} y1={2} y2={2} stroke="var(--ink-2)" strokeWidth={1.2} strokeDasharray="1 3" strokeLinecap="round" /></svg>Donor reserve</li>
          {proj.arrivals.length > 0 && <li><svg width={10} height={10}><circle cx={5} cy={5} r={4} fill="var(--accent)" /></svg>Inbound transfer</li>}
        </ul>
      )}

      <table className={bits.srOnly}>
        <caption>{summary}</caption>
        <thead><tr><th>Date</th><th>Type</th><th>Stock ({m.unit})</th></tr></thead>
        <tbody>
          {history.map((h) => <tr key={h.t}><td>{fmtDate(h.weekOf)}</td><td>Weekly closing</td><td>{fmtInt(h.stock)}</td></tr>)}
          {proj.points.map((p, i) => <tr key={`p${i}`}><td>{fmtDate(p.t)}</td><td>{p.arrival ? "Projected, after transfer" : "Projected"}</td><td>{fmtInt(p.stock)}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}
