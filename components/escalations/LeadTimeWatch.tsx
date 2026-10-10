"use client";
// OWNER: escalations agent. Expected vs observed resupply lead times, and the state consignment clock.
import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import type { DistrictState } from "@/lib/district/types";
import type { LeadTimeWatch as Watch } from "@/lib/escalations/leadtime";
import { fmtDate } from "@/components/shell/format";
import s from "./escalations.module.css";

const FLAG = {
  late: { icon: CircleAlert, label: "Late" },
  slipping: { icon: Clock, label: "Slipping" },
  on_time: { icon: CircleCheck, label: "On time" },
} as const;

const d = (iso: string) => fmtDate(`${iso}T12:00:00+05:30`);

/** Observed lead time is only known to the ledger week, so it is shown as a range. */
function leadRange(days: number) {
  const lo = Math.max(0, days - 3.5);
  return `${lo}–${days + 3.5} d`;
}

function ConsignmentClock({ w }: { w: Watch }) {
  const since = w.warehouse.daysSinceLastReceipt;
  if (since === null) return <span className="muted">No receipt on record</span>;
  const cycle = w.warehouse.cycleDays;
  const max = Math.max(cycle * 1.6, since + 4);
  const pct = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  const within = Math.min(since, cycle);
  const over = Math.max(0, since - cycle);
  return (
    <div className={s.clock} title={`${Math.round(since)} days since last consignment; cycle ${Math.round(cycle)} days${w.warehouse.cycleSource === "assumed" ? " (assumed)" : ""}`}>
      <div className={s.clockTrack} aria-hidden>
        <span className={s.clockFill} style={{ width: pct(within) }} />
        {over > 0 ? <span className={s.clockOver} style={{ left: pct(within), width: pct(over) }} /> : null}
        <span className={s.clockTick} style={{ left: `calc(${pct(cycle)} - 1px)` }} />
      </div>
      <span className="num" style={{ fontSize: 12 }}>
        {Math.round(since)} <span className="muted">/ {Math.round(cycle)} d</span>
      </span>
    </div>
  );
}

export function LeadTimeWatch({ state, watches, selected, onSelect }: { state: DistrictState; watches: Watch[]; selected: string | null; onSelect: (id: string) => void }) {
  const med = new Map(state.medicines.map((m) => [m.id, m]));
  const order = { late: 0, slipping: 1, on_time: 2 };
  const rows = [...watches].sort((a, b) => order[a.flag] - order[b.flag]);
  return (
    <>
      <div className={s.boardWrap}>
        <table className={s.ltTable} aria-label="Lead-time watch">
          <thead>
            <tr>
              <th scope="col">Medicine</th>
              <th scope="col" className={s.r}>Planned lead</th>
              <th scope="col" className={s.r}>Observed, warehouse to facility</th>
              <th scope="col" className={s.r}>Late deliveries</th>
              <th scope="col">State consignment clock</th>
              <th scope="col">Next consignment</th>
              <th scope="col">Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const m = med.get(w.medicineId);
              const F = FLAG[w.flag];
              return (
                <tr key={w.medicineId} data-selected={selected === w.medicineId}>
                  <td>
                    <button type="button" className={s.rowBtn} onClick={() => onSelect(w.medicineId)}>
                      <span className={s.medName}>{m ? `${m.name} ${m.strength}` : w.medicineId}</span>
                    </button>
                  </td>
                  <td className={`${s.r} num`}>{w.expectedLeadDays} d</td>
                  <td className={`${s.r} num`}>
                    {w.observedLeadDays === null ? <span className="muted">planned value used</span> : leadRange(w.observedLeadDays)}
                    <span className={s.sub}>{w.observations.length} reorder-triggered {w.observations.length === 1 ? "delivery" : "deliveries"}</span>
                  </td>
                  <td className={`${s.r} num`}>{w.observations.length ? `${w.lateDeliveries} of ${w.observations.length}` : "—"}</td>
                  <td><ConsignmentClock w={w} /></td>
                  <td className="num" style={{ fontSize: 12 }}>
                    {w.warehouse.expectedNextOn ? d(w.warehouse.expectedNextOn) : "No date"}
                    <span className={s.sub}>{m?.upstream?.expectedOn ? "state confirmed" : w.warehouse.lastReceiptWeekOf ? "from cycle" : ""}</span>
                  </td>
                  <td>
                    <span className={s.flag} data-flag={w.flag} title={w.note}><F.icon aria-hidden strokeWidth={2.2} />{F.label}</span>
                    <span className={s.sub} style={{ whiteSpace: "normal", maxWidth: 260 }}>{w.note}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={s.method}>
        Observed lead time is the gap between the ledger week a facility first fell below lead time + buffer and the week its delivery was recorded, so it is accurate to about half a week.
        Routine deliveries that arrived before the reorder point are not counted. The consignment clock compares days since the warehouse last received stock with its usual cycle (dark tick); red is time past the cycle.
      </p>
    </>
  );
}
