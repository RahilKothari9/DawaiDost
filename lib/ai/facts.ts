// OWNER: ai agent. Deterministic, facts-only decision snapshot for the Decisions API.
// The model never calculates: every number below comes from code. Safe for client and server.
import { assessStock, buildDistrictSnapshot, haversineKm } from "../district/engine";
import type { DistrictState, Facility, Medicine, StockRecord, Transfer } from "../district/types";

export const FACTS_KIND = "dawai-dost/decision-snapshot@2";
const OPEN: Transfer["status"][] = ["proposed", "approved", "in_transit"];

export type FactsDonor = {
  facilityId: string;
  name: string;
  type: string;
  block: string;
  distanceKm: number;
  stock: number;
  dailyUse: number;
  daysOfStock: number | null;
  transferable: number; // after the donor's own reserve and its open outbound transfers
  coversGapPct: number; // share of the target's gap this donor alone can bridge
  verified: boolean;
  nearExpiryUnits: number;
};

export type DecisionFacts = {
  kind: typeof FACTS_KIND;
  asOf: string;
  district: string;
  medicine: { id: string; name: string; strength: string; unit: string; leadTimeDays: number; safetyBufferDays: number; reserveDays: number };
  target: {
    facilityId: string;
    name: string;
    type: string;
    block: string;
    stock: number;
    dailyUse: number;
    daysOfStock: number | null;
    thresholdDays: number;
    risk: string;
    gapUnits: number;
    projectedStockoutDate: string | null;
    reportSource: string;
    reportAgeHours: number;
    verified: boolean;
    recountRequested: boolean;
    reportFlag: string | null;
    inboundUnits: number;
    nearExpiryUnits: number;
    weeklyDispensedTrend: number[];
  };
  donors: FactsDonor[];
  donorTotals: { eligible: number; totalTransferable: number; bestSingleCoverPct: number };
  upstream: { status: string; note: string; expectedOn: string | null } | null;
  districtStore: { facilityId: string; name: string; stock: number; daysOfDistrictDemand: number | null } | null;
  counterfactual?: string;
  policy: string;
  [key: string]: unknown;
};

export const DECISION_POLICY =
  "Recommend one next action for the target facility. Donors must keep their own reserve. A district officer approves every recount, transfer, indent, or escalation.";

const round1 = (n: number) => Math.round(n * 10) / 10;
const days = (stock: number, use: number) => (use > 0 ? round1(stock / use) : null);

function openOutbound(state: DistrictState, facilityId: string, medicineId: string) {
  return state.transfers.filter((t) => t.fromId === facilityId && t.medicineId === medicineId && OPEN.includes(t.status)).reduce((s, t) => s + t.quantity, 0);
}

function inbound(state: DistrictState, facilityId: string, medicineId: string) {
  return state.transfers.filter((t) => t.toId === facilityId && t.medicineId === medicineId && OPEN.includes(t.status)).reduce((s, t) => s + t.quantity, 0);
}

function reportFlag(rec: StockRecord, ageHours: number): string | null {
  if (rec.recountRequested) return `recount already requested: ${rec.recountRequested.reason}`;
  if (!rec.verified) return "latest count not verified";
  const h = rec.history ?? [];
  if (h.length >= 1) {
    const last = h[h.length - 1];
    // A count well above last week's closing stock with no receipts recorded is suspicious.
    if (rec.stock > last.closingStock * 1.5 + 5 && !(last.received && last.received > 0)) return "count is far above last week's closing stock with no receipt recorded";
  }
  if (ageHours > 24 * 10) return "report is more than 10 days old";
  return null;
}

export function rankDonors(state: DistrictState, target: Facility, medicine: Medicine, gapUnits: number): FactsDonor[] {
  const out: FactsDonor[] = [];
  for (const rec of state.stock) {
    if (rec.medicineId !== medicine.id || rec.facilityId === target.id) continue;
    const fac = state.facilities.find((f) => f.id === rec.facilityId);
    if (!fac || fac.type === "WAREHOUSE") continue;
    const a = assessStock(rec, medicine, state.now);
    const transferable = Math.max(0, a.transferable - openOutbound(state, fac.id, medicine.id));
    out.push({
      facilityId: fac.id,
      name: fac.name,
      type: fac.type,
      block: fac.block,
      distanceKm: round1(haversineKm(target, fac)),
      stock: rec.stock,
      dailyUse: rec.dailyUse,
      daysOfStock: days(rec.stock, rec.dailyUse),
      transferable,
      coversGapPct: gapUnits > 0 ? Math.min(100, Math.round((transferable / gapUnits) * 100)) : 100,
      verified: rec.verified,
      nearExpiryUnits: rec.nearExpiry?.quantity ?? 0,
    });
  }
  // Eligible (verified, with surplus) first, then by how much of the gap they cover per km.
  return out
    .filter((d) => d.transferable > 0)
    .sort((a, b) => Number(b.verified) - Number(a.verified) || b.coversGapPct / (a.distanceKm + 5) - a.coversGapPct / (b.distanceKm + 5) || a.distanceKm - b.distanceKm)
    .slice(0, 5);
}

export function buildDecisionFacts(state: DistrictState, facilityId: string, medicineId: string): DecisionFacts {
  const facility = state.facilities.find((f) => f.id === facilityId);
  const medicine = state.medicines.find((m) => m.id === medicineId);
  const rec = state.stock.find((s) => s.facilityId === facilityId && s.medicineId === medicineId);
  if (!facility || !medicine || !rec) throw new Error(`Unknown facility/medicine pair ${facilityId}/${medicineId}`);
  const a = assessStock(rec, medicine, state.now);
  const ageHours = Math.max(0, Math.round((new Date(state.now).getTime() - new Date(rec.lastReportAt).getTime()) / 36e5));
  const donors = rankDonors(state, facility, medicine, a.gapUnits);
  const store = state.facilities.find((f) => f.type === "WAREHOUSE");
  const storeRec = store ? state.stock.find((s) => s.facilityId === store.id && s.medicineId === medicineId) : undefined;
  const districtDemand = state.stock.filter((s) => s.medicineId === medicineId && s.facilityId !== store?.id).reduce((s, r) => s + r.dailyUse, 0);
  let engineFacts: Record<string, unknown> = {};
  try {
    engineFacts = buildDistrictSnapshot(state, facilityId, medicineId) ?? {};
  } catch {
    engineFacts = {};
  }
  return {
    ...engineFacts,
    kind: FACTS_KIND,
    asOf: state.now,
    district: `${state.district.name}, ${state.district.state}`,
    medicine: { id: medicine.id, name: medicine.name, strength: medicine.strength, unit: medicine.unit, leadTimeDays: medicine.leadTimeDays, safetyBufferDays: medicine.safetyBufferDays, reserveDays: medicine.reserveDays },
    target: {
      facilityId: facility.id,
      name: facility.name,
      type: facility.type,
      block: facility.block,
      stock: rec.stock,
      dailyUse: rec.dailyUse,
      daysOfStock: days(rec.stock, rec.dailyUse),
      thresholdDays: a.thresholdDays,
      risk: a.risk,
      gapUnits: a.gapUnits,
      projectedStockoutDate: a.projectedStockoutDate,
      reportSource: rec.reportSource,
      reportAgeHours: ageHours,
      verified: rec.verified,
      recountRequested: !!rec.recountRequested,
      reportFlag: reportFlag(rec, ageHours),
      inboundUnits: inbound(state, facilityId, medicineId),
      nearExpiryUnits: rec.nearExpiry?.quantity ?? 0,
      weeklyDispensedTrend: (rec.history ?? []).slice(-6).map((p) => p.dispensed),
    },
    donors,
    donorTotals: {
      eligible: donors.filter((d) => d.verified).length,
      totalTransferable: donors.reduce((s, d) => s + d.transferable, 0),
      bestSingleCoverPct: donors.reduce((m, d) => Math.max(m, d.coversGapPct), 0),
    },
    upstream: medicine.upstream ? { status: medicine.upstream.status, note: medicine.upstream.note, expectedOn: medicine.upstream.expectedOn ?? null } : null,
    districtStore: store && storeRec ? { facilityId: store.id, name: store.name, stock: storeRec.stock, daysOfDistrictDemand: days(storeRec.stock, districtDemand) } : null,
    policy: DECISION_POLICY,
  };
}

/** Recompute the target's derived numbers after a counterfactual edit. */
function rederive(f: DecisionFacts): DecisionFacts {
  const t = f.target;
  const d = days(t.stock, t.dailyUse);
  const gap = Math.max(0, Math.ceil(t.thresholdDays * t.dailyUse - t.stock));
  const risk = t.stock <= 0 ? "stockout" : d !== null && d < f.medicine.leadTimeDays ? "critical" : d !== null && d < t.thresholdDays ? "low" : "ok";
  const donors = f.donors.map((x) => ({ ...x, coversGapPct: gap > 0 ? Math.min(100, Math.round((x.transferable / gap) * 100)) : 100 }));
  const out = d === null ? null : new Date(new Date(f.asOf).getTime() + d * 864e5).toISOString().slice(0, 10);
  return {
    ...f,
    target: { ...t, daysOfStock: d, gapUnits: gap, risk, projectedStockoutDate: out },
    donors,
    donorTotals: {
      eligible: donors.filter((x) => x.verified).length,
      totalTransferable: donors.reduce((s, x) => s + x.transferable, 0),
      bestSingleCoverPct: donors.reduce((m, x) => Math.max(m, x.coversGapPct), 0),
    },
  };
}

export type CounterfactualKind = "remove_best_donor" | "remove_all_donors" | "count_half" | "count_double" | "unverified" | "upstream_delayed";

export const COUNTERFACTUALS: { kind: CounterfactualKind; label: string }[] = [
  { kind: "remove_best_donor", label: "Best donor unavailable" },
  { kind: "remove_all_donors", label: "No donors at all" },
  { kind: "count_half", label: "Count was half" },
  { kind: "count_double", label: "Count was double" },
  { kind: "unverified", label: "Count unverified" },
  { kind: "upstream_delayed", label: "Upstream delayed" },
];

export function applyCounterfactual(facts: DecisionFacts, kind: CounterfactualKind): DecisionFacts {
  const label = COUNTERFACTUALS.find((c) => c.kind === kind)?.label ?? kind;
  const f: DecisionFacts = structuredClone(facts);
  f.counterfactual = `What-if scenario (not real data): ${label}.`;
  switch (kind) {
    case "remove_best_donor": f.donors = f.donors.slice(1); break;
    case "remove_all_donors": f.donors = []; break;
    case "count_half": f.target.stock = Math.floor(f.target.stock / 2); break;
    case "count_double": f.target.stock = f.target.stock * 2; break;
    case "unverified": f.target.verified = false; f.target.reportFlag = "latest count not verified"; break;
    case "upstream_delayed": f.upstream = { status: "delayed", note: "State consignment delayed by about 3 weeks", expectedOn: null }; break;
  }
  return rederive(f);
}

export function isDecisionFacts(x: unknown): x is DecisionFacts {
  return !!x && typeof x === "object" && (x as { kind?: unknown }).kind === FACTS_KIND;
}
