import { describe, expect, it } from "vitest";
import { createInitialState } from "../../lib/district/data";
import { detectAnomaly, planTransfers } from "../../lib/district/engine";
import { districtReducer } from "../../lib/district/store";
import type { DecisionRecord, DistrictAction, DistrictState, VoiceReport } from "../../lib/district/types";

const run = (s: DistrictState, ...actions: DistrictAction[]) => actions.reduce(districtReducer, s);
const rec = (s: DistrictState, f: string, m: string) => s.stock.find((r) => r.facilityId === f && r.medicineId === m)!;
const report = (facilityId: string, medicineId: string, count: number, extra: Partial<VoiceReport> = {}): VoiceReport =>
  ({ facilityId, medicineId, count, unit: "strips", confidence: 0.95, transcript: "test", language: "hi", needsRecount: false, ...extra });
const decision = (over: Partial<DecisionRecord>): DecisionRecord => ({
  id: "d1", facilityId: "saraswati", medicineId: "metformin-500", action: "transfer_surplus", confidence: 0.8,
  probabilities: { verify_count: 0.05, transfer_surplus: 0.8, draft_indent: 0.1, escalate_supply_gap: 0.05 },
  source: "live", snapshot: {}, status: "pending", createdAt: "2026-10-10T04:12:00.000Z", ...over,
});

describe("districtReducer", () => {
  const s0 = createInitialState();

  it("selects facility and medicine", () => {
    const s = run(s0, { type: "SELECT_FACILITY", facilityId: "rampur" }, { type: "SELECT_MEDICINE", medicineId: "ors-sachet" });
    expect([s.selectedFacilityId, s.selectedMedicineId]).toEqual(["rampur", "ors-sachet"]);
  });

  it("records a consistent voice report as verified", () => {
    const s = run(s0, { type: "RECORD_VOICE_REPORT", report: report("saraswati", "metformin-500", 15) });
    expect(rec(s, "saraswati", "metformin-500")).toMatchObject({ stock: 15, verified: true, recountRequested: null, reportSource: "voice" });
    expect(s.timeline.some((e) => e.kind === "voice_report" && e.facilityId === "saraswati" && e.at === s0.now)).toBe(true);
    expect(s.timeline.some((e) => e.kind === "alert" && e.facilityId === "saraswati")).toBe(true);
  });

  it("flags an inconsistent voice report for recount", () => {
    const s = run(s0, { type: "RECORD_VOICE_REPORT", report: report("kalyanpur", "metformin-500", 400) });
    expect(rec(s, "kalyanpur", "metformin-500")).toMatchObject({ stock: 400, verified: false });
    expect(rec(s, "kalyanpur", "metformin-500").recountRequested?.reason).toMatch(/ledger/);
    expect(s.timeline.some((e) => e.kind === "recount_requested")).toBe(true);
  });

  it("clears a suspicious count after a consistent recount", () => {
    const s = run(s0, { type: "RECORD_VOICE_REPORT", report: report("hirapur", "telmisartan-40", 31) });
    expect(rec(s, "hirapur", "telmisartan-40").verified).toBe(true);
    expect(detectAnomaly(rec(s, "hirapur", "telmisartan-40")).flagged).toBe(false);
    expect(s.timeline.some((e) => e.kind === "count_verified")).toBe(true);
  });

  it("requests recount on low extraction confidence or explicit flag", () => {
    expect(rec(run(s0, { type: "RECORD_VOICE_REPORT", report: report("rampur", "metformin-500", 9, { confidence: 0.3 }) }), "rampur", "metformin-500").verified).toBe(false);
    expect(rec(run(s0, { type: "REQUEST_RECOUNT", facilityId: "rampur", medicineId: "metformin-500", reason: "check" }), "rampur", "metformin-500").recountRequested?.reason).toBe("check");
  });

  it("does not auto-create transfers when a transfer decision is approved", () => {
    const s = run(s0, { type: "ADD_DECISION", decision: decision({}) }, { type: "SET_DECISION_STATUS", decisionId: "d1", status: "approved" });
    expect(s.transfers).toHaveLength(s0.transfers.length);
    expect(s.decisions[0]).toMatchObject({ status: "approved" });
    expect(s.timeline.some((e) => e.kind === "approval" && e.facilityId === "saraswati")).toBe(true);
  });

  it("approves a linked proposed transfer with the decision", () => {
    const [t] = planTransfers(s0, "metformin-500").filter((x) => x.toId === "saraswati");
    const s = run(s0, { type: "ADD_DECISION", decision: decision({}) }, { type: "PROPOSE_TRANSFER", transfer: { ...t, decisionId: "d1" } }, { type: "SET_DECISION_STATUS", decisionId: "d1", status: "approved" });
    expect(s.transfers.find((x) => x.id === t.id)).toMatchObject({ status: "approved", approvedAt: s0.now });
    expect(s.decisions[0].transferId).toBe(t.id);
  });

  it("rejecting a decision rejects its proposed transfer", () => {
    const [t] = planTransfers(s0, "metformin-500");
    const s = run(s0, { type: "ADD_DECISION", decision: decision({}) }, { type: "PROPOSE_TRANSFER", transfer: { ...t, decisionId: "d1" } }, { type: "SET_DECISION_STATUS", decisionId: "d1", status: "rejected" });
    expect(s.transfers.find((x) => x.id === t.id)?.status).toBe("rejected");
  });

  it("verify_count / draft_indent / escalate approvals log the right events", () => {
    const v = run(s0, { type: "ADD_DECISION", decision: decision({ id: "v", facilityId: "hirapur", medicineId: "telmisartan-40", action: "verify_count" }) }, { type: "SET_DECISION_STATUS", decisionId: "v", status: "approved" });
    expect(rec(v, "hirapur", "telmisartan-40").recountRequested).not.toBeNull();
    const i = run(s0, { type: "ADD_DECISION", decision: decision({ id: "i", facilityId: "kesarpura", medicineId: "ifa-tablets", action: "draft_indent" }) }, { type: "SET_DECISION_STATUS", decisionId: "i", status: "approved" });
    expect(i.timeline.some((e) => e.kind === "indent" && e.facilityId === "kesarpura")).toBe(true);
    const e = run(s0, { type: "ADD_DECISION", decision: decision({ id: "e", facilityId: "kesarpura", medicineId: "amlodipine-5", action: "escalate_supply_gap" }) }, { type: "SET_DECISION_STATUS", decisionId: "e", status: "approved" });
    expect(e.timeline.find((x) => x.kind === "escalation")?.detail).toMatch(/warehouse 0/);
  });

  it("moves stock from donor to recipient on delivery, exactly once", () => {
    const [t] = planTransfers(s0, "metformin-500").filter((x) => x.toId === "saraswati");
    const s = run(s0, { type: "PROPOSE_TRANSFER", transfer: t }, { type: "SET_TRANSFER_STATUS", transferId: t.id, status: "approved" }, { type: "SET_TRANSFER_STATUS", transferId: t.id, status: "in_transit" }, { type: "SET_TRANSFER_STATUS", transferId: t.id, status: "delivered" });
    expect(rec(s, "saraswati", "metformin-500").stock).toBe(40);
    expect(rec(s, "kalyanpur", "metformin-500").stock).toBe(56);
    expect(run(s, { type: "SET_TRANSFER_STATUS", transferId: t.id, status: "delivered" })).toBe(s);
    expect(detectAnomaly(rec(s, "saraswati", "metformin-500")).flagged).toBe(false);
    expect(detectAnomaly(rec(s, "kalyanpur", "metformin-500")).flagged).toBe(false);
  });

  it("ignores duplicate proposals and unknown ids", () => {
    const [t] = planTransfers(s0, "metformin-500");
    const s = run(s0, { type: "PROPOSE_TRANSFER", transfer: t });
    expect(run(s, { type: "PROPOSE_TRANSFER", transfer: t })).toBe(s);
    expect(run(s0, { type: "SET_TRANSFER_STATUS", transferId: "nope", status: "approved" })).toBe(s0);
  });

  it("advances the clock: consumes stock, dispatches approved, delivers in-transit", () => {
    const s = run(s0, { type: "ADVANCE_CLOCK", hours: 6 });
    expect(new Date(s.now).getTime() - new Date(s0.now).getTime()).toBe(6 * 36e5);
    expect(rec(s, "saraswati", "metformin-500").stock).toBe(14);
    expect(s.transfers.find((t) => t.id === "tr-seed-03")?.status).toBe("delivered");
    expect(s.transfers.find((t) => t.id === "tr-seed-04")?.status).toBe("delivered");
    expect(rec(s, "devgarh", "atenolol-50").stock).toBeGreaterThan(rec(s0, "devgarh", "atenolol-50").stock);
    expect(Number.isInteger(rec(s, "kesarpura", "ifa-tablets").stock)).toBe(true);
  });

  it("splits clock advances without drift and rolls weekly history", () => {
    const a = run(s0, { type: "ADVANCE_CLOCK", hours: 72 });
    const b = run(s0, ...Array.from({ length: 72 }, () => ({ type: "ADVANCE_CLOCK", hours: 1 }) as DistrictAction));
    expect(a.stock.map((r) => r.stock)).toEqual(b.stock.map((r) => r.stock));
    expect(rec(a, "saraswati", "metformin-500").history.at(-1)?.weekOf).toBe("2026-10-12");
    expect(rec(a, "saraswati", "metformin-500").history).toHaveLength(12);
    expect(a.timeline.some((e) => e.kind === "alert" && e.facilityId === "saraswati" && /Stockout/.test(e.title))).toBe(true);
  });

  it("resets to the seed", () => {
    const s = run(s0, { type: "ADVANCE_CLOCK", hours: 30 }, { type: "RESET" });
    expect(s).toEqual(createInitialState());
  });
});
