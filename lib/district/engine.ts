// OWNER: data agent. Pure, deterministic stock math. Signatures are the shared contract; bodies may be improved.
import type { DistrictState, Facility, Medicine, StockAssessment, StockRecord, Transfer } from "./types";

export function haversineKm(a: Pick<Facility, "lat" | "lng">, b: Pick<Facility, "lat" | "lng">): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function assessStock(record: StockRecord, medicine: Medicine, now: string): StockAssessment {
  const days = record.dailyUse <= 0 ? Infinity : record.stock / record.dailyUse;
  const threshold = medicine.leadTimeDays + medicine.safetyBufferDays;
  const transferable = Math.max(0, Math.floor(record.stock - record.dailyUse * medicine.reserveDays));
  const risk = record.stock <= 0 ? "stockout" : days < medicine.leadTimeDays ? "critical" : days < threshold ? "low" : days > threshold * 2 && transferable > 0 ? "surplus" : "ok";
  const out = Number.isFinite(days) ? new Date(new Date(now).getTime() + days * 864e5).toISOString().slice(0, 10) : null;
  return { facilityId: record.facilityId, medicineId: record.medicineId, daysOfStock: days, thresholdDays: threshold, risk, projectedStockoutDate: out, transferable, gapUnits: Math.max(0, Math.ceil(threshold * record.dailyUse - record.stock)) };
}

export function assessDistrict(state: DistrictState): StockAssessment[] {
  return state.stock.map((r) => assessStock(r, state.medicines.find((m) => m.id === r.medicineId)!, state.now));
}

/** Greedy, reserve-preserving transfer proposals for one medicine (status "proposed"). */
export function planTransfers(_state: DistrictState, _medicineId: string): Transfer[] {
  return [];
}

/** Daily projected stock for the next `days` days. */
export function forecastSeries(record: StockRecord, days: number, now: string): { date: string; stock: number }[] {
  return Array.from({ length: days + 1 }, (_, i) => ({ date: new Date(new Date(now).getTime() + i * 864e5).toISOString().slice(0, 10), stock: Math.max(0, record.stock - record.dailyUse * i) }));
}

/** Facts-only snapshot for the Decisions API about one facility + medicine. */
export function buildDistrictSnapshot(state: DistrictState, facilityId: string, medicineId: string): Record<string, unknown> {
  return { facilityId, medicineId };
}
