// Store actions for pharmacist-side events. Pure: returns the actions to dispatch, in order.
import { expectedRange } from "../voice/facts";
import type { DistrictAction, DistrictState, Facility, Transfer, VoiceReport } from "../district/types";
import { pharmacistActor } from "./derive";
import { unitEn } from "./hindi";

/** Plausibility check for a keypad count, using the same range the voice agent uses. */
export function checkCount(state: DistrictState, facilityId: string, medicineId: string, count: number) {
  const rec = state.stock.find((r) => r.facilityId === facilityId && r.medicineId === medicineId);
  if (!rec) return { plausible: true, expected: null as number | null, min: 0, max: 0 };
  const r = expectedRange(rec, state.now);
  return { plausible: count >= r.expectedMin && count <= r.expectedMax, expected: r.expected, min: r.expectedMin, max: r.expectedMax };
}

/** Keypad shelf count, read back and confirmed by the pharmacist. Stored with reportSource "manual". */
export function keypadReportActions(
  state: DistrictState,
  facility: Facility,
  medicineId: string,
  count: number,
  opts: { answeringRecount?: boolean } = {},
): DistrictAction[] {
  const m = state.medicines.find((x) => x.id === medicineId);
  const check = checkCount(state, facility.id, medicineId, count);
  const flagged = !check.plausible && !opts.answeringRecount;
  const report: VoiceReport = {
    facilityId: facility.id,
    medicineId,
    count,
    unit: m?.unit ?? "units",
    confidence: 1,
    transcript: `Keypad entry${opts.answeringRecount ? " (recount)" : ""}: ${count} ${unitEn(m, count)}. Read back and confirmed by the pharmacist.`,
    language: "hi",
    needsRecount: flagged,
    reason: flagged ? `Keypad count ${count} is outside the expected ${check.min}–${check.max}; pharmacist confirmed it on read-back.` : undefined,
    reportSource: "manual",
  };
  return [{ type: "RECORD_VOICE_REPORT", report, actor: `${facility.pharmacist.name} (pharmacist, keypad)`, reportSource: "manual" }];
}

/** Donor pharmacist: "Packed and handed to vehicle" — in transit, credited to the pharmacist. */
export function dispatchActions(state: DistrictState, t: Transfer): DistrictAction[] {
  if (t.status !== "approved") return [];
  const from = state.facilities.find((f) => f.id === t.fromId);
  if (!from) return [];
  return [{ type: "SET_TRANSFER_STATUS", transferId: t.id, status: "in_transit", actor: pharmacistActor(from) }];
}

/**
 * Recipient pharmacist: "Received" with the counted quantity. The store delivers only what was counted and, on a
 * shortfall, logs the alert and asks the donor to recount.
 */
export function receiptActions(state: DistrictState, t: Transfer, received: number): DistrictAction[] {
  if (t.status !== "in_transit") return [];
  const to = state.facilities.find((f) => f.id === t.toId);
  if (!to) return [];
  return [{ type: "CONFIRM_RECEIPT", transferId: t.id, receivedQty: Math.max(0, Math.min(t.quantity, Math.round(received))), actor: pharmacistActor(to) }];
}
