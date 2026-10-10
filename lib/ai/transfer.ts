// OWNER: ai agent. Turns an approved transfer_surplus decision into a concrete, reserve-safe Transfer.
// Prefers the engine's planTransfers; otherwise uses the Decisions API's donor choice and the facts' ranking.
import { haversineKm, planTransfers } from "../district/engine";
import type { DecisionRecord, DistrictState, Transfer } from "../district/types";
import { rankDonors } from "./facts";
import { isAiDecision } from "./types";

export function buildTransferForDecision(state: DistrictState, decision: DecisionRecord, nowIso: string): Transfer | null {
  const target = state.facilities.find((f) => f.id === decision.facilityId);
  const medicine = state.medicines.find((m) => m.id === decision.medicineId);
  const rec = state.stock.find((s) => s.facilityId === decision.facilityId && s.medicineId === decision.medicineId);
  if (!target || !medicine || !rec) return null;
  const chosen = isAiDecision(decision) ? decision.ai.donor?.facilityId ?? null : null;

  let planned: Transfer[] = [];
  try {
    planned = planTransfers(state, medicine.id).filter((t) => t.toId === target.id);
  } catch {
    planned = [];
  }
  const fromPlan = (chosen && planned.find((t) => t.fromId === chosen)) || (!chosen ? planned[0] : undefined);
  if (fromPlan) return { ...fromPlan, id: `tr-${decision.id}`, status: "proposed", decisionId: decision.id, createdAt: nowIso, updatedAt: nowIso, reason: fromPlan.reason ?? "Decisions API recommendation" };

  const threshold = medicine.leadTimeDays + medicine.safetyBufferDays;
  const gap = Math.max(0, Math.ceil(threshold * rec.dailyUse - rec.stock));
  const donors = rankDonors(state, target, medicine, gap);
  const donor = (chosen && donors.find((d) => d.facilityId === chosen)) || donors[0];
  if (!donor) return null;
  const from = state.facilities.find((f) => f.id === donor.facilityId)!;
  const quantity = Math.max(1, Math.min(donor.transferable, gap || donor.transferable));
  const km = Math.round(haversineKm(from, target) * 10) / 10;
  return {
    id: `tr-${decision.id}`,
    medicineId: medicine.id,
    fromId: from.id,
    toId: target.id,
    quantity,
    status: "proposed",
    distanceKm: km,
    etaHours: Math.round((km / 30 + 2) * 10) / 10,
    createdAt: nowIso,
    updatedAt: nowIso,
    decisionId: decision.id,
    reason: chosen ? "Donor chosen by the Decisions API" : "Nearest reserve-safe donor",
  };
}
