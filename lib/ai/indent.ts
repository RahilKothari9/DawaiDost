// OWNER: ai agent. Consumption-based indent quantities. Pure code: the model only writes the justification text.
// required = avgDailyUse × (leadTime + buffer + reviewPeriod) − stock − inbound
import type { DistrictState } from "../district/types";
import type { IndentLine } from "./types";

export const DEFAULT_REVIEW_DAYS = 30;
const OPEN = ["proposed", "approved", "in_transit"];
const r1 = (x: number) => Math.round(x * 10) / 10;

export function computeIndentLines(state: DistrictState, facilityId: string, opts: { reviewPeriodDays?: number; medicineIds?: string[] } = {}): IndentLine[] {
  const review = opts.reviewPeriodDays ?? DEFAULT_REVIEW_DAYS;
  const lines: IndentLine[] = [];
  for (const rec of state.stock) {
    if (rec.facilityId !== facilityId) continue;
    if (opts.medicineIds && !opts.medicineIds.includes(rec.medicineId)) continue;
    const med = state.medicines.find((m) => m.id === rec.medicineId);
    if (!med) continue;
    const hist = (rec.history ?? []).filter((p) => Number.isFinite(p.dispensed));
    const ledger = hist.length >= 3 ? hist.slice(-8).reduce((s, p) => s + p.dispensed, 0) / (Math.min(8, hist.length) * 7) : null;
    const avg = ledger !== null && ledger > 0 ? ledger : rec.dailyUse;
    const inbound = state.transfers.filter((t) => t.toId === facilityId && t.medicineId === med.id && OPEN.includes(t.status)).reduce((s, t) => s + t.quantity, 0);
    const cover = med.leadTimeDays + med.safetyBufferDays + review;
    const required = Math.max(0, Math.ceil(avg * cover - rec.stock - inbound));
    if (required <= 0) continue;
    lines.push({
      medicineId: med.id, name: med.name, strength: med.strength, unit: med.unit,
      avgDailyUse: r1(avg), basis: ledger !== null && ledger > 0 ? "ledger" : "reported",
      leadTimeDays: med.leadTimeDays, bufferDays: med.safetyBufferDays, reviewDays: review, coverDays: cover,
      stock: rec.stock, inbound, required,
      daysOfStock: rec.dailyUse > 0 ? r1(rec.stock / rec.dailyUse) : null,
      justification: templateJustification({ name: med.name, strength: med.strength, unit: med.unit, avg: r1(avg), basis: ledger !== null && ledger > 0 ? "ledger" : "reported", cover, stock: rec.stock, inbound, required, days: rec.dailyUse > 0 ? r1(rec.stock / rec.dailyUse) : null }),
    });
  }
  // most urgent first
  return lines.sort((a, b) => (a.daysOfStock ?? 1e9) - (b.daysOfStock ?? 1e9));
}

export function templateJustification(x: { name: string; strength: string; unit: string; avg: number; basis: "ledger" | "reported"; cover: number; stock: number; inbound: number; required: number; days: number | null }): string {
  const basis = x.basis === "ledger" ? "8-week dispensing ledger" : "reported daily use";
  return `${x.avg} ${x.unit}/day (${basis}) × ${x.cover} days cover = ${Math.round(x.avg * x.cover)}; less ${x.stock} on shelf${x.inbound ? ` and ${x.inbound} inbound` : ""} → ${x.required} ${x.unit}.${x.days !== null ? ` Current stock lasts ${x.days} days.` : ""}`;
}
