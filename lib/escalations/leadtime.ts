// OWNER: escalations agent. Lead-time watch: expected vs observed resupply lead time, derived from weekly ledgers.
// Weekly history only tells us which week a receipt landed in, so every observed lead time carries a ±3.5-day error.
import { istMidnightMs, thresholdDays } from "../district/engine";
import type { DistrictState, Medicine, StockRecord } from "../district/types";

const DAY = 864e5;
const HALF_WEEK = 3.5;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Assumed state → warehouse consignment cycle when history holds fewer than two receipts. */
export const DEFAULT_CONSIGNMENT_CYCLE_DAYS = 28;
/** Fewer than this many observed facility deliveries and the configured lead time is used instead. */
export const MIN_OBSERVATIONS = 3;

export type DeliveryObservation = {
  facilityId: string;
  weekOf: string; // week the receipt was recorded
  triggerWeekOf: string; // first week closing stock fell below lead time + buffer
  leadDays: number; // estimated, ±3.5 days
  units: number;
  late: boolean;
};

export type LeadTimeWatch = {
  medicineId: string;
  expectedLeadDays: number; // medicine.leadTimeDays
  observedLeadDays: number | null; // median of observations, null when too few
  source: "history" | "configured";
  observations: DeliveryObservation[];
  lateDeliveries: number;
  lateShare: number | null;
  /** State → warehouse consignments. */
  warehouse: {
    receipts: { weekOf: string; units: number }[];
    cycleDays: number;
    cycleSource: "history" | "assumed";
    lastReceiptWeekOf: string | null;
    daysSinceLastReceipt: number | null;
    expectedNextOn: string | null; // last receipt + cycle (or upstream.expectedOn when given)
    overdueDays: number; // 0 when on time
  };
  flag: "late" | "slipping" | "on_time";
  note: string;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Reorder-triggered deliveries in one facility ledger: receipt week minus the week stock first fell below threshold. */
export function observeDeliveries(record: StockRecord, medicine: Medicine): DeliveryObservation[] {
  const h = record.history;
  const threshold = thresholdDays(medicine);
  const out: DeliveryObservation[] = [];
  let lastReceipt = -1;
  for (let i = 1; i < h.length; i++) {
    const units = h[i].received ?? 0;
    if (units <= 0) continue;
    let trigger = -1;
    for (let j = Math.max(0, lastReceipt); j < i; j++) {
      const use = h[j].dispensed > 0 ? h[j].dispensed / 7 : record.dailyUse;
      if (use > 0 && h[j].closingStock / use < threshold) { trigger = j; break; }
    }
    lastReceipt = i;
    if (trigger < 0) continue; // routine delivery that arrived before the reorder point: not a lead-time sample
    const leadDays = (i - trigger) * 7 - HALF_WEEK;
    out.push({ facilityId: record.facilityId, weekOf: h[i].weekOf, triggerWeekOf: h[trigger].weekOf, leadDays, units, late: leadDays > medicine.leadTimeDays + HALF_WEEK });
  }
  return out;
}

export function computeLeadTimeWatch(state: DistrictState, medicineId: string): LeadTimeWatch | null {
  const medicine = state.medicines.find((m) => m.id === medicineId);
  if (!medicine) return null;
  const types = new Map(state.facilities.map((f) => [f.id, f.type]));
  const records = state.stock.filter((r) => r.medicineId === medicineId);
  const observations = records.filter((r) => types.get(r.facilityId) !== "WAREHOUSE").flatMap((r) => observeDeliveries(r, medicine));
  const enough = observations.length >= MIN_OBSERVATIONS;
  const observed = enough ? median(observations.map((o) => o.leadDays)) : null;
  const lateDeliveries = observations.filter((o) => o.late).length;

  const now = new Date(state.now).getTime();
  const wh = records.find((r) => types.get(r.facilityId) === "WAREHOUSE");
  const receipts = (wh?.history ?? []).filter((p) => (p.received ?? 0) > 0).map((p) => ({ weekOf: p.weekOf, units: p.received ?? 0 }));
  const gaps = receipts.slice(1).map((r, i) => (istMidnightMs(r.weekOf) - istMidnightMs(receipts[i].weekOf)) / DAY);
  const cycle = median(gaps);
  const cycleDays = cycle ?? DEFAULT_CONSIGNMENT_CYCLE_DAYS;
  const last = receipts[receipts.length - 1];
  // A receipt is dated to the middle of its ledger week.
  const lastMs = last ? istMidnightMs(last.weekOf) + HALF_WEEK * DAY : null;
  const daysSinceLastReceipt = lastMs === null ? null : round1(Math.max(0, (now - lastMs) / DAY));
  const upstreamOn = medicine.upstream?.expectedOn ?? null;
  const expectedNextMs = upstreamOn ? istMidnightMs(upstreamOn) : lastMs === null ? null : lastMs + cycleDays * DAY;
  const cycleDueMs = lastMs === null ? null : lastMs + cycleDays * DAY;
  const overdueDays = cycleDueMs === null ? 0 : round1(Math.max(0, (now - cycleDueMs) / DAY));

  const upstream = medicine.upstream?.status ?? "available";
  const facilityLate = observed !== null && observed > medicine.leadTimeDays + HALF_WEEK;
  const flag: LeadTimeWatch["flag"] = overdueDays > HALF_WEEK || upstream !== "available" ? "late" : facilityLate ? "slipping" : "on_time";
  const note = flag === "late"
    ? overdueDays > HALF_WEEK
      ? `State consignment ${Math.round(overdueDays)} days past its ${Math.round(cycleDays)}-day cycle${upstreamOn ? "" : "; no revised date"}.`
      : `State supply ${upstream}${upstreamOn ? `; next consignment expected ${upstreamOn}` : "; no confirmed date"}.`
    : flag === "slipping"
      ? `Facility resupply taking about ${Math.round(observed!)} days against ${medicine.leadTimeDays} planned.`
      : "Deliveries arriving within the planned lead time.";

  return {
    medicineId, expectedLeadDays: medicine.leadTimeDays, observedLeadDays: observed === null ? null : round1(observed),
    source: enough ? "history" : "configured", observations, lateDeliveries, lateShare: observations.length ? lateDeliveries / observations.length : null,
    warehouse: {
      receipts, cycleDays, cycleSource: cycle === null ? "assumed" : "history", lastReceiptWeekOf: last?.weekOf ?? null, daysSinceLastReceipt,
      expectedNextOn: expectedNextMs === null ? null : new Date(expectedNextMs + 5.5 * 36e5).toISOString().slice(0, 10), overdueDays,
    },
    flag, note,
  };
}

export function computeLeadTimeWatches(state: DistrictState): LeadTimeWatch[] {
  return state.medicines.map((m) => computeLeadTimeWatch(state, m.id)).filter((w): w is LeadTimeWatch => w !== null);
}
