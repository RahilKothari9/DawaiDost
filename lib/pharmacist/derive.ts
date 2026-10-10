// Pure selectors for the pharmacist surface: what one clinic needs to see and do right now.
import { AT_RISK, assessStock, reserveUnits, transferArrivalAt, weekStart, istMidnightMs } from "../district/engine";
import type { DistrictState, Facility, Medicine, StockAssessment, StockRecord, Transfer } from "../district/types";
import { facilityHi, medicineHi, placeHi, unitEn, unitHi, hoursEn, hoursHi } from "./hindi";

const HOUR = 36e5;
const ms = (iso: string) => Date.parse(iso);

export type StockRow = { record: StockRecord; medicine: Medicine; assessment: StockAssessment; inbound: number };

export type DispatchPlan = {
  transfer: Transfer;
  medicine: Medicine;
  to: Facility;
  stockNow: number;
  stockAfter: number;
  daysAfter: number | null;
  reserveUnits: number;
  keepsReserve: boolean;
};

export type IncomingRow = { transfer: Transfer; medicine: Medicine; from: Facility; arrivalAt: string; hoursLeft: number };

export type CheckinStatus = { weekOf: string; done: number; total: number; complete: boolean; lastAt: string | null; pending: StockRow[] };

export type PharmacistView = {
  facility: Facility;
  rows: StockRow[];
  low: StockRow[];
  checkin: CheckinStatus;
  dispatch: DispatchPlan[];
  outgoingInTransit: IncomingRow[];
  incoming: IncomingRow[];
  recounts: StockRow[];
  taskCount: number;
};

export const PHARMACIST_FACILITY_TYPES: Facility["type"][] = ["PHC", "CHC", "DH"];

export function pharmacistActor(f: Facility): string {
  return `${f.pharmacist.name} (pharmacist, ${f.name})`;
}

export function stockRows(state: DistrictState, facilityId: string): StockRow[] {
  const meds = new Map(state.medicines.map((m) => [m.id, m]));
  return state.stock
    .filter((r) => r.facilityId === facilityId)
    .flatMap((record) => {
      const medicine = meds.get(record.medicineId);
      if (!medicine) return [];
      const inbound = state.transfers
        .filter((t) => t.toId === facilityId && t.medicineId === record.medicineId && (t.status === "approved" || t.status === "in_transit"))
        .reduce((s, t) => s + t.quantity, 0);
      return [{ record, medicine, assessment: assessStock(record, medicine, state.now), inbound }];
    });
}

export function dispatchPlan(state: DistrictState, t: Transfer): DispatchPlan | null {
  const medicine = state.medicines.find((m) => m.id === t.medicineId);
  const to = state.facilities.find((f) => f.id === t.toId);
  const rec = state.stock.find((r) => r.facilityId === t.fromId && r.medicineId === t.medicineId);
  if (!medicine || !to || !rec) return null;
  const stockAfter = Math.max(0, rec.stock - t.quantity);
  const reserve = Math.ceil(reserveUnits(rec, medicine));
  return {
    transfer: t, medicine, to, stockNow: rec.stock, stockAfter,
    daysAfter: rec.dailyUse > 0 ? Math.round((stockAfter / rec.dailyUse) * 10) / 10 : null,
    reserveUnits: reserve, keepsReserve: stockAfter >= reserve,
  };
}

function incomingRow(state: DistrictState, t: Transfer, otherId: string): IncomingRow | null {
  const medicine = state.medicines.find((m) => m.id === t.medicineId);
  const from = state.facilities.find((f) => f.id === otherId);
  if (!medicine || !from) return null;
  const arrivalAt = transferArrivalAt(t);
  return { transfer: t, medicine, from, arrivalAt, hoursLeft: Math.max(0, (ms(arrivalAt) - ms(state.now)) / HOUR) };
}

export function checkinStatus(state: DistrictState, rows: StockRow[]): CheckinStatus {
  const weekOf = weekStart(state.now);
  const startMs = istMidnightMs(weekOf);
  const reported = rows.filter((r) => ms(r.record.lastReportAt) >= startMs && r.record.reportSource !== "system");
  const lastAt = rows.reduce<string | null>((acc, r) => (!acc || ms(r.record.lastReportAt) > ms(acc) ? r.record.lastReportAt : acc), null);
  const pending = rows.filter((r) => !reported.includes(r));
  return { weekOf, done: reported.length, total: rows.length, complete: rows.length > 0 && pending.length === 0, lastAt, pending };
}

export function pharmacistView(state: DistrictState, facilityId: string): PharmacistView | null {
  const facility = state.facilities.find((f) => f.id === facilityId);
  if (!facility) return null;
  const rows = stockRows(state, facilityId);
  const low = rows
    .filter((r) => AT_RISK.includes(r.assessment.risk))
    .sort((a, b) => a.assessment.daysOfStock - b.assessment.daysOfStock);
  const dispatch = state.transfers
    .filter((t) => t.fromId === facilityId && t.status === "approved")
    .flatMap((t) => dispatchPlan(state, t) ?? []);
  const outgoingInTransit = state.transfers
    .filter((t) => t.fromId === facilityId && t.status === "in_transit")
    .flatMap((t) => incomingRow(state, t, t.toId) ?? []);
  const incoming = state.transfers
    .filter((t) => t.toId === facilityId && (t.status === "approved" || t.status === "in_transit"))
    .flatMap((t) => incomingRow(state, t, t.fromId) ?? [])
    .sort((a, b) => Number(b.transfer.status === "in_transit") - Number(a.transfer.status === "in_transit") || a.hoursLeft - b.hoursLeft);
  const recounts = rows.filter((r) => r.record.recountRequested);
  const receivable = incoming.filter((i) => i.transfer.status === "in_transit").length;
  const checkin = checkinStatus(state, rows);
  return {
    facility, rows, low, checkin, dispatch, outgoingInTransit, incoming, recounts,
    taskCount: dispatch.length + receivable + recounts.length + (checkin.complete ? 0 : 1),
  };
}

/** Facilities a demo viewer can impersonate, with open task counts so the right one is easy to pick. */
export function facilityChoices(state: DistrictState) {
  return state.facilities
    .filter((f) => PHARMACIST_FACILITY_TYPES.includes(f.type))
    .map((f) => {
      const dispatch = state.transfers.filter((t) => t.fromId === f.id && t.status === "approved").length;
      const receive = state.transfers.filter((t) => t.toId === f.id && t.status === "in_transit").length;
      const recount = state.stock.filter((r) => r.facilityId === f.id && r.recountRequested).length;
      return { facility: f, dispatch, receive, recount, tasks: dispatch + receive + recount };
    });
}

// ---------- Inbox ----------

export type MessageTone = "info" | "action" | "done" | "warn";
export type InboxMessage = {
  id: string;
  at: string;
  channel: "sms" | "whatsapp";
  tone: MessageTone;
  hi: string;
  en: string;
  task?: { kind: "dispatch" | "receive" | "recount"; id: string };
};

export function inboxMessages(state: DistrictState, facilityId: string): InboxMessage[] {
  const facilities = new Map(state.facilities.map((f) => [f.id, f]));
  const meds = new Map(state.medicines.map((m) => [m.id, m]));
  const out: InboxMessage[] = [];

  for (const t of state.transfers) {
    if (t.fromId !== facilityId && t.toId !== facilityId) continue;
    const m = meds.get(t.medicineId);
    const from = facilities.get(t.fromId);
    const to = facilities.get(t.toId);
    const qHi = `${t.quantity} ${unitHi(m, t.quantity)} ${medicineHi(m)}`;
    const qEn = `${t.quantity} ${unitEn(m, t.quantity)} of ${m?.name ?? t.medicineId}`;
    const incoming = t.toId === facilityId;
    const approvedAt = t.approvedAt ?? (t.status !== "proposed" && t.status !== "rejected" ? t.updatedAt : undefined);
    if (approvedAt && t.status !== "rejected") {
      out.push(incoming
        ? { id: `${t.id}-a`, at: approvedAt, channel: "whatsapp", tone: "info",
            hi: `जिला कार्यालय ने मंज़ूरी दी: ${placeHi(from)} से ${qHi} आपके लिए आएगा। गाड़ी निकलते ही सूचना मिलेगी।`,
            en: `District approved ${qEn} from ${from?.name}. You will be told when the vehicle leaves.` }
        : { id: `${t.id}-a`, at: approvedAt, channel: "whatsapp", tone: t.status === "approved" ? "action" : "info",
            hi: `भेजने का अनुरोध: ${qHi} ${facilityHi(to)} के लिए पैक करें। आपका ज़रूरी स्टॉक आपके पास रहेगा।`,
            en: `Dispatch request: pack ${qEn} for ${to?.name}. Your own reserve stays with you.`,
            task: t.status === "approved" ? { kind: "dispatch", id: t.id } : undefined });
    }
    if (t.dispatchedAt) {
      const arrival = transferArrivalAt(t);
      const h = Math.max(0, (ms(arrival) - ms(t.dispatchedAt)) / HOUR);
      out.push(incoming
        ? { id: `${t.id}-d`, at: t.dispatchedAt, channel: "sms", tone: t.status === "in_transit" ? "action" : "info",
            hi: `${qHi} रास्ते में है। ${hoursHi(h)} में पहुँचेगा। पहुँचने पर गिनकर "मिल गया" दबाएँ।`,
            en: `${qEn} is on the way, arriving in ${hoursEn(h)}. Count it and tap "Received" when it arrives.`,
            task: t.status === "in_transit" ? { kind: "receive", id: t.id } : undefined }
        : { id: `${t.id}-d`, at: t.dispatchedAt, channel: "sms", tone: "done",
            hi: `दर्ज हुआ: ${qHi} ${facilityHi(to)} के लिए रवाना।`,
            en: `Recorded: ${qEn} dispatched to ${to?.name}.` });
    }
    if (t.deliveredAt) {
      const got = t.receivedQuantity ?? t.quantity;
      const short = t.quantity - got;
      const gotHi = `${got} ${unitHi(m, got)} ${medicineHi(m)}`;
      const id = `${t.id}-r`;
      if (incoming) {
        out.push(short > 0
          ? { id, at: t.deliveredAt, channel: "sms", tone: "warn",
              hi: `प्राप्ति दर्ज: ${gotHi} आपके स्टॉक में जुड़ा। ${short} ${unitHi(m, short)} कम आए — जिला कार्यालय जाँच करेगा।`,
              en: `Receipt recorded: ${got} of ${t.quantity} added to your stock. ${short} short; the district office will follow up.` }
          : { id, at: t.deliveredAt, channel: "sms", tone: "done",
              hi: `प्राप्ति दर्ज: ${placeHi(from)} से ${gotHi} आपके स्टॉक में जुड़ गया।`,
              en: `Receipt recorded: ${got} ${unitEn(m, got)} of ${m?.name} from ${from?.name} added to your stock.` });
      } else {
        out.push(short > 0
          ? { id, at: t.deliveredAt, channel: "sms", tone: "warn",
              hi: `${facilityHi(to)} को ${t.quantity} में से ${got} ही मिले। कृपया अपनी अलमारी दोबारा गिनें।`,
              en: `${to?.name} counted ${got} of the ${t.quantity} you sent. Please recount your shelf.` }
          : { id, at: t.deliveredAt, channel: "sms", tone: "done",
              hi: `${facilityHi(to)} ने आपका भेजा ${medicineHi(m)} प्राप्त कर लिया। धन्यवाद।`,
              en: `${to?.name} received the ${m?.name} you sent. Thank you.` });
      }
    }
  }

  for (const e of state.timeline) {
    if (e.facilityId !== facilityId) continue;
    const m = e.medicineId ? meds.get(e.medicineId) : undefined;
    switch (e.kind) {
      case "voice_report": {
        const n = /reported (\d+)/i.exec(e.title)?.[1] ?? /(\d+)\s+(strips?|sachets?|inhalers?)/i.exec(e.title)?.[1];
        out.push({ id: e.id, at: e.at, channel: "sms", tone: "done",
          hi: n ? `गिनती मिल गई: ${medicineHi(m)} ${n} ${unitHi(m, Number(n))}। धन्यवाद।` : `${medicineHi(m)} की गिनती मिल गई। धन्यवाद।`,
          en: n ? `Count received: ${m?.name ?? "medicine"} ${n} ${unitEn(m, Number(n))}. Thank you.` : `Count received for ${m?.name ?? "medicine"}. Thank you.` });
        break;
      }
      case "recount_requested": {
        const open = state.stock.some((r) => r.facilityId === facilityId && r.medicineId === e.medicineId && r.recountRequested);
        out.push({ id: e.id, at: e.at, channel: "sms", tone: open ? "action" : "info",
          hi: `कृपया ${medicineHi(m)} दोबारा गिनें और नई गिनती भेजें।`,
          en: `Please recount ${m?.name ?? "this medicine"} and send the new count.${e.detail ? ` ${e.detail}` : ""}`,
          task: open && e.medicineId ? { kind: "recount", id: e.medicineId } : undefined });
        break;
      }
      case "count_verified":
        out.push({ id: e.id, at: e.at, channel: "sms", tone: "done", hi: `${medicineHi(m)} की दोबारा गिनती पक्की हो गई।`, en: `${m?.name ?? "Recount"} verified.` });
        break;
      case "indent":
        out.push({ id: e.id, at: e.at, channel: "sms", tone: "info", hi: `${medicineHi(m)} के लिए जिला भंडार को माँग-पत्र (इंडेंट) भेजा गया।`, en: `Indent for ${m?.name ?? "medicine"} sent to the district warehouse.` });
        break;
      case "escalation":
        out.push({ id: e.id, at: e.at, channel: "sms", tone: "info", hi: `${medicineHi(m)} की कमी राज्य स्तर पर उठाई गई है।`, en: `${m?.name ?? "Medicine"} shortage raised to the state.` });
        break;
      default:
        break;
    }
  }

  // Weekly reminder when this week's count is still missing.
  const rows = stockRows(state, facilityId);
  const status = checkinStatus(state, rows);
  if (!status.complete && rows.length) {
    const at = new Date(Math.min(istMidnightMs(status.weekOf) + 9 * HOUR, ms(state.now))).toISOString();
    out.push({ id: `checkin-${status.weekOf}`, at, channel: "sms", tone: "action",
      hi: `इस हफ़्ते की गिनती बाकी है (${status.pending.length} दवाइयाँ)। कॉल का जवाब दें या ऐप में लिखें।`,
      en: `This week's count is pending (${status.pending.length} medicines). Answer the call or enter it in the app.` });
  }

  return out.sort((a, b) => ms(b.at) - ms(a.at));
}
