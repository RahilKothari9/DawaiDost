// OWNER: escalations agent. District-wide supply-gap detection. Pure and deterministic: every number an
// escalation memo cites is computed here, never by a model.
import { assessStock, detectAnomaly, inboundUnits, istMidnightMs, outboundUnits, thresholdDays } from "../district/engine";
import type { DistrictState, Medicine, RiskLevel, UpstreamSupply } from "../district/types";

const DAY = 864e5;
const IST_OFFSET = 5.5 * 36e5;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Minimum days a state consignment needs to reach the district warehouse; a requested date never falls earlier. */
export const MIN_STATE_DISPATCH_DAYS = 3;
/** Routine replenishment asked for alongside the emergency quantity: one month of district consumption. */
export const REPLENISH_DAYS = 30;

export type GapStatus = "escalate" | "watch" | "indent" | "local" | "clear";

export const GAP_STATUS_ORDER: GapStatus[] = ["escalate", "watch", "indent", "local", "clear"];

export const GAP_STATUS_LABEL: Record<GapStatus, string> = {
  escalate: "Escalate to state",
  watch: "Watch upstream",
  indent: "Indent from warehouse",
  local: "Redistribute locally",
  clear: "Covered",
};

export type AffectedFacility = {
  facilityId: string;
  name: string;
  block: string;
  type: string;
  stock: number;
  dailyUse: number;
  daysOfStock: number | null;
  risk: RiskLevel;
  needUnits: number; // units to reach lead time + buffer, net of inbound open transfers
  population: number;
  projectedStockoutDate: string | null;
};

export type SupplyGap = {
  medicineId: string;
  medicine: Medicine;
  upstream: UpstreamSupply;
  asOf: string;
  leadTimeDays: number;
  thresholdDays: number;
  facilities: number; // reporting sites, excluding the warehouse
  totalDailyUse: number; // units/day across all sites
  siteStock: number; // usable units on facility shelves
  warehouseStock: number;
  pooledStock: number; // sites + warehouse
  siteCoverageDays: number | null; // siteStock / totalDailyUse
  pooledCoverageDays: number | null; // (siteStock + warehouse) / totalDailyUse
  warehouseCoverageDays: number | null;
  /** Units every below-threshold facility needs to reach lead time + buffer. */
  needUnits: number;
  /** Safe surplus held by verified, non-anomalous surplus sites above their reserve, net of open outbound transfers. */
  transferableUnits: number;
  donorFacilities: number;
  surplusApplied: number;
  warehouseApplied: number;
  /** Units still short after every local option (redistribution, then warehouse issue). */
  gapUnits: number;
  /** Units short of a district-wide lead time + buffer, pooled across sites and warehouse. */
  pooledShortUnits: number;
  redistributionCloses: boolean; // safe surplus alone covers every need
  localCloses: boolean; // surplus + warehouse cover every need
  affected: AffectedFacility[]; // facilities below threshold, most urgent first
  affectedPopulation: number;
  stockedOut: number;
  /** Days until all district stock is used even with perfect redistribution. */
  daysToDistrictStockout: number | null;
  districtStockoutDate: string | null;
  firstFacilityStockoutDate: string | null;
  /** Code-computed latest date a state consignment must arrive. */
  requestedDeliveryDate: string;
  emergencyUnits: number; // = gapUnits, rounded up
  replenishmentUnits: number; // one month of district use
  status: GapStatus;
  reasons: string[]; // short, plain-English evidence lines for the status
};

const isoDate = (msUtc: number) => new Date(msUtc + IST_OFFSET).toISOString().slice(0, 10);

export function computeSupplyGap(state: DistrictState, medicineId: string): SupplyGap | null {
  const medicine = state.medicines.find((m) => m.id === medicineId);
  if (!medicine) return null;
  const now = new Date(state.now).getTime();
  const facilities = new Map(state.facilities.map((f) => [f.id, f]));
  const records = state.stock.filter((r) => r.medicineId === medicineId);
  const sites = records.filter((r) => facilities.get(r.facilityId) && facilities.get(r.facilityId)!.type !== "WAREHOUSE");
  const warehouse = records.find((r) => facilities.get(r.facilityId)?.type === "WAREHOUSE");
  const threshold = thresholdDays(medicine);
  const upstream: UpstreamSupply = medicine.upstream ?? { status: "available", note: "No upstream issue recorded.", expectedOn: null };

  const totalDailyUse = round1(sites.reduce((s, r) => s + Math.max(0, r.dailyUse), 0));
  const siteStock = sites.reduce((s, r) => s + Math.max(0, r.stock), 0);
  const warehouseStock = Math.max(0, warehouse?.stock ?? 0);
  const pooledStock = siteStock + warehouseStock;
  const cover = (units: number) => (totalDailyUse > 0 ? round1(units / totalDailyUse) : null);

  const affected: AffectedFacility[] = [];
  let transferableUnits = 0;
  let donorFacilities = 0;
  for (const r of sites) {
    const f = facilities.get(r.facilityId)!;
    const a = assessStock(r, medicine, state.now);
    if (a.risk === "surplus" && r.verified && !r.recountRequested && !detectAnomaly(r).flagged) {
      const spare = Math.max(0, a.transferable - outboundUnits(state, r.facilityId, medicineId));
      if (spare > 0) {
        transferableUnits += spare;
        donorFacilities += 1;
      }
    }
    if (r.dailyUse <= 0) continue;
    const need = Math.max(0, Math.ceil(threshold * r.dailyUse - Math.max(0, r.stock) - inboundUnits(state, r.facilityId, medicineId)));
    if (need > 0 && a.daysOfStock < threshold) {
      affected.push({
        facilityId: f.id, name: f.name, block: f.block, type: f.type, stock: r.stock, dailyUse: r.dailyUse,
        daysOfStock: Number.isFinite(a.daysOfStock) ? round1(a.daysOfStock) : null, risk: a.risk, needUnits: need,
        population: f.catchmentPopulation, projectedStockoutDate: a.projectedStockoutDate,
      });
    }
  }
  affected.sort((x, y) => (x.daysOfStock ?? Infinity) - (y.daysOfStock ?? Infinity) || y.needUnits - x.needUnits);

  const needUnits = affected.reduce((s, a) => s + a.needUnits, 0);
  const surplusApplied = Math.min(needUnits, transferableUnits);
  const warehouseApplied = Math.min(needUnits - surplusApplied, warehouseStock);
  const gapUnits = Math.max(0, needUnits - surplusApplied - warehouseApplied);
  const pooledShortUnits = Math.max(0, Math.ceil(threshold * totalDailyUse - pooledStock));
  const pooledCoverageDays = cover(pooledStock);
  const warehouseCoverageDays = cover(warehouseStock);

  const daysToDistrictStockout = pooledCoverageDays;
  const districtStockoutDate = daysToDistrictStockout === null ? null : isoDate(now + daysToDistrictStockout * DAY);
  const firstFacilityStockoutDate = affected.map((a) => a.projectedStockoutDate).filter((d): d is string => !!d).sort()[0] ?? null;
  const daysAllowed = Math.max(MIN_STATE_DISPATCH_DAYS, Math.min(medicine.leadTimeDays, Math.floor(daysToDistrictStockout ?? medicine.leadTimeDays)));
  const requestedDeliveryDate = isoDate(now + daysAllowed * DAY);

  const reasons: string[] = [];
  const unit = medicine.unit;
  let status: GapStatus;
  if (needUnits === 0) {
    status = "clear";
    reasons.push(`Every facility holds at least ${threshold} days.`);
  } else if (gapUnits > 0 || upstream.status === "unavailable") {
    status = "escalate";
    if (gapUnits > 0) reasons.push(`${gapUnits} units (${unit}) short after all safe surplus and the warehouse are used.`);
    if (upstream.status === "unavailable") reasons.push("State supply line reported unavailable.");
  } else if (upstream.status === "delayed" || (warehouseCoverageDays ?? 0) < medicine.leadTimeDays) {
    status = "watch";
    if (upstream.status === "delayed") reasons.push("State consignment delayed.");
    if ((warehouseCoverageDays ?? 0) < medicine.leadTimeDays) reasons.push(`Warehouse holds ${warehouseCoverageDays ?? 0} days of district use, under the ${medicine.leadTimeDays}-day lead time.`);
  } else if (transferableUnits < needUnits) {
    status = "indent";
    reasons.push("Safe surplus does not cover every need; the warehouse can issue the rest.");
  } else {
    status = "local";
    reasons.push("Safe surplus at nearby facilities covers every need.");
  }
  if (!transferableUnits && needUnits > 0) reasons.push("No facility holds safe surplus above its reserve.");

  return {
    medicineId, medicine, upstream, asOf: state.now, leadTimeDays: medicine.leadTimeDays, thresholdDays: threshold,
    facilities: sites.length, totalDailyUse, siteStock, warehouseStock, pooledStock,
    siteCoverageDays: cover(siteStock), pooledCoverageDays, warehouseCoverageDays,
    needUnits, transferableUnits, donorFacilities, surplusApplied, warehouseApplied, gapUnits, pooledShortUnits,
    redistributionCloses: transferableUnits >= needUnits, localCloses: gapUnits === 0,
    affected, affectedPopulation: affected.reduce((s, a) => s + a.population, 0), stockedOut: affected.filter((a) => a.risk === "stockout").length,
    daysToDistrictStockout, districtStockoutDate, firstFacilityStockoutDate, requestedDeliveryDate,
    emergencyUnits: gapUnits, replenishmentUnits: Math.ceil(REPLENISH_DAYS * totalDailyUse),
    status, reasons,
  };
}

/** Every medicine, most severe first (status, then units short, then sooner district stockout). */
export function computeSupplyGaps(state: DistrictState): SupplyGap[] {
  return state.medicines
    .map((m) => computeSupplyGap(state, m.id))
    .filter((g): g is SupplyGap => g !== null)
    .sort((a, b) => GAP_STATUS_ORDER.indexOf(a.status) - GAP_STATUS_ORDER.indexOf(b.status)
      || b.gapUnits - a.gapUnits
      || (a.daysToDistrictStockout ?? Infinity) - (b.daysToDistrictStockout ?? Infinity));
}

/** Days from `now` to an ISO date (YYYY-MM-DD, IST midnight). */
export function daysUntil(isoDateStr: string, now: string): number {
  return round1((istMidnightMs(isoDateStr) - new Date(now).getTime()) / DAY);
}
