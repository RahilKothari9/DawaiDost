// OWNER: data agent. Minimal placeholder seed; will be replaced by the full synthetic Sehore network.
import type { DistrictState } from "./types";

export const SEED_NOW = "2026-10-10T09:42:00+05:30";

export function createInitialState(): DistrictState {
  return {
    district: { name: "Sehore", state: "Madhya Pradesh", center: [77.085, 23.2], zoom: 9.2, officer: { name: "Dr. Ananya Rao", title: "District Health Officer" } },
    medicines: [{ id: "metformin-500", name: "Metformin", strength: "500 mg", unit: "strip", category: "diabetes", leadTimeDays: 5, safetyBufferDays: 3, reserveDays: 7 }],
    facilities: [
      { id: "saraswati", name: "Saraswati PHC", type: "PHC", block: "Sehore", lat: 23.25, lng: 77.0, pharmacist: { name: "R. Mishra", phone: "+91 90000 00001", language: "hi" }, catchmentPopulation: 30000 },
      { id: "kalyanpur", name: "Kalyanpur PHC", type: "PHC", block: "Ashta", lat: 23.1, lng: 77.2, pharmacist: { name: "S. Verma", phone: "+91 90000 00002", language: "hi" }, catchmentPopulation: 28000 },
      { id: "rampur", name: "Rampur PHC", type: "PHC", block: "Ichhawar", lat: 23.0, lng: 77.0, pharmacist: { name: "K. Yadav", phone: "+91 90000 00003", language: "hi" }, catchmentPopulation: 25000 },
    ],
    stock: [
      { facilityId: "saraswati", medicineId: "metformin-500", stock: 16, dailyUse: 8, nearExpiry: null, lastReportAt: SEED_NOW, reportSource: "voice", verified: true, history: [] },
      { facilityId: "kalyanpur", medicineId: "metformin-500", stock: 80, dailyUse: 5, nearExpiry: null, lastReportAt: SEED_NOW, reportSource: "voice", verified: true, history: [] },
      { facilityId: "rampur", medicineId: "metformin-500", stock: 9, dailyUse: 6, nearExpiry: null, lastReportAt: SEED_NOW, reportSource: "voice", verified: true, history: [] },
    ],
    transfers: [],
    decisions: [],
    timeline: [],
    selectedFacilityId: "saraswati",
    selectedMedicineId: "metformin-500",
    now: SEED_NOW,
  };
}
