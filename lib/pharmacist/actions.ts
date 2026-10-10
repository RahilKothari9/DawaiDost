// Composes existing district store actions for pharmacist-side events. Pure: returns the actions to dispatch, in order.
import { expectedRange } from "../voice/facts";
import type { DistrictAction, DistrictState, Facility, StockRecord, Transfer, VoiceReport } from "../district/types";
import { pharmacistActor, shortfallEventId } from "./derive";
import { unitEn } from "./hindi";

/** VoiceReport plus the source hint the reducer should store on the StockRecord (keypad = "manual"). */
export type PharmacistReport = VoiceReport & { reportSource: StockRecord["reportSource"] };

const stamp = (state: DistrictState) => Date.parse(state.now).toString(36);

function lookup(state: DistrictState, t: Transfer) {
  const m = state.medicines.find((x) => x.id === t.medicineId);
  const from = state.facilities.find((f) => f.id === t.fromId);
  const to = state.facilities.find((f) => f.id === t.toId);
  return { m, from, to, label: m ? `${m.name} ${m.strength}` : t.medicineId };
}

/** Plausibility check for a keypad count, using the same range the voice agent uses. */
export function checkCount(state: DistrictState, facilityId: string, medicineId: string, count: number) {
  const rec = state.stock.find((r) => r.facilityId === facilityId && r.medicineId === medicineId);
  if (!rec) return { plausible: true, expected: null as number | null, min: 0, max: 0 };
  const r = expectedRange(rec, state.now);
  return { plausible: count >= r.expectedMin && count <= r.expectedMax, expected: r.expected, min: r.expectedMin, max: r.expectedMax };
}

export function keypadReportActions(
  state: DistrictState,
  facility: Facility,
  medicineId: string,
  count: number,
  opts: { confirmedOutOfRange?: boolean; answeringRecount?: boolean } = {},
): DistrictAction[] {
  const m = state.medicines.find((x) => x.id === medicineId);
  const check = checkCount(state, facility.id, medicineId, count);
  const flagged = !check.plausible && !opts.answeringRecount;
  const report: PharmacistReport = {
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
  return [{ type: "RECORD_VOICE_REPORT", report, actor: `${facility.pharmacist.name} (pharmacist, keypad)` }];
}

/** Donor pharmacist: "Packed and handed to vehicle". */
export function dispatchActions(state: DistrictState, t: Transfer): DistrictAction[] {
  if (t.status !== "approved") return [];
  const { m, from, to, label } = lookup(state, t);
  if (!from || !to) return [];
  const rec = state.stock.find((r) => r.facilityId === t.fromId && r.medicineId === t.medicineId);
  const left = rec ? Math.max(0, rec.stock - t.quantity) : null;
  const days = rec && rec.dailyUse > 0 && left !== null ? (left / rec.dailyUse).toFixed(1) : null;
  return [
    { type: "SET_TRANSFER_STATUS", transferId: t.id, status: "in_transit" },
    {
      type: "ADD_TIMELINE",
      event: {
        id: `ph-dispatch-${stamp(state)}-${t.id}`,
        at: state.now,
        kind: "transfer_update",
        facilityId: t.toId,
        medicineId: t.medicineId,
        title: `Packed and handed to vehicle at ${from.name}: ${t.quantity} ${unitEn(m, t.quantity)} ${label} for ${to.name}`,
        detail: `Confirmed by the pharmacist on the clinic phone.${left !== null ? ` ${from.name} keeps ${left} ${unitEn(m, left)}${days ? ` (${days} days)` : ""}.` : ""} ETA ${t.etaHours} h.`,
        actor: pharmacistActor(from),
      },
    },
  ];
}

/**
 * Recipient pharmacist: "Received" with a counted quantity. Delivers the transfer; on a mismatch the shelf is set to
 * what actually arrived, a discrepancy is logged, and the donor is asked to recount.
 */
export function receiptActions(state: DistrictState, t: Transfer, received: number): DistrictAction[] {
  if (t.status !== "in_transit") return [];
  const { m, from, to, label } = lookup(state, t);
  if (!from || !to) return [];
  const actor = pharmacistActor(to);
  // The reducer logs "Delivered" attributed to the recipient pharmacist; only a mismatch adds events here.
  const before = state.stock.find((r) => r.facilityId === t.toId && r.medicineId === t.medicineId)?.stock ?? 0;
  const diff = received - t.quantity;
  const u = (n: number) => unitEn(m, n);
  const actions: DistrictAction[] = [
    { type: "SET_TRANSFER_STATUS", transferId: t.id, status: "delivered" },
  ];
  if (diff !== 0) {
    const gap = Math.abs(diff);
    const report: PharmacistReport = {
      facilityId: t.toId,
      medicineId: t.medicineId,
      count: before + received,
      unit: m?.unit ?? "units",
      confidence: 1,
      transcript: `Receipt count on keypad: ${received} of ${t.quantity} ${u(t.quantity)} arrived. Shelf ${before} + ${received} = ${before + received}.`,
      language: "hi",
      needsRecount: false,
      reportSource: "manual",
    };
    actions.push(
      { type: "RECORD_VOICE_REPORT", report, actor: `${to.pharmacist.name} (pharmacist, receipt count)` },
      {
        type: "ADD_TIMELINE",
        event: {
          id: shortfallEventId(t.id, received, state.now),
          at: state.now,
          kind: "alert",
          facilityId: t.toId,
          medicineId: t.medicineId,
          title: diff < 0
            ? `Consignment short: ${to.name} received ${received} of ${t.quantity} ${u(t.quantity)} ${label}`
            : `Consignment over: ${to.name} received ${received}, ${gap} more than the ${t.quantity} dispatched`,
          detail: `${gap} ${u(gap)} unaccounted between ${from.name} and ${to.name}. Stock set to the counted amount; ${from.name} asked to recount.`,
          actor,
        },
      },
      {
        type: "REQUEST_RECOUNT",
        facilityId: t.fromId,
        medicineId: t.medicineId,
        reason: diff < 0
          ? `${to.name} received ${received} of ${t.quantity} ${u(t.quantity)}. Check whether ${gap} are still on your shelf.`
          : `${to.name} received ${gap} more than the ${t.quantity} dispatched. Recount your shelf.`,
      },
    );
  }
  return actions;
}
