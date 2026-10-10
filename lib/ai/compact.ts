// OWNER: ai agent. Compact, validated district state for server-side tools (ask, indent).
import { z } from "zod";
import type { DistrictState } from "../district/types";

/** Strip heavy fields before sending state to the server. History keeps the last 8 weeks. */
export function compactState(state: DistrictState) {
  return {
    district: state.district,
    now: state.now,
    medicines: state.medicines,
    facilities: state.facilities.map(({ id, name, type, block, lat, lng, catchmentPopulation, pharmacist }) => ({ id, name, type, block, lat, lng, catchmentPopulation, pharmacist: { name: pharmacist.name, language: pharmacist.language, phone: "" } })),
    stock: state.stock.map((s) => ({ ...s, history: (s.history ?? []).slice(-8) })),
    transfers: state.transfers.slice(0, 60),
    decisions: [],
    timeline: [],
    selectedFacilityId: state.selectedFacilityId,
    selectedMedicineId: state.selectedMedicineId,
  };
}
export type CompactState = ReturnType<typeof compactState>;

const n = z.number().finite();
const s = z.string().max(200);

export const compactStateSchema = z.object({
  district: z.object({ name: s, state: s, center: z.tuple([n, n]), zoom: n, officer: z.object({ name: s, title: s }) }),
  now: s,
  medicines: z.array(z.object({ id: s, name: s, strength: s, unit: s, category: s, leadTimeDays: n, safetyBufferDays: n, reserveDays: n, shortName: s.optional(), upstream: z.object({ status: z.enum(["available", "delayed", "unavailable"]), note: z.string().max(400), expectedOn: s.nullable().optional() }).optional() }).passthrough()).max(60),
  facilities: z.array(z.object({ id: s, name: s, type: z.enum(["WAREHOUSE", "DH", "CHC", "PHC"]), block: s, lat: n, lng: n, catchmentPopulation: n, pharmacist: z.object({ name: s, language: z.enum(["hi", "en"]), phone: s }) }).passthrough()).max(200),
  stock: z.array(z.object({
    facilityId: s, medicineId: s, stock: n, dailyUse: n,
    nearExpiry: z.object({ quantity: n, expiresOn: s }).nullable(),
    lastReportAt: s, reportSource: z.enum(["voice", "manual", "system"]), verified: z.boolean(),
    history: z.array(z.object({ weekOf: s, closingStock: n, dispensed: n, received: n.optional() })).max(16),
    recountRequested: z.object({ reason: s, at: s }).nullable().optional(),
  }).passthrough()).max(4000),
  transfers: z.array(z.object({ id: s, medicineId: s, fromId: s, toId: s, quantity: n, status: z.enum(["proposed", "approved", "in_transit", "delivered", "rejected"]), distanceKm: n, etaHours: n, createdAt: s, updatedAt: s }).passthrough()).max(200),
  decisions: z.array(z.unknown()).max(0).optional().default([]),
  timeline: z.array(z.unknown()).max(0).optional().default([]),
  selectedFacilityId: s.nullable().optional().default(null),
  selectedMedicineId: s.optional().default(""),
});

/** Parse a client-sent compact state into a DistrictState usable by the pure engine functions. */
export function parseCompactState(input: unknown): DistrictState | null {
  const r = compactStateSchema.safeParse(input);
  if (!r.success) return null;
  return r.data as unknown as DistrictState;
}
