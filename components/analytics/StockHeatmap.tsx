"use client";
// OWNER: analytics agent. Facilities × medicines days-of-stock matrix, colored by risk.
import { useCallback, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useDistrict } from "@/lib/district/store";
import type { Facility, FacilityType, Medicine, StockAssessment, StockRecord, Transfer } from "@/lib/district/types";
import { fmtAgo, fmtDate, fmtDays, fmtInt } from "@/lib/analytics/format";
import { RISK_LABEL, RISK_LEVELS, RISK_VAR, buildLookup, isAtRisk, key, openInbound, riskRank } from "@/lib/analytics/metrics";
import { ChartTooltip, EmptyState, type TipRow } from "./ChartTooltip";
import s from "./StockHeatmap.module.css";

export type StockHeatmapProps = {
  onSelect?: (facilityId: string, medicineId: string) => void;
  /** Initial row ordering. */
  defaultSort?: SortMode;
  /** Restrict to these facility types (e.g. ["PHC", "CHC"]). */
  facilityTypes?: FacilityType[];
  className?: string;
};

type SortMode = "risk" | "block" | "type" | "name";
const SORTS: { id: SortMode; label: string }[] = [
  { id: "risk", label: "Worst first" },
  { id: "block", label: "Block" },
  { id: "type", label: "Type" },
  { id: "name", label: "A–Z" },
];
const TYPE_ORDER: FacilityType[] = ["WAREHOUSE", "DH", "CHC", "PHC"];
const TYPE_LABEL: Record<FacilityType, string> = { WAREHOUSE: "District store", DH: "District hospital", CHC: "Community health centres", PHC: "Primary health centres" };
const TYPE_SHORT: Record<FacilityType, string> = { WAREHOUSE: "WH", DH: "DH", CHC: "CHC", PHC: "PHC" };

type Cell = { m: Medicine; a?: StockAssessment; r?: StockRecord; inbound: Transfer[] };
type Row = { f: Facility; cells: Cell[]; score: number; minDays: number; atRisk: number };
type Group = { label: string | null; sub?: string; rows: Row[] };

export function StockHeatmap({ onSelect, defaultSort = "risk", facilityTypes, className }: StockHeatmapProps) {
  const { state, dispatch, assessments } = useDistrict();
  const [sort, setSort] = useState<SortMode>(defaultSort);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [tip, setTip] = useState<{ x: number; y: number; w: number; r: number; c: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  const { medicines, groups, flat, colRisk, rowIdx } = useMemo(() => {
    const L = buildLookup(state, assessments);
    const medicines = state.medicines;
    const stocked = new Set(state.stock.map((r) => r.facilityId));
    const facilities = state.facilities.filter((f) => stocked.has(f.id) && (!facilityTypes || facilityTypes.includes(f.type)));
    const rows: Row[] = facilities.map((f) => {
      const cells = medicines.map((m) => ({
        m,
        a: L.assessment.get(key(f.id, m.id)),
        r: L.record.get(key(f.id, m.id)),
        inbound: openInbound(state, f.id, m.id),
      }));
      const score = cells.reduce((acc, c) => acc + (c.a ? [1000, 100, 10, 0, 0][riskRank(c.a.risk)]! : 0), 0);
      const minDays = Math.min(...cells.map((c) => c.a?.daysOfStock ?? Infinity));
      return { f, cells, score, minDays, atRisk: cells.filter((c) => c.a && isAtRisk(c.a.risk)).length };
    });
    const byName = (a: Row, b: Row) => a.f.name.localeCompare(b.f.name);
    const byRisk = (a: Row, b: Row) => b.score - a.score || a.minDays - b.minDays || byName(a, b);
    const byType = (a: Row, b: Row) => TYPE_ORDER.indexOf(a.f.type) - TYPE_ORDER.indexOf(b.f.type);
    let groups: Group[];
    if (sort === "block" || sort === "type") {
      const keyOf = (r: Row) => (sort === "block" ? r.f.block : r.f.type);
      const map = new Map<string, Row[]>();
      for (const r of rows) map.set(keyOf(r), [...(map.get(keyOf(r)) ?? []), r]);
      groups = [...map.entries()]
        .sort(([a], [b]) => (sort === "type" ? TYPE_ORDER.indexOf(a as FacilityType) - TYPE_ORDER.indexOf(b as FacilityType) : a.localeCompare(b)))
        .map(([k, rs]) => {
          const atRisk = rs.reduce((n, r) => n + r.atRisk, 0);
          return {
            label: sort === "type" ? TYPE_LABEL[k as FacilityType] ?? k : `${k} block`,
            sub: `${rs.length} ${rs.length === 1 ? "facility" : "facilities"} · ${atRisk} at-risk lines`,
            rows: rs.sort(sort === "block" ? (a, b) => byType(a, b) || byRisk(a, b) : byRisk),
          };
        });
    } else {
      groups = [{ label: null, rows: [...rows].sort(sort === "risk" ? byRisk : byName) }];
    }
    const flat = groups.flatMap((g) => g.rows);
    const rowIdx = new Map(flat.map((r, i) => [r.f.id, i]));
    const colRisk = medicines.map((m) => assessments.filter((a) => a.medicineId === m.id && isAtRisk(a.risk) && (!facilityTypes || facilities.some((f) => f.id === a.facilityId))).length);
    return { medicines, groups, flat, colRisk, rowIdx };
  }, [state, assessments, sort, facilityTypes]);

  const select = useCallback(
    (fid: string, mid: string) => {
      dispatch({ type: "SELECT_FACILITY", facilityId: fid });
      dispatch({ type: "SELECT_MEDICINE", medicineId: mid });
      onSelect?.(fid, mid);
    },
    [dispatch, onSelect],
  );

  const showTip = (el: HTMLElement, r: number, c: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wb = wrap.getBoundingClientRect();
    const cb = el.getBoundingClientRect();
    setTip({ x: cb.right - wb.left, y: cb.top - wb.top - 6, w: wb.width, r, c });
  };

  const moveFocus = (e: KeyboardEvent, r: number, c: number) => {
    const dr = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const dc = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let nr = r + dr, nc = c + dc;
    if (e.key === "Home") nc = 0;
    if (e.key === "End") nc = medicines.length - 1;
    if (nr === r && nc === c) return;
    e.preventDefault();
    nr = Math.max(0, Math.min(flat.length - 1, nr));
    nc = Math.max(0, Math.min(medicines.length - 1, nc));
    setFocus({ r: nr, c: nc });
    const el = cellRefs.current.get(`${nr}-${nc}`);
    el?.focus();
  };

  if (!flat.length || !medicines.length) {
    return <EmptyState title="No stock reports yet">Facility × medicine cover appears here once pharmacists report.</EmptyState>;
  }

  const sel = { f: state.selectedFacilityId, m: state.selectedMedicineId };
  const fr = Math.min(focus.r, flat.length - 1);
  const fc = Math.min(focus.c, medicines.length - 1);
  const tipCell = tip ? flat[tip.r]?.cells[tip.c] : undefined;
  const tipFacility = tip ? flat[tip.r]?.f : undefined;
  const style = { "--n": medicines.length } as CSSProperties;

  return (
    <div ref={wrapRef} className={[s.wrap, className].filter(Boolean).join(" ")} onPointerLeave={() => { setHover(null); setTip(null); }}>
      <div className={s.toolbar}>
        <div role="group" aria-label="Sort facilities">
          <span className={s.segLabel}>Sort</span>
          <span className={s.seg}>
            {SORTS.map((o) => (
              <button key={o.id} type="button" aria-pressed={sort === o.id} onClick={() => setSort(o.id)}>
                {o.label}
              </button>
            ))}
          </span>
        </div>
        <ul className={s.legend} aria-label="Legend">
          {RISK_LEVELS.map((r) => (
            <li key={r}>
              <span className={`${s.sw}`} style={{ background: swatch(r) }} aria-hidden />
              {RISK_LABEL[r]}
            </li>
          ))}
          <li><span className={s.sw} style={{ background: "var(--surface-2)", clipPath: "polygon(0 0,100% 0,100% 100%)", boxShadow: "inset 0 0 0 8px var(--ink)" }} aria-hidden />Near expiry</li>
          <li><span className={s.sw} style={{ outline: "1.5px dashed var(--ink-2)", outlineOffset: -3, background: "var(--surface-2)" }} aria-hidden />Unverified count</li>
          <li><span className={s.sw} style={{ background: "transparent", display: "grid", placeItems: "center" }} aria-hidden><i style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)" }} /></span>Inbound transfer</li>
        </ul>
      </div>

      <div className={s.scroller}>
        <div
          className={s.grid}
          style={style}
          role="grid"
          aria-label={`Days of stock for ${flat.length} facilities and ${medicines.length} medicines. Use arrow keys to move between cells.`}
          aria-rowcount={flat.length + 1}
          aria-colcount={medicines.length + 1}
          data-hovering={hover ? "true" : undefined}
        >
          <div className={s.row} role="row">
            <div className={s.corner} role="columnheader">Facility · days of stock</div>
            {medicines.map((m, c) => (
              <button
                key={m.id}
                type="button"
                role="columnheader"
                className={s.colHead}
                data-selected={sel.m === m.id}
                data-lit={hover?.c === c}
                title={`${m.name} ${m.strength} — threshold ${m.leadTimeDays + m.safetyBufferDays} days`}
                onClick={() => dispatch({ type: "SELECT_MEDICINE", medicineId: m.id })}
              >
                <span>{m.name}</span>
                <small>{m.strength}</small>
                <span className={s.riskCount} aria-label={`${colRisk[c]} at risk`}>
                  {colRisk[c]! > 0 ? <i aria-hidden /> : null}
                  {colRisk[c]! > 0 ? `${colRisk[c]} at risk` : "clear"}
                </span>
              </button>
            ))}
          </div>

          {groups.map((g) => (
            <div key={g.label ?? "all"} role="rowgroup" style={{ display: "contents" }}>
              {g.label && (
                <div className={s.groupRow} role="row">
                  <div className={s.groupHead} role="rowheader" aria-colspan={medicines.length + 1}>
                    {g.label} <small>{g.sub}</small>
                  </div>
                </div>
              )}
              {g.rows.map((row) => {
                const r = rowIdx.get(row.f.id) ?? 0;
                return (
                  <div key={row.f.id} className={s.row} role="row">
                    <button
                      type="button"
                      role="rowheader"
                      className={s.rowHead}
                      data-selected={sel.f === row.f.id}
                      data-lit={hover?.r === r}
                      onClick={() => dispatch({ type: "SELECT_FACILITY", facilityId: row.f.id })}
                      aria-label={`${row.f.name}, ${row.f.type}, ${row.f.block} block, ${row.atRisk} at-risk medicines`}
                    >
                      <span className={s.type} data-type={row.f.type} aria-hidden>{TYPE_SHORT[row.f.type]}</span>
                      <span>
                        <b>{row.f.name}</b>
                        <small>{row.f.block}{row.atRisk ? ` · ${row.atRisk} at risk` : ""}</small>
                      </span>
                    </button>
                    {row.cells.map((cell, c) => {
                      const a = cell.a;
                      const isFocus = fr === r && fc === c;
                      const label = a
                        ? `${row.f.name}, ${cell.m.name}: ${fmtDays(a.daysOfStock)} days, ${RISK_LABEL[a.risk]}${cell.r?.nearExpiry ? ", near expiry" : ""}${cell.r && !cell.r.verified ? ", unverified" : ""}${cell.inbound.length ? ", inbound transfer" : ""}`
                        : `${row.f.name}, ${cell.m.name}: not stocked`;
                      return (
                        <button
                          key={cell.m.id}
                          ref={(el) => {
                            if (el) cellRefs.current.set(`${r}-${c}`, el);
                            else cellRefs.current.delete(`${r}-${c}`);
                          }}
                          type="button"
                          role="gridcell"
                          tabIndex={isFocus ? 0 : -1}
                          className={s.cell}
                          data-risk={a?.risk ?? "none"}
                          data-expiry={cell.r?.nearExpiry ? "true" : undefined}
                          data-unverified={cell.r && !cell.r.verified ? "true" : undefined}
                          data-lit={hover ? hover.r === r || hover.c === c : undefined}
                          data-selected={sel.f === row.f.id && sel.m === cell.m.id}
                          aria-label={label}
                          aria-disabled={!a || undefined}
                          onPointerEnter={(e) => { setHover({ r, c }); if (a) showTip(e.currentTarget, r, c); else setTip(null); }}
                          onFocus={(e) => { setFocus({ r, c }); if (a) showTip(e.currentTarget, r, c); }}
                          onBlur={() => setTip(null)}
                          onKeyDown={(e) => moveFocus(e, r, c)}
                          onClick={() => a && select(row.f.id, cell.m.id)}
                        >
                          {a ? fmtDays(a.daysOfStock) : ""}
                          {cell.inbound.length > 0 && <span className={s.inbound} aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className={s.foot}>
        <span>Cell value = days of stock (shelf ÷ daily use). Threshold = lead time + safety buffer, per medicine.</span>
        <span>Synthetic data · as of {fmtDate(state.now)}</span>
      </p>

      {tip && tipCell?.a && tipFacility && (
        <ChartTooltip
          x={tip.x}
          y={tip.y}
          containerWidth={tip.w}
          width={220}
          title={`${tipFacility.name} · ${tipCell.m.name} ${tipCell.m.strength}`}
          rows={tipRows(tipCell, state.now)}
          note={tipNote(tipCell, state)}
        />
      )}
    </div>
  );
}

function swatch(r: (typeof RISK_LEVELS)[number]) {
  if (r === "stockout" || r === "critical") return RISK_VAR[r];
  if (r === "low") return "color-mix(in oklab, var(--risk-low) 62%, var(--surface))";
  if (r === "ok") return "color-mix(in oklab, var(--risk-ok) 17%, var(--surface))";
  return "color-mix(in oklab, var(--risk-surplus) 26%, var(--surface))";
}

function tipRows({ a, r, m }: Cell, now: string): TipRow[] {
  if (!a) return [];
  const rows: TipRow[] = [
    { label: RISK_LABEL[a.risk], value: `${fmtDays(a.daysOfStock)} d`, color: RISK_VAR[a.risk], kind: "dot" },
    { label: `On shelf (${m.unit})`, value: fmtInt(r?.stock ?? 0) },
    { label: "Daily use", value: r ? (r.dailyUse < 10 ? r.dailyUse.toFixed(1) : fmtInt(r.dailyUse)) : "—" },
    { label: "Threshold", value: `${a.thresholdDays} d` },
  ];
  if (a.projectedStockoutDate && a.risk !== "surplus" && a.risk !== "ok") rows.push({ label: "Projected out", value: fmtDate(a.projectedStockoutDate) });
  if (a.gapUnits > 0) rows.push({ label: "Gap to threshold", value: fmtInt(a.gapUnits) });
  if (a.transferable > 0) rows.push({ label: "Safe surplus", value: fmtInt(a.transferable), color: "var(--risk-surplus)", kind: "dot" });
  if (r?.nearExpiry) rows.push({ label: `Expiring ${fmtDate(r.nearExpiry.expiresOn)}`, value: fmtInt(r.nearExpiry.quantity) });
  if (r) rows.push({ label: `${r.reportSource === "voice" ? "Voice report" : r.reportSource === "manual" ? "Manual entry" : "System"}${r.verified ? "" : " · unverified"}`, value: fmtAgo(r.lastReportAt, now) });
  return rows;
}

function tipNote(cell: Cell, state: { facilities: Facility[] }) {
  if (!cell.inbound.length) return undefined;
  const qty = cell.inbound.reduce((n, t) => n + t.quantity, 0);
  const from = cell.inbound.map((t) => state.facilities.find((f) => f.id === t.fromId)?.name ?? t.fromId).join(", ");
  return `Inbound +${fmtInt(qty)} from ${from}`;
}
