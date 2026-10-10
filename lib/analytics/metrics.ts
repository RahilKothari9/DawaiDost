// OWNER: analytics agent. Deterministic, presentation-oriented aggregates over the district state.
// The stock math itself lives in lib/district/engine.ts; these helpers delegate to it and only add
// aggregation (weekly series, per-medicine snapshots) and a continuous projection for charts.

import type {
  DecisionRecord,
  DistrictState,
  Facility,
  Medicine,
  RiskLevel,
  StockAssessment,
  StockRecord,
  Transfer,
} from "../district/types";
import {
  assessStock,
  districtKpis,
  stockoutDaysAverted,
  thresholdDays as engineThreshold,
  transferArrivalAt,
  weekStart,
} from "../district/engine";

/** Worst → best. */
export const RISK_LEVELS: RiskLevel[] = ["stockout", "critical", "low", "ok", "surplus"];

/** Shared labels from the district formatters, so every panel names states identically. */
export { RISK_LABEL } from "../district/format";

export const RISK_SHORT: Record<RiskLevel, string> = {
  stockout: "Out",
  critical: "Critical",
  low: "Low",
  ok: "OK",
  surplus: "Surplus",
};

export const RISK_VAR: Record<RiskLevel, string> = {
  stockout: "var(--risk-stockout)",
  critical: "var(--risk-critical)",
  low: "var(--risk-low)",
  ok: "var(--risk-ok)",
  surplus: "var(--risk-surplus)",
};

export const riskRank = (r: RiskLevel) => RISK_LEVELS.indexOf(r);
export const isAtRisk = (r: RiskLevel) => r === "stockout" || r === "critical" || r === "low";

export const DAY_MS = 864e5;

export function thresholdOf(m: Medicine) {
  return engineThreshold(m);
}

/** Engine classification (assessStock) applied to any (stock, dailyUse) pair, e.g. a historical week. */
export function classify(stock: number, dailyUse: number, m: Medicine): RiskLevel {
  const at = "2026-01-01T00:00:00Z";
  const probe: StockRecord = {
    facilityId: "_", medicineId: m.id, stock, dailyUse, nearExpiry: null, lastReportAt: at, reportSource: "system", verified: true, history: [],
  };
  return assessStock(probe, m, at).risk;
}

/** Daily use implied by a weekly history point; falls back to the record's current daily use. */
export function weeklyDailyUse(dispensed: number, fallback: number) {
  return dispensed > 0 ? dispensed / 7 : fallback;
}

export function warehouseIds(state: DistrictState): Set<string> {
  return new Set(state.facilities.filter((f) => f.type === "WAREHOUSE").map((f) => f.id));
}

/** Stock records at service sites (the district warehouse is reported separately, as in the engine). */
export function siteRecords(state: DistrictState): StockRecord[] {
  const wh = warehouseIds(state);
  return state.stock.filter((r) => !wh.has(r.facilityId));
}

export type Lookup = {
  medicine: Map<string, Medicine>;
  facility: Map<string, Facility>;
  record: Map<string, StockRecord>; // key `${facilityId}|${medicineId}`
  assessment: Map<string, StockAssessment>;
};

export const key = (facilityId: string, medicineId: string) => `${facilityId}|${medicineId}`;

export function buildLookup(state: DistrictState, assessments: StockAssessment[]): Lookup {
  return {
    medicine: new Map(state.medicines.map((m) => [m.id, m])),
    facility: new Map(state.facilities.map((f) => [f.id, f])),
    record: new Map(state.stock.map((r) => [key(r.facilityId, r.medicineId), r])),
    assessment: new Map(assessments.map((a) => [key(a.facilityId, a.medicineId), a])),
  };
}

/** Sorted unique ISO week dates (IST Mondays) across all history. */
export function historyWeeks(state: DistrictState): string[] {
  const s = new Set<string>();
  for (const r of state.stock) for (const p of r.history) s.add(p.weekOf.slice(0, 10));
  return [...s].sort();
}

// ---------------------------------------------------------------- transfers

const OPEN_INBOUND: Transfer["status"][] = ["approved", "in_transit"];

/** Expected arrival (engine rule), never earlier than the simulated now. */
export function transferArrival(t: Transfer, nowIso: string): number {
  const now = new Date(nowIso).getTime();
  const at = new Date(transferArrivalAt(t)).getTime();
  return Number.isFinite(at) ? Math.max(now, at) : now;
}

export function openInbound(state: DistrictState, facilityId: string, medicineId?: string): Transfer[] {
  return state.transfers.filter(
    (t) => t.toId === facilityId && OPEN_INBOUND.includes(t.status) && (!medicineId || t.medicineId === medicineId),
  );
}

export function openOutbound(state: DistrictState, facilityId: string, medicineId?: string): Transfer[] {
  return state.transfers.filter(
    (t) => t.fromId === facilityId && OPEN_INBOUND.includes(t.status) && (!medicineId || t.medicineId === medicineId),
  );
}

/** Stockout-days averted by one transfer (engine rule); proposed / rejected transfers count zero. */
export function transferAvertedDays(state: DistrictState, t: Transfer): number {
  if (!["approved", "in_transit", "delivered"].includes(t.status)) return 0;
  return stockoutDaysAverted(state, t);
}

const creditedAt = (t: Transfer) => new Date(t.deliveredAt ?? t.approvedAt ?? t.updatedAt).getTime();

export type AvertedPoint = { at: number; total: number; transfer: Transfer; days: number };

export function avertedSeries(state: DistrictState): AvertedPoint[] {
  const items = state.transfers
    .map((t) => ({ t, days: transferAvertedDays(state, t) }))
    .filter((x) => x.days > 0)
    .sort((a, b) => creditedAt(a.t) - creditedAt(b.t));
  let total = 0;
  return items.map(({ t, days }) => {
    total += days;
    return { at: creditedAt(t), total, transfer: t, days };
  });
}

// ---------------------------------------------------------------- district aggregates

export type MedicineSnapshot = {
  medicine: Medicine;
  totalStock: number;
  totalDailyUse: number;
  coverageDays: number;
  thresholdDays: number;
  risk: RiskLevel; // classification of pooled site stock
  atRisk: number;
  stockouts: number;
  donors: number; // surplus sites with transferable stock
  transferable: number;
  facilities: number;
  distribution: Record<RiskLevel, number>;
  inTransitUnits: number;
  warehouseStock: number;
};

export function medicineSnapshot(state: DistrictState, assessments: StockAssessment[], m: Medicine): MedicineSnapshot {
  const wh = warehouseIds(state);
  const recs = state.stock.filter((r) => r.medicineId === m.id && !wh.has(r.facilityId));
  const as = assessments.filter((a) => a.medicineId === m.id && !wh.has(a.facilityId));
  const totalStock = recs.reduce((s, r) => s + Math.max(0, r.stock), 0);
  const totalDailyUse = recs.reduce((s, r) => s + Math.max(0, r.dailyUse), 0);
  const distribution: Record<RiskLevel, number> = { stockout: 0, critical: 0, low: 0, ok: 0, surplus: 0 };
  for (const a of as) distribution[a.risk]++;
  const donorsList = as.filter((a) => a.risk === "surplus" && a.transferable > 0);
  return {
    medicine: m,
    totalStock,
    totalDailyUse,
    coverageDays: totalDailyUse > 0 ? totalStock / totalDailyUse : Infinity,
    thresholdDays: thresholdOf(m),
    risk: classify(totalStock, totalDailyUse, m),
    atRisk: as.filter((a) => isAtRisk(a.risk)).length,
    stockouts: distribution.stockout,
    donors: donorsList.length,
    transferable: donorsList.reduce((s, a) => s + a.transferable, 0),
    facilities: as.length,
    distribution,
    inTransitUnits: state.transfers
      .filter((t) => t.medicineId === m.id && t.status === "in_transit")
      .reduce((s, t) => s + t.quantity, 0),
    warehouseStock: state.stock.filter((r) => r.medicineId === m.id && wh.has(r.facilityId)).reduce((s, r) => s + r.stock, 0),
  };
}

export type WeekPoint = {
  date: string; // IST Monday; the final point is the live snapshot for the current week
  live: boolean;
  totalStock: number;
  totalDailyUse: number;
  coverageDays: number;
  atRisk: number;
  stockouts: number;
};

/** District-level (sites only) weekly series for one medicine; the current week uses live stock. */
export function medicineWeekly(state: DistrictState, m: Medicine, weeks = historyWeeks(state)): WeekPoint[] {
  const recs = siteRecords(state).filter((r) => r.medicineId === m.id);
  const out: WeekPoint[] = weeks.map((w) => {
    let totalStock = 0, totalDailyUse = 0, atRisk = 0, stockouts = 0;
    for (const r of recs) {
      const p = r.history.find((h) => h.weekOf.slice(0, 10) === w);
      if (!p) continue;
      const du = weeklyDailyUse(p.dispensed, r.dailyUse);
      totalStock += Math.max(0, p.closingStock);
      totalDailyUse += du;
      const risk = classify(p.closingStock, du, m);
      if (isAtRisk(risk)) atRisk++;
      if (risk === "stockout") stockouts++;
    }
    return { date: w, live: false, totalStock, totalDailyUse, coverageDays: totalDailyUse > 0 ? totalStock / totalDailyUse : 0, atRisk, stockouts };
  });
  let totalStock = 0, totalDailyUse = 0, atRisk = 0, stockouts = 0;
  for (const r of recs) {
    totalStock += Math.max(0, r.stock);
    totalDailyUse += Math.max(0, r.dailyUse);
    const risk = classify(r.stock, r.dailyUse, m);
    if (isAtRisk(risk)) atRisk++;
    if (risk === "stockout") stockouts++;
  }
  const thisWeek = weekStart(state.now);
  const live: WeekPoint = { date: thisWeek, live: true, totalStock, totalDailyUse, coverageDays: totalDailyUse > 0 ? totalStock / totalDailyUse : 0, atRisk, stockouts };
  if (out.length && out[out.length - 1]!.date >= thisWeek) out[out.length - 1] = live;
  else out.push(live);
  return out;
}

/** District-wide weekly counts (all medicines, sites only), ending with the live week. */
export function districtWeekly(state: DistrictState): { date: string; atRisk: number; stockouts: number }[] {
  const weeks = historyWeeks(state);
  const per = state.medicines.map((m) => medicineWeekly(state, m, weeks));
  const len = per[0]?.length ?? 0;
  return Array.from({ length: len }, (_, i) => ({
    date: per[0]![i]!.date,
    atRisk: per.reduce((s, p) => s + (p[i]?.atRisk ?? 0), 0),
    stockouts: per.reduce((s, p) => s + (p[i]?.stockouts ?? 0), 0),
  }));
}

// ---------------------------------------------------------------- KPIs

export type Kpis = {
  facilitiesTotal: number;
  facilitiesReporting: number;
  atRisk: number;
  atRiskFacilities: number;
  atRiskSeries: number[];
  stockouts: number;
  stockoutSeries: number[];
  unitsInTransit: number;
  transfersInTransit: number;
  transfersOpen: number;
  avertedDays: number;
  avertedSeries: number[];
  decisionsPending: number;
  oldestPendingAt: string | null;
  decisionsTotal: number;
  liveDecisions: number;
  fallbackDecisions: number;
  liveShare: number | null;
  anomalies: number;
};

export function computeKpis(state: DistrictState): Kpis {
  const k = districtKpis(state);
  const weekly = districtWeekly(state);
  const averted = avertedSeries(state);
  const pending = state.decisions.filter((d) => d.status === "pending");
  const oldest = pending.reduce<DecisionRecord | null>((o, d) => (!o || d.createdAt < o.createdAt ? d : o), null);
  return {
    facilitiesTotal: k.facilitiesTotal,
    facilitiesReporting: k.facilitiesReporting,
    atRisk: k.atRiskRecords,
    atRiskFacilities: k.atRiskFacilities,
    atRiskSeries: weekly.map((w) => w.atRisk),
    stockouts: k.stockouts,
    stockoutSeries: weekly.map((w) => w.stockouts),
    unitsInTransit: k.unitsInTransit,
    transfersInTransit: state.transfers.filter((t) => t.status === "in_transit").length,
    transfersOpen: k.transfersOpen,
    avertedDays: k.stockoutDaysAverted,
    avertedSeries: [0, ...averted.map((a) => a.total)],
    decisionsPending: k.decisionsPending,
    oldestPendingAt: oldest?.createdAt ?? null,
    decisionsTotal: k.decisionsTotal,
    liveDecisions: k.liveDecisions,
    fallbackDecisions: k.fallbackDecisions,
    liveShare: k.liveRatio,
    anomalies: k.anomalies,
  };
}

// ---------------------------------------------------------------- projection

export type ProjectionPoint = { t: number /* ms */; stock: number; arrival?: Transfer };

export type Projection = {
  points: ProjectionPoint[];
  stockoutAt: number | null; // first time stock reaches zero inside the horizon
  stockoutDays: number; // days at zero inside the horizon
  arrivals: { at: number; transfer: Transfer; before: number; after: number }[];
  horizonEnd: number;
  stockAt: (t: number) => number;
};

/**
 * Continuous piecewise-linear projection at the record's daily use (the same rate behind days of stock),
 * with inbound transfers as step-ups at their engine arrival time. Used for drawing; the engine's
 * forecastSeries remains the daily reference series.
 */
export function projectStock(record: StockRecord, nowIso: string, horizonDays: number, inbound: Transfer[]): Projection {
  const t0 = new Date(nowIso).getTime();
  const end = t0 + horizonDays * DAY_MS;
  const d = Math.max(0, record.dailyUse) / DAY_MS; // units per ms
  const events = inbound
    .map((tr) => ({ at: transferArrival(tr, nowIso), tr }))
    .filter((e) => e.at <= end)
    .sort((a, b) => a.at - b.at);

  const points: ProjectionPoint[] = [{ t: t0, stock: Math.max(0, record.stock) }];
  const arrivals: Projection["arrivals"] = [];
  let s = Math.max(0, record.stock);
  let t = t0;
  let stockoutAt: number | null = s <= 0 && d > 0 ? t0 : null;
  let zeroMs = 0;

  const run = (tEnd: number) => {
    if (tEnd <= t) return;
    if (d > 0 && s > 0) {
      const tZero = t + s / d;
      if (tZero < tEnd) {
        points.push({ t: tZero, stock: 0 });
        stockoutAt ??= tZero;
        zeroMs += tEnd - tZero;
        s = 0;
      } else s -= d * (tEnd - t);
    } else if (s <= 0 && d > 0) zeroMs += tEnd - t;
    points.push({ t: tEnd, stock: Math.max(0, s) });
    t = tEnd;
  };

  for (const e of events) {
    run(e.at);
    const before = s;
    s += e.tr.quantity;
    points.push({ t: e.at, stock: s, arrival: e.tr });
    arrivals.push({ at: e.at, transfer: e.tr, before, after: s });
  }
  run(end);

  const stockAt = (q: number) => {
    if (q <= points[0]!.t) return points[0]!.stock;
    for (let i = points.length - 1; i > 0; i--) {
      const a = points[i - 1]!, b = points[i]!;
      if (q >= a.t && q <= b.t) {
        if (b.t === a.t) return b.stock;
        return a.stock + ((b.stock - a.stock) * (q - a.t)) / (b.t - a.t);
      }
    }
    return points[points.length - 1]!.stock;
  };

  return { points, stockoutAt, stockoutDays: zeroMs / DAY_MS, arrivals, horizonEnd: end, stockAt };
}

export function horizonFor(record: StockRecord, m: Medicine): number {
  const days = record.dailyUse > 0 ? record.stock / record.dailyUse : 0;
  return Math.min(42, Math.max(21, Math.ceil(thresholdOf(m) * 2.5), Math.ceil(days) + 4));
}

/** Worst-first ordering of facility-medicine assessments. */
export function compareAssessments(a: StockAssessment, b: StockAssessment) {
  return riskRank(a.risk) - riskRank(b.risk) || a.daysOfStock - b.daysOfStock;
}
