"use client";
// OWNER: escalations agent. Medicine-level supply-gap board.
import { ArrowLeftRight, CircleCheck, CircleSlash, Eye, FileText, OctagonAlert, Check, type LucideIcon } from "lucide-react";
import type { GapStatus, SupplyGap } from "@/lib/escalations/gap";
import { GAP_STATUS_LABEL } from "@/lib/escalations/gap";
import { STAGE_LABEL, type Escalation } from "@/lib/escalations/lifecycle";
import { fmtUnits } from "@/lib/escalations/memo";
import { fmtDate } from "@/components/shell/format";
import s from "./escalations.module.css";

export const STATUS_ICON: Record<GapStatus, LucideIcon> = {
  escalate: OctagonAlert,
  watch: Eye,
  indent: FileText,
  local: ArrowLeftRight,
  clear: Check,
};

export function StatusLabel({ status }: { status: GapStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={s.status} data-status={status}>
      <Icon aria-hidden strokeWidth={2.2} />
      {GAP_STATUS_LABEL[status]}
    </span>
  );
}

export function StagePill({ esc }: { esc: Escalation }) {
  return <span className={s.stagePill} data-stage={esc.stage}><i aria-hidden />{STAGE_LABEL[esc.stage]}</span>;
}

const fmtD = (d: number | null) => (d === null ? "—" : d < 20 ? d.toFixed(1) : String(Math.round(d)));

/** Facility cover (solid) plus warehouse cover (light), against the lead time + buffer tick. */
export function CoverageBar({ gap }: { gap: SupplyGap }) {
  const site = gap.siteCoverageDays ?? 0;
  const wh = gap.warehouseCoverageDays ?? 0;
  const max = Math.max(gap.thresholdDays * 2.5, 10);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const under = site < gap.thresholdDays;
  return (
    <div className={s.cov} title={`Facilities ${fmtD(gap.siteCoverageDays)} days + warehouse ${fmtD(gap.warehouseCoverageDays)} days, against ${gap.thresholdDays} days required`}>
      <div className={s.covTrack} aria-hidden>
        <span className={s.covSite} data-under={under} style={{ width: pct(site) }} />
        {wh > 0 && site < max ? <span className={s.covWh} style={{ left: pct(site), width: `calc(${pct(Math.min(wh, max - site))})` }} /> : null}
        <span className={s.covTick} style={{ left: `calc(${pct(gap.thresholdDays)} - 1px)` }} />
      </div>
      <span className={`${s.covText} num`}>
        <b>{fmtD(gap.siteCoverageDays)}</b>
        <span className="muted"> / {gap.thresholdDays} d</span>
      </span>
    </div>
  );
}

export function GapBoard({ gaps, selected, onSelect, escalationFor, decisionsFor }: {
  gaps: SupplyGap[];
  selected: string | null;
  onSelect: (medicineId: string) => void;
  escalationFor: (medicineId: string) => Escalation | undefined;
  decisionsFor: (medicineId: string) => number;
}) {
  return (
    <>
      <div className={s.boardWrap}>
        <table className={s.board} aria-label="Supply gap by medicine">
          <thead>
            <tr>
              <th scope="col">Medicine</th>
              <th scope="col">Status</th>
              <th scope="col">District cover, days</th>
              <th scope="col" className={s.r}>Need · safe surplus</th>
              <th scope="col" className={s.r}>Short</th>
              <th scope="col" className={s.r}>Facilities</th>
              <th scope="col" className={s.r}>District stockout</th>
              <th scope="col">Escalation</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => {
              const esc = escalationFor(g.medicineId);
              const dec = decisionsFor(g.medicineId);
              const isSel = selected === g.medicineId;
              return (
                <tr key={g.medicineId} aria-selected={isSel} onClick={() => onSelect(g.medicineId)}>
                  <td>
                    <button type="button" className={s.rowBtn} onClick={(e) => { e.stopPropagation(); onSelect(g.medicineId); }} aria-pressed={isSel}>
                      <span className={s.medName}>{g.medicine.name} {g.medicine.strength}</span>
                      <span className={s.medUnit}>{g.medicine.unit} · {g.totalDailyUse}/day</span>
                    </button>
                  </td>
                  <td><StatusLabel status={g.status} /></td>
                  <td><CoverageBar gap={g} /></td>
                  <td className={`${s.r} num`}>
                    {g.needUnits ? fmtUnits(g.needUnits) : <span className={s.zero}>0</span>}
                    <span className="muted"> · {fmtUnits(g.transferableUnits)}</span>
                    {g.needUnits > 0 ? (
                      <span className={`${s.verdict} ${s.sub}`} data-ok={g.redistributionCloses}>
                        {g.redistributionCloses ? <CircleCheck aria-hidden /> : <CircleSlash aria-hidden />}
                        {g.redistributionCloses ? "Surplus covers it" : "Surplus cannot cover"}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${s.r} num`}>
                    {g.gapUnits > 0 ? <span className={s.short}>{fmtUnits(g.gapUnits)}</span> : <span className={s.zero}>0</span>}
                  </td>
                  <td className={`${s.r} num`}>
                    {g.affected.length ? g.affected.length : <span className={s.zero}>0</span>}
                    {g.affected.length ? <span className={s.sub}>{fmtUnits(g.affectedPopulation)} people{g.stockedOut ? ` · ${g.stockedOut} out` : ""}</span> : null}
                  </td>
                  <td className={`${s.r} num`}>
                    {g.districtStockoutDate ? (
                      <>
                        {fmtD(g.daysToDistrictStockout)} d
                        <span className={s.sub}>{fmtDate(`${g.districtStockoutDate}T12:00:00+05:30`)}</span>
                      </>
                    ) : "—"}
                  </td>
                  <td>
                    {esc ? <StagePill esc={esc} /> : g.status === "escalate" ? <span className={s.status} data-status="escalate">Not raised</span> : <span className={s.zero}>—</span>}
                    {dec ? <span className={s.sub}>{dec} AI {dec === 1 ? "recommendation" : "recommendations"}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={s.legend} aria-hidden>
        <span><i className={s.key} style={{ background: "var(--ink-2)" }} />Facility shelves</span>
        <span><i className={s.key} style={{ background: "var(--risk-critical)" }} />Facility shelves below required cover</span>
        <span><i className={s.key} style={{ background: "var(--line-strong)" }} />District warehouse</span>
        <span><i className={s.keyTick} />Lead time + buffer</span>
      </div>
    </>
  );
}
