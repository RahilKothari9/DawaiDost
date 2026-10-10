import { describe, expect, it } from "vitest";
import { buildDecisionSnapshot, daysOfStock, getFallbackDecision, initialClinics, transferableSurplus } from "../lib/scenario";

describe("stock calculations", () => {
  it("calculates stock cover from count and daily use", () => {
    expect(daysOfStock(16, 8)).toBe(2);
    expect(daysOfStock(80, 5)).toBe(16);
  });

  it("preserves the donor reserve when calculating transferable stock", () => {
    expect(transferableSurplus(80, 5, 7)).toBe(45);
    expect(transferableSurplus(9, 6, 7)).toBe(0);
  });

  it("returns no finite stock cover when consumption is zero", () => {
    expect(daysOfStock(20, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("decision snapshot and demo fallback", () => {
  it("includes a verified target count and nearby clinic evidence", () => {
    const snapshot = buildDecisionSnapshot(initialClinics);
    expect(snapshot.targetClinic).toBe("Saraswati PHC");
    expect(snapshot.targetDaysOfStock).toBe(2);
    expect(snapshot.nearbyClinics).toEqual(expect.arrayContaining([
      expect.objectContaining({ clinic: "Kalyanpur PHC", transferableStrips: 45 }),
      expect.objectContaining({ clinic: "Rampur PHC", transferableStrips: 0 }),
    ]));
  });

  it("selects a transfer when a nearby donor has surplus", () => {
    const result = getFallbackDecision(initialClinics);
    expect(result.action).toBe("transfer_surplus");
    expect(result.probabilities.transfer_surplus).toBe(0.82);
    expect(Object.values(result.probabilities).reduce((sum, value) => sum + value, 0)).toBe(1);
  });

  it("recommends an indent fallback when no donor can spare stock", () => {
    const clinics = initialClinics.map((clinic) => ({ ...clinic, stock: clinic.id === "saraswati" ? 16 : 10 }));
    expect(getFallbackDecision(clinics).action).toBe("draft_indent");
  });
});
