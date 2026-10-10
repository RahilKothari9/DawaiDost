import { describe, expect, it } from "vitest";
import { createInitialState } from "../../lib/district/data";
import type { DistrictState, Transfer } from "../../lib/district/types";
import { dispatchActions, keypadReportActions, receiptActions } from "../../lib/pharmacist/actions";
import { dispatchPlan, facilityChoices, inboxMessages, pharmacistView } from "../../lib/pharmacist/derive";
import { facilityHi, unitHi } from "../../lib/pharmacist/hindi";

const base = () => createInitialState();

function withTransfer(state: DistrictState, patch: Partial<Transfer>): { state: DistrictState; t: Transfer } {
  const t: Transfer = {
    id: "tr-test", medicineId: "metformin-500", fromId: "kalyanpur", toId: "saraswati", quantity: 45, status: "approved",
    distanceKm: 14, etaHours: 1.6, createdAt: state.now, updatedAt: state.now, approvedAt: state.now, ...patch,
  };
  return { state: { ...state, transfers: [t, ...state.transfers] }, t };
}

describe("pharmacist view", () => {
  it("shows Saraswati metformin as the most urgent low-stock row", () => {
    const v = pharmacistView(base(), "saraswati")!;
    expect(v.facility.name).toBe("Saraswati PHC");
    expect(v.low[0].medicine.id).toBe("metformin-500");
    expect(v.low[0].assessment.daysOfStock).toBe(2);
    expect(v.checkin.complete).toBe(true);
  });

  it("lists an approved outbound transfer as a dispatch request with the reserve kept", () => {
    const { state, t } = withTransfer(base(), {});
    const v = pharmacistView(state, "kalyanpur")!;
    expect(v.dispatch.map((d) => d.transfer.id)).toContain("tr-test");
    const plan = dispatchPlan(state, t)!;
    expect(plan.stockAfter).toBe(35);
    expect(plan.reserveUnits).toBe(35);
    expect(plan.keepsReserve).toBe(true);
    expect(facilityChoices(state).find((c) => c.facility.id === "kalyanpur")?.dispatch).toBe(1);
  });

  it("derives Hindi inbox messages for both ends of a transfer", () => {
    const { state } = withTransfer(base(), { status: "in_transit", dispatchedAt: base().now });
    const toMsgs = inboxMessages(state, "saraswati");
    expect(toMsgs.some((m) => m.task?.kind === "receive" && m.hi.includes("रास्ते में"))).toBe(true);
    const fromMsgs = inboxMessages(state, "kalyanpur");
    expect(fromMsgs.some((m) => m.hi.startsWith("दर्ज हुआ"))).toBe(true);
  });

  it("transliterates facility names and units", () => {
    expect(facilityHi({ id: "saraswati", name: "Saraswati PHC", type: "PHC" })).toBe("सरस्वती पीएचसी");
    expect(unitHi({ unit: "strip of 10 tablets" })).toBe("पत्ते");
  });
});

describe("pharmacist actions", () => {
  it("dispatch moves an approved transfer in transit with a pharmacist-attributed event", () => {
    const { state, t } = withTransfer(base(), {});
    const actions = dispatchActions(state, t);
    expect(actions[0]).toEqual({ type: "SET_TRANSFER_STATUS", transferId: "tr-test", status: "in_transit" });
    expect(actions[1].type === "ADD_TIMELINE" && actions[1].event.actor).toContain("S. Verma");
    expect(dispatchActions(state, { ...t, status: "in_transit" })).toEqual([]);
  });

  it("full receipt only delivers and logs", () => {
    const { state, t } = withTransfer(base(), { status: "in_transit", dispatchedAt: base().now });
    const actions = receiptActions(state, t, 45);
    expect(actions.map((a) => a.type)).toEqual(["SET_TRANSFER_STATUS"]);
  });

  it("short receipt sets the shelf to what arrived, logs a discrepancy and asks the donor to recount", () => {
    const { state, t } = withTransfer(base(), { status: "in_transit", dispatchedAt: base().now });
    const actions = receiptActions(state, t, 40);
    expect(actions.map((a) => a.type)).toEqual(["SET_TRANSFER_STATUS", "RECORD_VOICE_REPORT", "ADD_TIMELINE", "REQUEST_RECOUNT"]);
    const report = actions[1];
    expect(report.type === "RECORD_VOICE_REPORT" && report.report.count).toBe(16 + 40);
    const recount = actions[3];
    expect(recount.type === "REQUEST_RECOUNT" && recount.facilityId).toBe("kalyanpur");
  });

  it("keypad report is manual-sourced and flags out-of-range counts", () => {
    const s = base();
    const f = s.facilities.find((x) => x.id === "saraswati")!;
    const [ok] = keypadReportActions(s, f, "metformin-500", 16);
    expect(ok.type === "RECORD_VOICE_REPORT" && (ok.report as { reportSource?: string }).reportSource).toBe("manual");
    expect(ok.type === "RECORD_VOICE_REPORT" && ok.report.needsRecount).toBe(false);
    const [odd] = keypadReportActions(s, f, "metformin-500", 400);
    expect(odd.type === "RECORD_VOICE_REPORT" && odd.report.needsRecount).toBe(true);
  });
});
