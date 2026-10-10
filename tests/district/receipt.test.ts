import { describe, expect, it } from "vitest";
import { createInitialState } from "../../lib/district/data";
import { planTransfers } from "../../lib/district/engine";
import { districtReducer } from "../../lib/district/store";
import type { DistrictAction, DistrictState } from "../../lib/district/types";

const run = (s: DistrictState, ...actions: DistrictAction[]) => actions.reduce(districtReducer, s);
const rec = (s: DistrictState, f: string, m: string) => s.stock.find((r) => r.facilityId === f && r.medicineId === m)!;
const s0 = createInitialState();
const [hero] = planTransfers(s0, "metformin-500").filter((t) => t.toId === "saraswati");
const dispatched = run(s0,
  { type: "PROPOSE_TRANSFER", transfer: hero },
  { type: "SET_TRANSFER_STATUS", transferId: hero.id, status: "approved" },
  { type: "SET_TRANSFER_STATUS", transferId: hero.id, status: "in_transit", actor: "Kalyanpur driver" },
);

describe("attribution and report source", () => {
  it("uses the actor on SET_TRANSFER_STATUS and REQUEST_RECOUNT", () => {
    expect(dispatched.timeline.find((e) => /In transit/.test(e.title))?.actor).toBe("Kalyanpur driver");
    const s = run(s0, { type: "REQUEST_RECOUNT", facilityId: "rampur", medicineId: "metformin-500", reason: "check", actor: "K. Yadav (pharmacist)" });
    expect(s.timeline.find((e) => e.kind === "recount_requested")?.actor).toBe("K. Yadav (pharmacist)");
  });

  it("honours reportSource from the action or the report, defaulting to voice", () => {
    const base = { facilityId: "saraswati", medicineId: "metformin-500", count: 15, unit: "strips", confidence: 0.95, transcript: "", language: "hi", needsRecount: false };
    expect(rec(run(s0, { type: "RECORD_VOICE_REPORT", report: base }), "saraswati", "metformin-500").reportSource).toBe("voice");
    expect(rec(run(s0, { type: "RECORD_VOICE_REPORT", report: { ...base, reportSource: "manual" } }), "saraswati", "metformin-500").reportSource).toBe("manual");
    expect(rec(run(s0, { type: "RECORD_VOICE_REPORT", report: base, reportSource: "manual" }), "saraswati", "metformin-500").reportSource).toBe("manual");
  });
});

describe("CONFIRM_RECEIPT", () => {
  it("delivers in full with no shortfall", () => {
    const s = run(dispatched, { type: "CONFIRM_RECEIPT", transferId: hero.id, receivedQty: 24 });
    expect(s.transfers.find((t) => t.id === hero.id)).toMatchObject({ status: "delivered", receivedQuantity: 24 });
    expect(rec(s, "saraswati", "metformin-500").stock).toBe(40);
    expect(rec(s, "kalyanpur", "metformin-500").stock).toBe(56);
    expect(rec(s, "kalyanpur", "metformin-500").recountRequested).toBeNull();
    expect(s.timeline.some((e) => /Shortfall/.test(e.title))).toBe(false);
  });

  it("records a shortfall: recipient gets what arrived, donor debited in full and asked to recount", () => {
    const s = run(dispatched, { type: "CONFIRM_RECEIPT", transferId: hero.id, receivedQty: 20, actor: "R. Mishra (pharmacist)" });
    expect(s.transfers.find((t) => t.id === hero.id)).toMatchObject({ status: "delivered", receivedQuantity: 20 });
    expect(rec(s, "saraswati", "metformin-500").stock).toBe(36);
    expect(rec(s, "kalyanpur", "metformin-500")).toMatchObject({ stock: 56, verified: false });
    expect(rec(s, "kalyanpur", "metformin-500").recountRequested?.reason).toMatch(/20 of 24/);
    const alert = s.timeline.find((e) => e.kind === "alert" && /Shortfall/.test(e.title))!;
    expect(alert).toMatchObject({ facilityId: "saraswati", actor: "R. Mishra (pharmacist)" });
    expect(s.timeline.some((e) => e.kind === "recount_requested" && e.facilityId === "kalyanpur")).toBe(true);
  });

  it("corrects a transfer the clock already auto-delivered", () => {
    const auto = run(dispatched, { type: "SET_TRANSFER_STATUS", transferId: hero.id, status: "delivered" });
    const s = run(auto, { type: "CONFIRM_RECEIPT", transferId: hero.id, receivedQty: 18 });
    expect(rec(s, "saraswati", "metformin-500").stock).toBe(rec(auto, "saraswati", "metformin-500").stock - 6);
    expect(rec(s, "kalyanpur", "metformin-500").stock).toBe(rec(auto, "kalyanpur", "metformin-500").stock);
    expect(s.transfers.find((t) => t.id === hero.id)?.receivedQuantity).toBe(18);
  });

  it("is idempotent and ignores rejected or unknown transfers", () => {
    const s = run(dispatched, { type: "CONFIRM_RECEIPT", transferId: hero.id, receivedQty: 24 });
    expect(run(s, { type: "CONFIRM_RECEIPT", transferId: hero.id, receivedQty: 10 })).toBe(s);
    expect(run(s0, { type: "CONFIRM_RECEIPT", transferId: "nope", receivedQty: 1 })).toBe(s0);
    const rejected = run(s0, { type: "PROPOSE_TRANSFER", transfer: hero }, { type: "SET_TRANSFER_STATUS", transferId: hero.id, status: "rejected" });
    expect(run(rejected, { type: "CONFIRM_RECEIPT", transferId: hero.id, receivedQty: 24 })).toBe(rejected);
  });

  it("clamps received quantity to what was dispatched", () => {
    const s = run(dispatched, { type: "CONFIRM_RECEIPT", transferId: hero.id, receivedQty: 99 });
    expect(rec(s, "saraswati", "metformin-500").stock).toBe(40);
  });
});
