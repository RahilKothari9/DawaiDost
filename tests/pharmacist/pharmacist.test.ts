import { describe, expect, it } from "vitest";
import { createInitialState } from "../../lib/district/data";
import type { DistrictState, Transfer } from "../../lib/district/types";
import { districtReducer } from "../../lib/district/store";
import type { DistrictAction } from "../../lib/district/types";
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

const run = (state: DistrictState, actions: DistrictAction[]) => actions.reduce(districtReducer, state);
const stockOf = (s: DistrictState, f: string, m = "metformin-500") => s.stock.find((r) => r.facilityId === f && r.medicineId === m)!;

describe("pharmacist actions (through the district reducer)", () => {
  it("dispatch puts the transfer in transit, credited to the donor pharmacist, with no extra event", () => {
    const { state, t } = withTransfer(base(), {});
    const actions = dispatchActions(state, t);
    expect(actions).toEqual([{ type: "SET_TRANSFER_STATUS", transferId: "tr-test", status: "in_transit", actor: "S. Verma (pharmacist, Kalyanpur PHC)" }]);
    const next = run(state, actions);
    expect(next.transfers.find((x) => x.id === "tr-test")?.status).toBe("in_transit");
    expect(next.timeline[0].actor).toContain("S. Verma");
    expect(next.timeline.length).toBe(state.timeline.length + 1);
    expect(dispatchActions(next, next.transfers.find((x) => x.id === "tr-test")!)).toEqual([]);
  });

  it("full receipt delivers the whole consignment", () => {
    const { state, t } = withTransfer(base(), { status: "in_transit", dispatchedAt: base().now });
    const actions = receiptActions(state, t, 45);
    expect(actions).toEqual([{ type: "CONFIRM_RECEIPT", transferId: "tr-test", receivedQty: 45, actor: "R. Mishra (pharmacist, Saraswati PHC)" }]);
    const next = run(state, actions);
    expect(next.transfers.find((x) => x.id === "tr-test")?.status).toBe("delivered");
    expect(stockOf(next, "saraswati").stock).toBe(16 + 45);
    expect(stockOf(next, "kalyanpur").recountRequested ?? null).toBeNull();
  });

  it("short receipt credits only what was counted and asks the donor to recount", () => {
    const { state, t } = withTransfer(base(), { status: "in_transit", dispatchedAt: base().now });
    const next = run(state, receiptActions(state, t, 40));
    expect(next.transfers.find((x) => x.id === "tr-test")?.receivedQuantity).toBe(40);
    expect(stockOf(next, "saraswati").stock).toBe(16 + 40);
    expect(stockOf(next, "kalyanpur").recountRequested).toBeTruthy();
    const v = pharmacistView(next, "kalyanpur")!;
    expect(v.recounts.map((r) => r.medicine.id)).toContain("metformin-500");
    expect(inboxMessages(next, "saraswati").some((m) => m.tone === "warn" && m.hi.includes("कम"))).toBe(true);
    expect(inboxMessages(next, "kalyanpur").some((m) => m.task?.kind === "recount")).toBe(true);
  });

  it("receipt count never exceeds what was dispatched", () => {
    const { state, t } = withTransfer(base(), { status: "in_transit", dispatchedAt: base().now });
    const [a] = receiptActions(state, t, 99);
    expect(a.type === "CONFIRM_RECEIPT" && a.receivedQty).toBe(45);
  });

  it("keypad report is stored as manual and flags out-of-range counts", () => {
    const s = base();
    const f = s.facilities.find((x) => x.id === "saraswati")!;
    const ok = keypadReportActions(s, f, "metformin-500", 16);
    expect(ok[0].type === "RECORD_VOICE_REPORT" && ok[0].reportSource).toBe("manual");
    expect(stockOf(run(s, ok), "saraswati").reportSource).toBe("manual");
    const [odd] = keypadReportActions(s, f, "metformin-500", 400);
    expect(odd.type === "RECORD_VOICE_REPORT" && odd.report.needsRecount).toBe(true);
  });
});
