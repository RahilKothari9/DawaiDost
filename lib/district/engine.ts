// OWNER: data agent. Pure, deterministic stock math. Signatures are the shared contract; bodies may be improved.
import type {
  AnomalyCheck, DecisionRecord, DistrictKpis, DistrictState, DonorCandidate, Facility, Medicine, RiskLevel, StockAssessment, StockRecord, Transfer,
} from "./types";

const HOUR = 36e5;
const DAY = 864e5;
const IST_OFFSET = 5.5 * HOUR;

export const ROAD_FACTOR = 1.3; // road km per straight-line km
export const TRUCK_KMPH = 30;
export const HANDLING_HOURS = 1; // loading + receiving
export const DISPATCH_DELAY_HOURS = 2; // approved -> in_transit
export const MAX_TRANSFER_KM = 80;
export const RISK_ORDER: Record<RiskLevel, number> = { stockout: 0, critical: 1, low: 2, ok: 3, surplus: 4 };
export const AT_RISK: RiskLevel[] = ["stockout", "critical", "low"];
export const OPEN_TRANSFER_STATUSES: Transfer["status"][] = ["proposed", "approved", "in_transit"];
export const DECISION_POLICY = "Recommend one next action. A district officer approves every transfer, indent, or escalation.";

const round1 = (n: number) => Math.round(n * 10) / 10;
const finiteOrNull = (n: number) => (Number.isFinite(n) ? round1(n) : null);
const ms = (iso: string) => new Date(iso).getTime();

export function haversineKm(a: Pick<Facility, "lat" | "lng">, b: Pick<Facility, "lat" | "lng">): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Road-time estimate: straight-line km × road factor at ~30 km/h plus handling. */
export function transferEtaHours(distanceKm: number): number {
  return round1((distanceKm * ROAD_FACTOR) / TRUCK_KMPH + HANDLING_HOURS);
}

/** ISO date (YYYY-MM-DD) of the IST Monday that starts the week containing `iso`. */
export function weekStart(iso: string): string {
  const ist = new Date(ms(iso) + IST_OFFSET);
  const dow = (ist.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - dow * DAY).toISOString().slice(0, 10);
}

/** Epoch ms of IST midnight at the start of an ISO date. */
export function istMidnightMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`) - IST_OFFSET;
}

export function thresholdDays(medicine: Medicine): number {
  return medicine.leadTimeDays + medicine.safetyBufferDays;
}

export function reserveUnits(record: StockRecord, medicine: Medicine): number {
  return record.dailyUse * medicine.reserveDays;
}

export function assessStock(record: StockRecord, medicine: Medicine, now: string): StockAssessment {
  const days = record.dailyUse <= 0 ? Infinity : record.stock / record.dailyUse;
  const threshold = thresholdDays(medicine);
  const transferable = Math.max(0, Math.floor(record.stock - reserveUnits(record, medicine)));
  const risk: RiskLevel = record.stock <= 0 && record.dailyUse > 0 ? "stockout"
    : days < medicine.leadTimeDays ? "critical"
    : days < threshold ? "low"
    : days >= threshold + medicine.reserveDays && transferable > 0 ? "surplus"
    : "ok";
  const out = Number.isFinite(days) ? new Date(ms(now) + days * DAY + IST_OFFSET).toISOString().slice(0, 10) : null;
  return {
    facilityId: record.facilityId, medicineId: record.medicineId, daysOfStock: days, thresholdDays: threshold, risk,
    projectedStockoutDate: out, transferable, gapUnits: Math.max(0, Math.ceil(threshold * record.dailyUse - record.stock)),
  };
}

export function assessDistrict(state: DistrictState): StockAssessment[] {
  const meds = new Map(state.medicines.map((m) => [m.id, m]));
  return state.stock.flatMap((r) => {
    const m = meds.get(r.medicineId);
    return m ? [assessStock(r, m, state.now)] : [];
  });
}

/** Average daily dispensing over the most recent `weeks` complete-ish history points. */
export function recentDailyUse(record: StockRecord, weeks = 4): number {
  const pts = record.history.slice(-weeks);
  if (!pts.length) return record.dailyUse;
  return pts.reduce((s, p) => s + p.dispensed, 0) / (pts.length * 7);
}

/**
 * Checks the latest reported count against last week's closing + receipts − expected use since the week began.
 * Returns flagged=false when there is no report in the current history week.
 */
export function detectAnomaly(record: StockRecord, now?: string): AnomalyCheck {
  const reported = record.stock;
  const ok = (expected: number | null, deviation = 0, tolerance = 0): AnomalyCheck => ({ flagged: false, kind: null, expected, reported, deviation, tolerance, reason: "Count consistent with recent history." });
  const h = record.history;
  if (now && ms(now) - ms(record.lastReportAt) > 8 * DAY) {
    return { ...ok(null), flagged: true, kind: "stale_report", reason: `No report for ${Math.floor((ms(now) - ms(record.lastReportAt)) / DAY)} days.` };
  }
  if (h.length < 2) return ok(null);
  const last = h[h.length - 1], prev = h[h.length - 2];
  const weekStartMs = istMidnightMs(last.weekOf);
  if (ms(record.lastReportAt) < weekStartMs) return ok(null);
  const elapsedDays = Math.min(7, Math.max(0, (ms(record.lastReportAt) - weekStartMs) / DAY));
  const expected = Math.max(0, prev.closingStock + (last.received ?? 0) - record.dailyUse * elapsedDays);
  const counted = last.closingStock;
  const deviation = round1(counted - expected);
  const tolerance = round1(Math.max(3, record.dailyUse * 3.5, expected * 0.25));
  if (deviation > tolerance) {
    return { flagged: true, kind: "unexplained_increase", expected: round1(expected), reported: counted, deviation, tolerance, reason: `Reported ${counted} but ledger expects about ${Math.round(expected)} (last week ${prev.closingStock}, received ${last.received ?? 0} this week). Increase not explained by any delivery.` };
  }
  if (deviation < -tolerance * 1.5) {
    return { flagged: true, kind: "unexplained_drop", expected: round1(expected), reported: counted, deviation, tolerance, reason: `Reported ${counted} but ledger expects about ${Math.round(expected)}. Drop is larger than normal dispensing; possible miscount or leakage.` };
  }
  return ok(round1(expected), deviation, tolerance);
}

export function openTransfers(state: DistrictState, medicineId?: string): Transfer[] {
  return state.transfers.filter((t) => OPEN_TRANSFER_STATUSES.includes(t.status) && (!medicineId || t.medicineId === medicineId));
}

export function inboundUnits(state: DistrictState, facilityId: string, medicineId: string): number {
  return openTransfers(state, medicineId).filter((t) => t.toId === facilityId).reduce((s, t) => s + t.quantity, 0);
}

export function outboundUnits(state: DistrictState, facilityId: string, medicineId: string): number {
  return openTransfers(state, medicineId).filter((t) => t.fromId === facilityId).reduce((s, t) => s + t.quantity, 0);
}

/** Units of near-expiry stock that will expire before the facility can dispense them (FEFO). */
export function wouldExpireUnused(record: StockRecord, now: string): number {
  if (!record.nearExpiry) return 0;
  const daysLeft = Math.max(0, (istMidnightMs(record.nearExpiry.expiresOn) - ms(now)) / DAY);
  return Math.max(0, Math.floor(Math.min(record.nearExpiry.quantity, record.stock) - record.dailyUse * daysLeft));
}

/** Every potential donor for a facility + medicine, ranked (eligible first, near-expiry preferred, then nearest). */
export function donorCandidates(state: DistrictState, facilityId: string, medicineId: string, maxKm = MAX_TRANSFER_KM): DonorCandidate[] {
  const target = state.facilities.find((f) => f.id === facilityId);
  const medicine = state.medicines.find((m) => m.id === medicineId);
  if (!target || !medicine) return [];
  const facilities = new Map(state.facilities.map((f) => [f.id, f]));
  return state.stock
    .filter((r) => r.medicineId === medicineId && r.facilityId !== facilityId)
    .flatMap((r) => {
      const f = facilities.get(r.facilityId);
      if (!f || f.type === "WAREHOUSE") return [];
      const distanceKm = round1(haversineKm(target, f));
      if (distanceKm > maxKm) return [];
      const a = assessStock(r, medicine, state.now);
      const transferable = Math.max(0, a.transferable - outboundUnits(state, f.id, medicineId));
      const anomaly = detectAnomaly(r).flagged;
      const expiring = wouldExpireUnused(r, state.now);
      const c: DonorCandidate = {
        facilityId: f.id, name: f.name, distanceKm, stock: r.stock, dailyUse: r.dailyUse, daysOfStock: finiteOrNull(a.daysOfStock), transferable,
        nearExpiry: r.nearExpiry ? { ...r.nearExpiry, wouldExpireUnused: expiring } : null,
        verified: r.verified, anomaly, eligible: a.risk === "surplus" && r.verified && !anomaly && !r.recountRequested && transferable > 0,
      };
      return [c];
    })
    .sort((x, y) => Number(y.eligible) - Number(x.eligible) || donorScore(x) - donorScore(y));
}

/** Effective distance: donors holding stock that would otherwise expire count as half as far. */
const donorScore = (c: DonorCandidate) => c.distanceKm * ((c.nearExpiry?.wouldExpireUnused ?? 0) > 0 ? 0.5 : 1);

export type PlanOptions = { maxDistanceKm?: number; recipientIds?: string[] };

/**
 * Greedy, reserve-preserving transfer proposals for one medicine (status "proposed").
 * Pass 1 bridges each at-risk facility to its resupply lead time (most urgent first); pass 2 tops up to lead time + buffer.
 * Donors: verified, non-anomalous surplus sites, never drawn below reserveDays of their own use (net of open outbound transfers).
 */
export function planTransfers(state: DistrictState, medicineId: string, opts: PlanOptions = {}): Transfer[] {
  const medicine = state.medicines.find((m) => m.id === medicineId);
  if (!medicine) return [];
  const facilities = new Map(state.facilities.map((f) => [f.id, f]));
  const records = state.stock.filter((r) => r.medicineId === medicineId);
  const recipients = records
    .filter((r) => facilities.get(r.facilityId)?.type !== "WAREHOUSE" && r.dailyUse > 0 && !r.recountRequested && !detectAnomaly(r).flagged)
    .filter((r) => !opts.recipientIds || opts.recipientIds.includes(r.facilityId))
    .map((r) => ({ r, a: assessStock(r, medicine, state.now), inbound: inboundUnits(state, r.facilityId, medicineId) }))
    .filter(({ a }) => AT_RISK.includes(a.risk))
    .sort((x, y) => x.a.daysOfStock - y.a.daysOfStock || y.r.dailyUse - x.r.dailyUse);
  const remaining = new Map<string, number>();
  const alloc = new Map<string, { fromId: string; toId: string; quantity: number; distanceKm: number; nearExpiry: boolean }>();
  const given = new Map<string, number>();
  for (const days of [medicine.leadTimeDays, thresholdDays(medicine)]) {
    for (const { r, inbound } of recipients) {
      let need = Math.ceil(days * r.dailyUse - r.stock - inbound - (given.get(r.facilityId) ?? 0));
      if (need <= 0) continue;
      for (const d of donorCandidates(state, r.facilityId, medicineId, opts.maxDistanceKm ?? MAX_TRANSFER_KM)) {
        if (!d.eligible || need <= 0) continue;
        const left = remaining.get(d.facilityId) ?? d.transferable;
        const qty = Math.min(need, left);
        if (qty <= 0) continue;
        remaining.set(d.facilityId, left - qty);
        need -= qty;
        given.set(r.facilityId, (given.get(r.facilityId) ?? 0) + qty);
        const key = `${d.facilityId}>${r.facilityId}`;
        const cur = alloc.get(key);
        alloc.set(key, { fromId: d.facilityId, toId: r.facilityId, quantity: (cur?.quantity ?? 0) + qty, distanceKm: d.distanceKm, nearExpiry: (d.nearExpiry?.wouldExpireUnused ?? 0) > 0 });
      }
    }
  }
  const stamp = ms(state.now).toString(36);
  return [...alloc.values()].map((x) => {
    const from = facilities.get(x.fromId)!, to = facilities.get(x.toId)!;
    return {
      id: `tr-${medicineId}-${x.fromId}-${x.toId}-${stamp}`, medicineId, fromId: x.fromId, toId: x.toId, quantity: x.quantity, status: "proposed",
      distanceKm: x.distanceKm, etaHours: transferEtaHours(x.distanceKm), createdAt: state.now, updatedAt: state.now,
      reason: `${to.name} below ${medicine.leadTimeDays}-day lead time; ${from.name} keeps a ${medicine.reserveDays}-day reserve${x.nearExpiry ? " and moves near-expiry stock" : ""}.`,
    } satisfies Transfer;
  });
}

/** Plans for every medicine. */
export function planAllTransfers(state: DistrictState, opts: PlanOptions = {}): Transfer[] {
  return state.medicines.flatMap((m) => planTransfers(state, m.id, opts));
}

/** Daily projected stock for the next `days` days at the recent weekly-average consumption rate, adding scheduled inbound units. */
export function forecastSeries(record: StockRecord, days: number, now: string, inbound: { at: string; quantity: number }[] = []): { date: string; stock: number; inbound?: number }[] {
  const rate = record.history.length >= 2 ? recentDailyUse(record) : record.dailyUse;
  const start = ms(now);
  let stock = record.stock;
  return Array.from({ length: days + 1 }, (_, i) => {
    const t = start + i * DAY;
    const arriving = inbound.filter((x) => { const a = ms(x.at); return i === 0 ? a <= t : a > t - DAY && a <= t; }).reduce((s, x) => s + x.quantity, 0);
    if (i > 0) stock = Math.max(0, stock - rate);
    stock += arriving;
    return { date: new Date(t + IST_OFFSET).toISOString().slice(0, 10), stock: round1(stock), ...(arriving ? { inbound: arriving } : {}) };
  });
}

/** Expected arrival time of an open transfer. */
export function transferArrivalAt(t: Transfer): string {
  const dispatch = t.dispatchedAt ? ms(t.dispatchedAt) : ms(t.approvedAt ?? t.updatedAt) + DISPATCH_DELAY_HOURS * HOUR;
  return new Date(dispatch + t.etaHours * HOUR).toISOString();
}

/** Consumption-based indent: one month of use plus lead time and buffer, minus stock and inbound. */
export function indentQuantity(record: StockRecord, medicine: Medicine, inbound = 0): number {
  return Math.max(0, Math.ceil(record.dailyUse * (30 + thresholdDays(medicine)) - record.stock - inbound));
}

export function medicineLabel(m: Medicine): string {
  return `${m.name} ${m.strength}`;
}

/** District-wide totals for one medicine. Warehouse is reported separately. */
export function districtTotals(state: DistrictState, medicineId: string) {
  const medicine = state.medicines.find((m) => m.id === medicineId);
  const types = new Map(state.facilities.map((f) => [f.id, f.type]));
  const recs = state.stock.filter((r) => r.medicineId === medicineId);
  const sites = recs.filter((r) => types.get(r.facilityId) !== "WAREHOUSE");
  const wh = recs.find((r) => types.get(r.facilityId) === "WAREHOUSE");
  const as = medicine ? sites.map((r) => assessStock(r, medicine, state.now)) : [];
  const totalStock = sites.reduce((s, r) => s + r.stock, 0);
  const totalDailyUse = round1(sites.reduce((s, r) => s + r.dailyUse, 0));
  return {
    facilities: sites.length,
    totalStock,
    totalDailyUse,
    coverageDays: totalDailyUse > 0 ? round1(totalStock / totalDailyUse) : null,
    warehouseStock: wh?.stock ?? 0,
    warehouseCoverageDays: wh && totalDailyUse > 0 ? round1(wh.stock / totalDailyUse) : null,
    combinedCoverageDays: totalDailyUse > 0 ? round1((totalStock + (wh?.stock ?? 0)) / totalDailyUse) : null,
    facilitiesAtRisk: as.filter((a) => AT_RISK.includes(a.risk)).length,
    stockouts: as.filter((a) => a.risk === "stockout").length,
    surplusFacilities: as.filter((a) => a.risk === "surplus").length,
    totalTransferable: as.filter((a) => a.risk === "surplus").reduce((s, a) => s + a.transferable, 0),
    unitsInTransit: state.transfers.filter((t) => t.medicineId === medicineId && t.status === "in_transit").reduce((s, t) => s + t.quantity, 0),
  };
}

/** Facts-only snapshot for the Decisions API about one facility + medicine. All values computed here, none by a model. */
export function buildDistrictSnapshot(state: DistrictState, facilityId: string, medicineId: string): Record<string, unknown> {
  const facility = state.facilities.find((f) => f.id === facilityId);
  const medicine = state.medicines.find((m) => m.id === medicineId);
  const record = state.stock.find((r) => r.facilityId === facilityId && r.medicineId === medicineId);
  if (!facility || !medicine || !record) return { facilityId, medicineId, error: "unknown facility or medicine" };
  const a = assessStock(record, medicine, state.now);
  const anomaly = detectAnomaly(record, state.now);
  const inbound = inboundUnits(state, facilityId, medicineId);
  const donors = donorCandidates(state, facilityId, medicineId);
  const eligible = donors.filter((d) => d.eligible);
  const leadGap = Math.max(0, Math.ceil(medicine.leadTimeDays * record.dailyUse - record.stock - inbound));
  const thresholdGap = Math.max(0, Math.ceil(a.thresholdDays * record.dailyUse - record.stock - inbound));
  const localTransferable = eligible.reduce((s, d) => s + d.transferable, 0);
  const totals = districtTotals(state, medicineId);
  const names = new Map(state.facilities.map((f) => [f.id, f.name]));
  return {
    dataNotice: "Synthetic demo data for a fictional district network.",
    asOf: state.now,
    district: `${state.district.name}, ${state.district.state}`,
    medicine: {
      id: medicine.id, name: medicineLabel(medicine), unit: medicine.unit, leadTimeDays: medicine.leadTimeDays, safetyBufferDays: medicine.safetyBufferDays,
      reserveDays: medicine.reserveDays, thresholdDays: a.thresholdDays,
      upstreamSupply: medicine.upstream ?? { status: "available", note: "No upstream issue recorded.", expectedOn: null },
    },
    target: {
      facilityId, name: facility.name, type: facility.type, block: facility.block,
      stock: record.stock, dailyUse: record.dailyUse, recentWeeklyDispensed: record.history.slice(-4).map((p) => p.dispensed),
      daysOfStock: finiteOrNull(a.daysOfStock), risk: a.risk, projectedStockoutDate: a.projectedStockoutDate,
      unitsToCoverLeadTime: leadGap, unitsToReachThreshold: thresholdGap, inboundOpenTransferUnits: inbound,
      lastReportAt: record.lastReportAt, hoursSinceReport: round1((ms(state.now) - ms(record.lastReportAt)) / HOUR), reportSource: record.reportSource,
      verified: record.verified, recountRequested: record.recountRequested ?? null,
      countCheck: { flagged: anomaly.flagged, kind: anomaly.kind, expectedCount: anomaly.expected, reportedCount: anomaly.reported, deviation: anomaly.deviation, tolerance: anomaly.tolerance, note: anomaly.reason },
      nearExpiry: record.nearExpiry ? { ...record.nearExpiry, wouldExpireUnused: wouldExpireUnused(record, state.now) } : null,
    },
    donorCandidates: donors.slice(0, 6).map((d) => ({ ...d, etaHours: transferEtaHours(d.distanceKm) })),
    localTransferCapacity: {
      eligibleDonors: eligible.length,
      totalTransferable: localTransferable,
      nearestEligibleDonorKm: eligible[0]?.distanceKm ?? null,
      coversLeadTimeGap: leadGap > 0 ? localTransferable >= leadGap : null,
      coversThresholdGap: thresholdGap > 0 ? localTransferable >= thresholdGap : null,
    },
    districtTotals: totals,
    suggestedIndentUnits: indentQuantity(record, medicine, inbound),
    openTransfers: openTransfers(state, medicineId).map((t) => ({ from: names.get(t.fromId) ?? t.fromId, to: names.get(t.toId) ?? t.toId, quantity: t.quantity, status: t.status, distanceKm: t.distanceKm, etaHours: t.etaHours })),
    recentDecisions: state.decisions.filter((d) => d.facilityId === facilityId && d.medicineId === medicineId).slice(0, 3).map((d) => ({ action: d.action, status: d.status, createdAt: d.createdAt })),
    decisionPolicy: DECISION_POLICY,
  };
}

/** Stockout-days averted by one transfer: days of cover it adds, capped at the resupply lead time. */
export function stockoutDaysAverted(state: DistrictState, t: Transfer): number {
  const medicine = state.medicines.find((m) => m.id === t.medicineId);
  const rec = state.stock.find((r) => r.facilityId === t.toId && r.medicineId === t.medicineId);
  if (!medicine || !rec || rec.dailyUse <= 0) return 0;
  return Math.min(t.quantity / rec.dailyUse, medicine.leadTimeDays);
}

export function districtKpis(state: DistrictState): DistrictKpis {
  const assessments = assessDistrict(state);
  const sites = state.facilities.filter((f) => f.type !== "WAREHOUSE");
  const siteIds = new Set(sites.map((f) => f.id));
  const now = ms(state.now);
  const reporting = new Set(state.stock.filter((r) => siteIds.has(r.facilityId) && now - ms(r.lastReportAt) <= 7 * DAY).map((r) => r.facilityId));
  const siteAs = assessments.filter((a) => siteIds.has(a.facilityId));
  const atRisk = siteAs.filter((a) => AT_RISK.includes(a.risk));
  const live = state.decisions.filter((d: DecisionRecord) => d.source === "live").length;
  const fallback = state.decisions.length - live;
  return {
    facilitiesTotal: sites.length,
    facilitiesReporting: reporting.size,
    atRiskFacilities: new Set(atRisk.map((a) => a.facilityId)).size,
    atRiskRecords: atRisk.length,
    stockouts: siteAs.filter((a) => a.risk === "stockout").length,
    criticalRecords: siteAs.filter((a) => a.risk === "critical").length,
    unitsInTransit: state.transfers.filter((t) => t.status === "in_transit").reduce((s, t) => s + t.quantity, 0),
    transfersOpen: openTransfers(state).length,
    stockoutDaysAverted: round1(state.transfers.filter((t) => t.status === "approved" || t.status === "in_transit" || t.status === "delivered").reduce((s, t) => s + stockoutDaysAverted(state, t), 0)),
    decisionsPending: state.decisions.filter((d) => d.status === "pending").length,
    decisionsTotal: state.decisions.length,
    liveDecisions: live,
    fallbackDecisions: fallback,
    liveRatio: state.decisions.length ? live / state.decisions.length : null,
    anomalies: state.stock.filter((r) => detectAnomaly(r).flagged).length,
  };
}
