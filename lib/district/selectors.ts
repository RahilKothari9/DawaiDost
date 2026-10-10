// OWNER: data agent. Derived views over DistrictState. Pure; pass `assessments` from useDistrict() to avoid recomputing.
import {
  AT_RISK, RISK_ORDER, assessDistrict, assessStock, detectAnomaly, districtTotals, donorCandidates, forecastSeries, haversineKm, inboundUnits, openTransfers,
  outboundUnits, planAllTransfers, transferArrivalAt, wouldExpireUnused,
} from "./engine";
import type {
  AnomalyCheck, DecisionRecord, DistrictState, Facility, Medicine, RiskLevel, StockAssessment, StockRecord, TimelineEvent, Transfer, TransferStatus,
} from "./types";

const HOUR = 36e5;
const key = (f: string, m: string) => `${f}|${m}`;

export type RiskItem = {
  facility: Facility;
  medicine: Medicine;
  record: StockRecord;
  assessment: StockAssessment;
  anomaly: AnomalyCheck;
  inbound: number;
  urgency: number; // 0..1, higher = act sooner
  pendingDecision: DecisionRecord | null;
};

function indexes(state: DistrictState) {
  return {
    facilities: new Map(state.facilities.map((f) => [f.id, f])),
    medicines: new Map(state.medicines.map((m) => [m.id, m])),
    records: new Map(state.stock.map((r) => [key(r.facilityId, r.medicineId), r])),
  };
}

/** 0..1 urgency: risk band, days short of lead time, and population served. */
export function urgencyScore(a: StockAssessment, medicine: Medicine, facility: Facility, inbound = 0, dailyUse = 0): number {
  const days = dailyUse > 0 ? (a.daysOfStock * dailyUse + inbound) / dailyUse : a.daysOfStock;
  const band = { stockout: 1, critical: 0.75, low: 0.45, ok: 0.1, surplus: 0 }[a.risk];
  const shortfall = Number.isFinite(days) ? Math.max(0, 1 - days / Math.max(1, medicine.leadTimeDays)) : 0;
  const pop = Math.min(1, facility.catchmentPopulation / 120000);
  return Math.min(1, Math.round((band * 0.6 + shortfall * 0.3 + pop * 0.1) * 100) / 100);
}

/** At-risk facility × medicine pairs (warehouse excluded), most urgent first. Optionally filter to one medicine. */
export function selectAtRisk(state: DistrictState, assessments: StockAssessment[] = assessDistrict(state), medicineId?: string): RiskItem[] {
  const ix = indexes(state);
  const pending = new Map(state.decisions.filter((d) => d.status === "pending").map((d) => [key(d.facilityId, d.medicineId), d]));
  return assessments
    .filter((a) => AT_RISK.includes(a.risk) && (!medicineId || a.medicineId === medicineId))
    .flatMap((a) => {
      const facility = ix.facilities.get(a.facilityId), medicine = ix.medicines.get(a.medicineId), record = ix.records.get(key(a.facilityId, a.medicineId));
      if (!facility || !medicine || !record || facility.type === "WAREHOUSE") return [];
      const inbound = inboundUnits(state, a.facilityId, a.medicineId);
      return [{ facility, medicine, record, assessment: a, anomaly: detectAnomaly(record), inbound, urgency: urgencyScore(a, medicine, facility, inbound, record.dailyUse), pendingDecision: pending.get(key(a.facilityId, a.medicineId)) ?? null }];
    })
    .sort((x, y) => RISK_ORDER[x.assessment.risk] - RISK_ORDER[y.assessment.risk] || y.urgency - x.urgency || x.assessment.daysOfStock - y.assessment.daysOfStock);
}

/** Records whose latest count disagrees with the ledger (verify_count candidates). */
export function selectAnomalies(state: DistrictState): { record: StockRecord; facility: Facility; medicine: Medicine; anomaly: AnomalyCheck }[] {
  const ix = indexes(state);
  return state.stock.flatMap((record) => {
    const anomaly = detectAnomaly(record);
    const facility = ix.facilities.get(record.facilityId), medicine = ix.medicines.get(record.medicineId);
    return anomaly.flagged && facility && medicine ? [{ record, facility, medicine, anomaly }] : [];
  });
}

/** Near-expiry stock that will expire on the shelf unless moved. */
export function selectNearExpiry(state: DistrictState) {
  const ix = indexes(state);
  return state.stock.flatMap((record) => {
    if (!record.nearExpiry) return [];
    const facility = ix.facilities.get(record.facilityId)!, medicine = ix.medicines.get(record.medicineId)!;
    return [{ record, facility, medicine, expiresOn: record.nearExpiry.expiresOn, quantity: record.nearExpiry.quantity, wouldExpireUnused: wouldExpireUnused(record, state.now) }];
  }).sort((a, b) => b.wouldExpireUnused - a.wouldExpireUnused);
}

export type FacilitySummary = {
  facility: Facility;
  worstRisk: RiskLevel;
  counts: Record<RiskLevel, number>;
  items: { medicine: Medicine; record: StockRecord; assessment: StockAssessment; anomaly: AnomalyCheck; inbound: number; outbound: number }[];
  lastReportAt: string | null;
  reportedThisWeek: boolean;
  openTransfers: Transfer[];
  decisions: DecisionRecord[];
  timeline: TimelineEvent[];
};

export function selectFacilitySummary(state: DistrictState, facilityId: string, assessments: StockAssessment[] = assessDistrict(state)): FacilitySummary | null {
  const facility = state.facilities.find((f) => f.id === facilityId);
  if (!facility) return null;
  const ix = indexes(state);
  const counts: Record<RiskLevel, number> = { stockout: 0, critical: 0, low: 0, ok: 0, surplus: 0 };
  const items = assessments.filter((a) => a.facilityId === facilityId).flatMap((assessment) => {
    const medicine = ix.medicines.get(assessment.medicineId), record = ix.records.get(key(facilityId, assessment.medicineId));
    if (!medicine || !record) return [];
    counts[assessment.risk]++;
    return [{ medicine, record, assessment, anomaly: detectAnomaly(record), inbound: inboundUnits(state, facilityId, medicine.id), outbound: outboundUnits(state, facilityId, medicine.id) }];
  }).sort((a, b) => RISK_ORDER[a.assessment.risk] - RISK_ORDER[b.assessment.risk] || a.assessment.daysOfStock - b.assessment.daysOfStock);
  const last = items.reduce<string | null>((m, i) => (!m || i.record.lastReportAt > m ? i.record.lastReportAt : m), null);
  return {
    facility,
    worstRisk: items[0]?.assessment.risk ?? "ok",
    counts,
    items,
    lastReportAt: last,
    reportedThisWeek: !!last && new Date(state.now).getTime() - new Date(last).getTime() <= 7 * 24 * HOUR,
    openTransfers: openTransfers(state).filter((t) => t.fromId === facilityId || t.toId === facilityId),
    decisions: state.decisions.filter((d) => d.facilityId === facilityId),
    timeline: state.timeline.filter((e) => e.facilityId === facilityId),
  };
}

/** Worst risk per facility (optionally for one medicine) — drives map marker colour. */
export function selectFacilityRiskMap(state: DistrictState, assessments: StockAssessment[] = assessDistrict(state), medicineId?: string): Record<string, RiskLevel> {
  const out: Record<string, RiskLevel> = {};
  for (const a of assessments) {
    if (medicineId && a.medicineId !== medicineId) continue;
    const cur = out[a.facilityId];
    if (!cur || RISK_ORDER[a.risk] < RISK_ORDER[cur]) out[a.facilityId] = a.risk;
  }
  return out;
}

export type MedicineCoverage = ReturnType<typeof districtTotals> & {
  medicine: Medicine;
  riskCounts: Record<RiskLevel, number>;
  worstFacilities: { facility: Facility; assessment: StockAssessment }[];
};

/** District coverage for one medicine (or all when omitted). */
export function selectMedicineCoverage(state: DistrictState, medicineId: string, assessments: StockAssessment[] = assessDistrict(state)): MedicineCoverage | null {
  const medicine = state.medicines.find((m) => m.id === medicineId);
  if (!medicine) return null;
  const ix = indexes(state);
  const riskCounts: Record<RiskLevel, number> = { stockout: 0, critical: 0, low: 0, ok: 0, surplus: 0 };
  const sites = assessments.filter((a) => a.medicineId === medicineId && ix.facilities.get(a.facilityId)?.type !== "WAREHOUSE");
  sites.forEach((a) => riskCounts[a.risk]++);
  return {
    ...districtTotals(state, medicineId),
    medicine,
    riskCounts,
    worstFacilities: sites.filter((a) => AT_RISK.includes(a.risk)).sort((a, b) => a.daysOfStock - b.daysOfStock).slice(0, 5).map((assessment) => ({ facility: ix.facilities.get(assessment.facilityId)!, assessment })),
  };
}

export function selectAllCoverage(state: DistrictState, assessments: StockAssessment[] = assessDistrict(state)): MedicineCoverage[] {
  return state.medicines.map((m) => selectMedicineCoverage(state, m.id, assessments)!).filter(Boolean);
}

/** Facility × medicine matrix of assessments, rows = facilities (warehouse last), cols = medicines. */
export function selectHeatmap(state: DistrictState, assessments: StockAssessment[] = assessDistrict(state)) {
  const byKey = new Map(assessments.map((a) => [key(a.facilityId, a.medicineId), a]));
  const order = { PHC: 0, CHC: 1, DH: 2, WAREHOUSE: 3 } as const;
  const facilities = [...state.facilities].sort((a, b) => order[a.type] - order[b.type] || a.block.localeCompare(b.block) || a.name.localeCompare(b.name));
  return { facilities, medicines: state.medicines, cell: (f: string, m: string) => byKey.get(key(f, m)) ?? null };
}

export function selectTransfersByStatus(state: DistrictState): Record<TransferStatus, Transfer[]> {
  const out: Record<TransferStatus, Transfer[]> = { proposed: [], approved: [], in_transit: [], delivered: [], rejected: [] };
  for (const t of state.transfers) out[t.status].push(t);
  for (const k of Object.keys(out) as TransferStatus[]) out[k].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export type TransferView = Transfer & {
  from: Facility;
  to: Facility;
  medicine: Medicine;
  progress: number; // 0..1 along the route (in_transit), 1 delivered, 0 otherwise
  arrivalAt: string | null;
};

/** Transfers joined with endpoints and live route progress for map arcs. */
export function selectTransferViews(state: DistrictState, statuses?: TransferStatus[]): TransferView[] {
  const ix = indexes(state);
  const now = new Date(state.now).getTime();
  return state.transfers.filter((t) => !statuses || statuses.includes(t.status)).flatMap((t) => {
    const from = ix.facilities.get(t.fromId), to = ix.facilities.get(t.toId), medicine = ix.medicines.get(t.medicineId);
    if (!from || !to || !medicine) return [];
    const progress = t.status === "delivered" ? 1 : t.status === "in_transit" && t.dispatchedAt ? Math.min(0.98, Math.max(0.02, (now - new Date(t.dispatchedAt).getTime()) / (t.etaHours * HOUR))) : 0;
    const arrivalAt = t.status === "delivered" ? t.deliveredAt ?? t.updatedAt : t.status === "rejected" ? null : transferArrivalAt(t);
    return [{ ...t, from, to, medicine, progress, arrivalAt }];
  });
}

/** Planner proposals not yet in state (what transfer_surplus would dispatch). */
export function selectSuggestedTransfers(state: DistrictState, medicineId?: string): Transfer[] {
  return planAllTransfers(state).filter((t) => !medicineId || t.medicineId === medicineId);
}

/** Forecast for one record including scheduled inbound transfers. */
export function selectForecast(state: DistrictState, facilityId: string, medicineId: string, days = 21) {
  const record = state.stock.find((r) => r.facilityId === facilityId && r.medicineId === medicineId);
  const medicine = state.medicines.find((m) => m.id === medicineId);
  if (!record || !medicine) return null;
  const inbound = openTransfers(state, medicineId).filter((t) => t.toId === facilityId && t.status !== "proposed").map((t) => ({ at: transferArrivalAt(t), quantity: t.quantity }));
  const a = assessStock(record, medicine, state.now);
  return {
    series: forecastSeries(record, days, state.now, inbound),
    withoutTransfers: forecastSeries(record, days, state.now),
    thresholdUnits: a.thresholdDays * record.dailyUse,
    reserveUnits: medicine.reserveDays * record.dailyUse,
    leadTimeDays: medicine.leadTimeDays,
    history: record.history,
    assessment: a,
  };
}

export function selectDonors(state: DistrictState, facilityId: string, medicineId: string) {
  return donorCandidates(state, facilityId, medicineId);
}

export function selectNearestFacilities(state: DistrictState, facilityId: string, n = 5): { facility: Facility; distanceKm: number }[] {
  const f = state.facilities.find((x) => x.id === facilityId);
  if (!f) return [];
  return state.facilities.filter((x) => x.id !== facilityId).map((facility) => ({ facility, distanceKm: haversineKm(f, facility) })).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, n);
}

export function selectTimeline(state: DistrictState, filter: { facilityId?: string; medicineId?: string; kinds?: TimelineEvent["kind"][]; limit?: number } = {}): TimelineEvent[] {
  return state.timeline
    .filter((e) => (!filter.facilityId || e.facilityId === filter.facilityId) && (!filter.medicineId || e.medicineId === filter.medicineId) && (!filter.kinds || filter.kinds.includes(e.kind)))
    .slice(0, filter.limit ?? Infinity);
}

export function selectPendingDecisions(state: DistrictState): DecisionRecord[] {
  return state.decisions.filter((d) => d.status === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Facilities grouped by block with worst risk, for block-level rollups. */
export function selectBlocks(state: DistrictState, assessments: StockAssessment[] = assessDistrict(state)) {
  const risk = selectFacilityRiskMap(state, assessments);
  const blocks = new Map<string, { block: string; facilities: Facility[]; worstRisk: RiskLevel; atRisk: number; population: number }>();
  for (const f of state.facilities) {
    if (f.type === "WAREHOUSE") continue;
    const b = blocks.get(f.block) ?? { block: f.block, facilities: [], worstRisk: "surplus" as RiskLevel, atRisk: 0, population: 0 };
    b.facilities.push(f);
    const r = risk[f.id] ?? "ok";
    if (RISK_ORDER[r] < RISK_ORDER[b.worstRisk]) b.worstRisk = r;
    if (AT_RISK.includes(r)) b.atRisk++;
    if (f.type === "PHC") b.population += f.catchmentPopulation;
    blocks.set(f.block, b);
  }
  return [...blocks.values()].sort((a, b) => b.atRisk - a.atRisk || a.block.localeCompare(b.block));
}
