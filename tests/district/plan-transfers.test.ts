import { describe, expect, it } from "vitest";
import { createInitialState } from "../../lib/district/data";
import { assessStock, outboundUnits, planAllTransfers, planTransfers } from "../../lib/district/engine";
import { generateScenario } from "../../lib/district/simulation";
import type { DistrictState } from "../../lib/district/types";

const state = createInitialState();

function expectReservesKept(s: DistrictState) {
  const proposals = planAllTransfers(s);
  const out = new Map<string, number>();
  for (const t of proposals) {
    const k = `${t.fromId}|${t.medicineId}`;
    out.set(k, (out.get(k) ?? 0) + t.quantity);
    expect(t.quantity).toBeGreaterThan(0);
    expect(t.fromId).not.toBe(t.toId);
    expect(s.facilities.find((f) => f.id === t.fromId)?.type).not.toBe("WAREHOUSE");
  }
  for (const [k, qty] of out) {
    const [f, m] = k.split("|");
    const r = s.stock.find((x) => x.facilityId === f && x.medicineId === m)!;
    const med = s.medicines.find((x) => x.id === m)!;
    const left = r.stock - qty - outboundUnits(s, f, m);
    expect(left).toBeGreaterThanOrEqual(r.dailyUse * med.reserveDays);
    expect(r.verified).toBe(true);
  }
  return proposals;
}

describe("planTransfers", () => {
  it("bridges the hero pair from Kalyanpur without breaking its reserve", () => {
    const plan = planTransfers(state, "metformin-500");
    const q = Object.fromEntries(plan.map((t) => [`${t.fromId}>${t.toId}`, t.quantity]));
    expect(q).toEqual({ "kalyanpur>saraswati": 24, "kalyanpur>rampur": 21 });
    expect(plan.every((t) => t.status === "proposed" && t.etaHours > 0 && t.distanceKm > 0)).toBe(true);
  });

  it("prefers the near-expiry donor over a nearer surplus hub", () => {
    const [t] = planTransfers(state, "amoxicillin-500").filter((x) => x.toId === "lakshmipura");
    expect(t.fromId).toBe("anandpur");
    expect(t.reason).toMatch(/near-expiry/);
  });

  it("never uses a suspicious count as a donor", () => {
    expect(planTransfers(state, "telmisartan-40")).toEqual([]);
  });

  it("proposes nothing in the district-wide amlodipine shortage", () => {
    expect(planTransfers(state, "amlodipine-5")).toEqual([]);
  });

  it("accounts for open inbound and outbound transfers", () => {
    expect(planTransfers(state, "atenolol-50").some((t) => t.toId === "devgarh")).toBe(false);
    expect(planTransfers(state, "ors-sachet").some((t) => t.toId === "madhavgarh")).toBe(false);
    const withOpen: DistrictState = { ...state, transfers: [...state.transfers, ...planTransfers(state, "metformin-500").map((t) => ({ ...t, status: "approved" as const }))] };
    expect(planTransfers(withOpen, "metformin-500")).toEqual([]);
  });

  it("keeps every donor reserve in the seed", () => {
    expect(expectReservesKept(state).length).toBeGreaterThan(3);
  });

  it("keeps every donor reserve across generated scenarios", () => {
    for (let seed = 1; seed <= 40; seed++) expectReservesKept(generateScenario(seed, { shortages: 14, surplusHubs: 6 }));
  });

  it("only targets at-risk recipients", () => {
    for (const t of planAllTransfers(state)) {
      const r = state.stock.find((x) => x.facilityId === t.toId && x.medicineId === t.medicineId)!;
      const m = state.medicines.find((x) => x.id === t.medicineId)!;
      expect(["stockout", "critical", "low"]).toContain(assessStock(r, m, state.now).risk);
    }
  });
});
