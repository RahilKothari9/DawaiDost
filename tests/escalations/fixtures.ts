import type { DistrictState, Facility, Medicine, StockRecord, WeeklyPoint } from "../../lib/district/types";

export const NOW = "2026-10-10T09:42:00+05:30";

export const MED: Medicine = {
  id: "amlo", name: "Amlodipine", strength: "5 mg", unit: "strip", category: "hypertension",
  leadTimeDays: 7, safetyBufferDays: 4, reserveDays: 7,
  upstream: { status: "delayed", note: "Supplier missed consignment.", expectedOn: null },
};

const fac = (id: string, type: Facility["type"], pop: number, lat = 23, lng = 77): Facility => ({
  id, name: id.toUpperCase(), type, block: "B", lat, lng, pharmacist: { name: "X", phone: "0", language: "hi" }, catchmentPopulation: pop,
});

export const weeks = (n: number, closing: number[], received: number[] = [], dispensed = 70): WeeklyPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    weekOf: new Date(Date.UTC(2026, 6, 20) + i * 7 * 864e5).toISOString().slice(0, 10),
    closingStock: closing[i] ?? 100, dispensed, received: received[i] ?? 0,
  }));

export const rec = (facilityId: string, stock: number, dailyUse: number, extra: Partial<StockRecord> = {}): StockRecord => ({
  facilityId, medicineId: MED.id, stock, dailyUse, nearExpiry: null, lastReportAt: "2026-10-10T08:00:00+05:30",
  reportSource: "voice", verified: true, history: [], recountRequested: null, ...extra,
});

/** Three PHCs and a warehouse. Threshold = 11 days, surplus line = 18 days. */
export function makeState(stock: StockRecord[], overrides: Partial<DistrictState> = {}): DistrictState {
  return {
    district: { name: "Sehore", state: "Madhya Pradesh", center: [77, 23], zoom: 8, officer: { name: "Dr. A", title: "District Health Officer" } },
    medicines: [MED],
    facilities: [fac("wh", "WAREHOUSE", 1_000_000), fac("a", "PHC", 30000), fac("b", "PHC", 20000, 23.05), fac("c", "PHC", 25000, 23.1)],
    stock, transfers: [], decisions: [], timeline: [], selectedFacilityId: null, selectedMedicineId: MED.id, now: NOW, ...overrides,
  };
}
