// OWNER: map agent. Derives a render-ready view model of the district from the shared store.
// Both renderers (MapLibre and the SVG fallback) draw from this, so they always agree.
import { scaleSqrt } from "d3-scale";
import { haversineKm, planTransfers } from "../district/engine";
import type {
  DistrictState,
  Facility,
  FacilityType,
  Medicine,
  RiskLevel,
  StockAssessment,
  StockRecord,
  TransferStatus,
} from "../district/types";
import { clamp01, coverageGrid, districtOutline, makeArc, pointOnArc, type Arc, type CoverageCell, type LngLat } from "./geometry";

export type FlowStatus = TransferStatus | "opportunity";

export type MapFacility = {
  id: string;
  name: string;
  type: FacilityType;
  block: string;
  lngLat: LngLat;
  catchment: number;
  radius: number; // px at base zoom
  risk: RiskLevel | null;
  daysOfStock: number | null; // null when no record
  ratio: number | null; // days / threshold, capped
  thresholdDays: number | null;
  stock: number | null;
  dailyUse: number | null;
  transferable: number;
  gapUnits: number;
  lastReportAt: string | null;
  reportSource: StockRecord["reportSource"] | null;
  verified: boolean;
  pharmacist: Facility["pharmacist"];
  inbound: number; // active inbound transfers for the shown medicine(s)
  outbound: number;
};

export type MapFlow = {
  id: string;
  status: FlowStatus;
  medicineId: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  quantity: number;
  etaHours: number;
  distanceKm: number;
  departMs: number; // when the consignment left (for in_transit)
  updatedMs: number;
  arc: Arc;
  mid: LngLat;
  primary: boolean; // belongs to the selected medicine
};

export type MapSpoke = { id: string; fromId: string; toId: string; coords: LngLat[] };

export type MapStats = {
  atRisk: number;
  stockouts: number;
  inTransit: number;
  proposed: number;
  approved: number;
  opportunities: number;
  unitsMoving: number;
  deliveredRecent: number;
};

export type MapModel = {
  medicine: Medicine | undefined;
  nowMs: number;
  facilities: MapFacility[];
  facilityById: Map<string, MapFacility>;
  flows: MapFlow[];
  spokes: MapSpoke[];
  outline: LngLat[];
  coverage: CoverageCell[];
  bounds: [number, number, number, number];
  stats: MapStats;
};

export type ModelOptions = {
  allMedicines?: boolean;
  showOpportunities?: boolean;
  coverage?: boolean;
  deliveredWindowHours?: number;
};

const ACTIVE: TransferStatus[] = ["proposed", "approved", "in_transit"];

/** Elapsed share of a consignment's journey at `nowMs` (0..1). */
export function flowProgress(flow: Pick<MapFlow, "status" | "departMs" | "etaHours">, nowMs: number): number {
  if (flow.status === "delivered") return 1;
  if (flow.status !== "in_transit") return 0;
  const span = Math.max(0.25, flow.etaHours) * 3.6e6;
  return clamp01((nowMs - flow.departMs) / span);
}

export function consignmentAt(flow: MapFlow, nowMs: number): LngLat {
  return pointOnArc(flow.arc, flowProgress(flow, nowMs));
}

export function buildMapModel(state: DistrictState, assessments: StockAssessment[], opts: ModelOptions = {}): MapModel {
  const { allMedicines = false, showOpportunities = true, coverage = true, deliveredWindowHours = 96 } = opts;
  const medId = state.selectedMedicineId;
  const medicine = state.medicines.find((m) => m.id === medId);
  const nowMs = new Date(state.now).getTime();

  const stockByFacility = new Map<string, StockRecord>();
  for (const r of state.stock) if (r.medicineId === medId) stockByFacility.set(r.facilityId, r);
  const assessByFacility = new Map<string, StockAssessment>();
  for (const a of assessments) if (a.medicineId === medId) assessByFacility.set(a.facilityId, a);

  const phcPops = state.facilities.filter((f) => f.type === "PHC").map((f) => f.catchmentPopulation);
  const rScale = scaleSqrt()
    .domain([Math.min(...phcPops, 10000), Math.max(...phcPops, 40000)])
    .range([6.5, 13])
    .clamp(true);
  const typeRadius: Record<FacilityType, number> = { WAREHOUSE: 13, DH: 12, CHC: 10, PHC: 0 };

  const facilities: MapFacility[] = state.facilities.map((f) => {
    const r = stockByFacility.get(f.id);
    const a = assessByFacility.get(f.id);
    const days = a ? a.daysOfStock : null;
    const ratio = a && days !== null ? Math.min(3, Number.isFinite(days) ? days / Math.max(1, a.thresholdDays) : 3) : null;
    return {
      id: f.id,
      name: f.name,
      type: f.type,
      block: f.block,
      lngLat: [f.lng, f.lat],
      catchment: f.catchmentPopulation,
      radius: f.type === "PHC" ? rScale(f.catchmentPopulation) : typeRadius[f.type],
      risk: a ? a.risk : null,
      daysOfStock: days,
      ratio,
      thresholdDays: a ? a.thresholdDays : null,
      stock: r ? r.stock : null,
      dailyUse: r ? r.dailyUse : null,
      transferable: a ? a.transferable : 0,
      gapUnits: a ? a.gapUnits : 0,
      lastReportAt: r ? r.lastReportAt : null,
      reportSource: r ? r.reportSource : null,
      verified: r ? r.verified : false,
      pharmacist: f.pharmacist,
      inbound: 0,
      outbound: 0,
    };
  });
  const facilityById = new Map(facilities.map((f) => [f.id, f]));

  const flows: MapFlow[] = [];
  const mkFlow = (
    id: string,
    status: FlowStatus,
    medicineId: string,
    fromId: string,
    toId: string,
    quantity: number,
    etaHours: number,
    distanceKm: number,
    departMs: number,
    updatedMs: number,
  ) => {
    const from = facilityById.get(fromId);
    const to = facilityById.get(toId);
    if (!from || !to) return;
    const arc = makeArc(from.lngLat, to.lngLat, status === "opportunity" ? 0.16 : 0.24);
    flows.push({
      id, status, medicineId, fromId, toId, fromName: from.name, toName: to.name, quantity, etaHours,
      distanceKm: distanceKm || haversineKm({ lat: from.lngLat[1], lng: from.lngLat[0] }, { lat: to.lngLat[1], lng: to.lngLat[0] }),
      departMs, updatedMs, arc, mid: pointOnArc(arc, 0.5), primary: medicineId === medId,
    });
  };

  for (const t of state.transfers) {
    if (t.status === "rejected") continue;
    if (!allMedicines && t.medicineId !== medId) continue;
    const updatedMs = new Date(t.deliveredAt ?? t.updatedAt).getTime();
    if (t.status === "delivered" && nowMs - updatedMs > deliveredWindowHours * 3.6e6) continue;
    const departMs = new Date(t.dispatchedAt ?? (t.status === "in_transit" ? t.updatedAt : t.createdAt)).getTime();
    mkFlow(t.id, t.status, t.medicineId, t.fromId, t.toId, t.quantity, t.etaHours, t.distanceKm, departMs, updatedMs);
  }

  let opportunities = 0;
  if (showOpportunities && medicine) {
    const taken = new Set(
      state.transfers.filter((t) => t.medicineId === medId && ACTIVE.includes(t.status)).map((t) => `${t.fromId}>${t.toId}`),
    );
    const busyRecipients = new Set(
      state.transfers.filter((t) => t.medicineId === medId && ACTIVE.includes(t.status)).map((t) => t.toId),
    );
    let plan: ReturnType<typeof planTransfers> = [];
    try {
      plan = planTransfers(state, medId);
    } catch {
      plan = [];
    }
    for (const p of plan) {
      if (taken.has(`${p.fromId}>${p.toId}`) || busyRecipients.has(p.toId)) continue;
      opportunities++;
      mkFlow(`opp:${p.fromId}>${p.toId}`, "opportunity", medId, p.fromId, p.toId, p.quantity, p.etaHours, p.distanceKm, nowMs, nowMs);
    }
  }

  for (const fl of flows) {
    if (fl.status === "delivered" || fl.status === "opportunity" || !fl.primary) continue;
    const from = facilityById.get(fl.fromId);
    const to = facilityById.get(fl.toId);
    if (from) from.outbound++;
    if (to) to.inbound++;
  }

  const warehouses = facilities.filter((f) => f.type === "WAREHOUSE");
  const spokes: MapSpoke[] = [];
  if (warehouses.length) {
    for (const f of facilities) {
      if (f.type === "WAREHOUSE") continue;
      let best = warehouses[0];
      let bestD = Infinity;
      for (const w of warehouses) {
        const d = (w.lngLat[0] - f.lngLat[0]) ** 2 + (w.lngLat[1] - f.lngLat[1]) ** 2;
        if (d < bestD) { bestD = d; best = w; }
      }
      spokes.push({ id: `spoke:${best.id}>${f.id}`, fromId: best.id, toId: f.id, coords: makeArc(best.lngLat, f.lngLat, 0.05, 16).coords });
    }
  }

  const pts = facilities.map((f) => f.lngLat);
  const outline = districtOutline(pts);
  const coverageCells = coverage
    ? coverageGrid(
        facilities
          .filter((f) => f.ratio !== null && f.type !== "WAREHOUSE")
          .map((f) => ({ at: f.lngLat, value: f.ratio as number, weight: Math.sqrt(f.catchment / 10000) })),
        outline,
      )
    : [];

  const shown = facilities.filter((f) => f.type !== "WAREHOUSE");
  const primaryFlows = flows.filter((f) => f.primary);
  const stats: MapStats = {
    atRisk: shown.filter((f) => f.risk === "critical" || f.risk === "stockout").length,
    stockouts: shown.filter((f) => f.risk === "stockout").length,
    inTransit: primaryFlows.filter((f) => f.status === "in_transit").length,
    proposed: primaryFlows.filter((f) => f.status === "proposed").length,
    approved: primaryFlows.filter((f) => f.status === "approved").length,
    opportunities,
    unitsMoving: primaryFlows.filter((f) => f.status === "in_transit" || f.status === "approved").reduce((s, f) => s + f.quantity, 0),
    deliveredRecent: primaryFlows.filter((f) => f.status === "delivered").length,
  };

  const b = outline.length ? outline : pts;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of b) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const bounds: [number, number, number, number] = Number.isFinite(minX)
    ? [minX, minY, maxX, maxY]
    : [state.district.center[0] - 0.3, state.district.center[1] - 0.3, state.district.center[0] + 0.3, state.district.center[1] + 0.3];

  return { medicine, nowMs, facilities, facilityById, flows, spokes, outline, coverage: coverageCells, bounds, stats };
}

/** Human "3 h ago" / "2 d ago" relative to the simulated clock. */
export function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const diff = nowMs - new Date(iso).getTime();
  const h = diff / 3.6e6;
  if (h < 0) return "just now";
  if (h < 1) return `${Math.max(1, Math.round(diff / 6e4))} min ago`;
  if (h < 36) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function formatDays(days: number | null): string {
  if (days === null) return "—";
  if (!Number.isFinite(days)) return "∞";
  if (days < 10) return days.toFixed(1);
  return Math.round(days).toString();
}

export const TYPE_LABEL: Record<FacilityType, string> = {
  WAREHOUSE: "District warehouse",
  DH: "District hospital",
  CHC: "Community health centre",
  PHC: "Primary health centre",
};
