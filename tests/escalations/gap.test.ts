import { describe, expect, it } from "vitest";
import { createInitialState } from "../../lib/district/data";
import { computeSupplyGap, computeSupplyGaps } from "../../lib/escalations/gap";
import { MED, makeState, rec } from "./fixtures";

describe("computeSupplyGap", () => {
  it("flags a gap redistribution cannot close and quantifies it", () => {
    // a: 2 days (needs 11*10-20=90), b: 5 days (needs 11*10-50=60), c: 12 days (ok, not surplus). Warehouse 40.
    const s = makeState([rec("a", 20, 10), rec("b", 50, 10), rec("c", 120, 10), rec("wh", 40, 30)]);
    const g = computeSupplyGap(s, MED.id)!;
    expect(g.needUnits).toBe(150);
    expect(g.transferableUnits).toBe(0);
    expect(g.redistributionCloses).toBe(false);
    expect(g.warehouseApplied).toBe(40);
    expect(g.gapUnits).toBe(110);
    expect(g.status).toBe("escalate");
    expect(g.affected.map((a) => a.facilityId)).toEqual(["a", "b"]);
    expect(g.affectedPopulation).toBe(50000);
    expect(g.totalDailyUse).toBe(30);
    expect(g.siteCoverageDays).toBe(6.3); // 190 / 30
    expect(g.pooledCoverageDays).toBe(7.7); // 230 / 30
    expect(g.districtStockoutDate).toBe("2026-10-18");
    // requested: min(lead 7, floor(7.7)) = 7 days from now
    expect(g.requestedDeliveryDate).toBe("2026-10-17");
    expect(g.replenishmentUnits).toBe(900);
  });

  it("uses safe surplus first and closes the gap locally when it suffices", () => {
    const s = makeState([rec("a", 20, 10), rec("b", 200, 10), rec("c", 400, 10), rec("wh", 500, 30)], {
      medicines: [{ ...MED, upstream: { status: "available", note: "", expectedOn: null } }],
    });
    const g = computeSupplyGap(s, MED.id)!;
    expect(g.needUnits).toBe(90);
    expect(g.transferableUnits).toBe(330 + 130); // c: 400-70, b: 20 days >= 18 -> 200-70
    expect(g.surplusApplied).toBe(90);
    expect(g.gapUnits).toBe(0);
    expect(g.redistributionCloses).toBe(true);
    expect(g.status).toBe("local");
  });

  it("ignores unverified or recount-pending surplus", () => {
    const s = makeState([rec("a", 20, 10), rec("c", 400, 10, { verified: false }), rec("b", 400, 10, { recountRequested: { reason: "x", at: "" } }), rec("wh", 0, 30)]);
    const g = computeSupplyGap(s, MED.id)!;
    expect(g.transferableUnits).toBe(0);
    expect(g.gapUnits).toBe(90);
  });

  it("nets open inbound transfers out of need and outbound out of surplus", () => {
    const s = makeState([rec("a", 20, 10), rec("b", 400, 10), rec("c", 120, 10), rec("wh", 0, 30)], {
      transfers: [{ id: "t", medicineId: MED.id, fromId: "b", toId: "a", quantity: 50, status: "approved", distanceKm: 5, etaHours: 1, createdAt: "", updatedAt: "" }],
    });
    const g = computeSupplyGap(s, MED.id)!;
    expect(g.affected[0].needUnits).toBe(40);
    expect(g.transferableUnits).toBe(400 - 70 - 50);
  });

  it("reports clear when nobody is below threshold", () => {
    const s = makeState([rec("a", 150, 10), rec("b", 150, 10), rec("c", 150, 10), rec("wh", 0, 30)]);
    expect(computeSupplyGap(s, MED.id)!.status).toBe("clear");
  });

  it("puts warehouse-closable gaps on watch when upstream is delayed", () => {
    const s = makeState([rec("a", 20, 10), rec("b", 150, 10), rec("c", 150, 10), rec("wh", 1000, 30)]);
    const g = computeSupplyGap(s, MED.id)!;
    expect(g.gapUnits).toBe(0);
    expect(g.status).toBe("watch");
  });

  it("never requests a delivery sooner than the state can dispatch", () => {
    const s = makeState([rec("a", 0, 10), rec("b", 0, 10), rec("c", 10, 10), rec("wh", 0, 30)]);
    expect(computeSupplyGap(s, MED.id)!.requestedDeliveryDate).toBe("2026-10-13");
  });

  it("ranks the seeded amlodipine shortage first on the seed data", () => {
    const gaps = computeSupplyGaps(createInitialState());
    expect(gaps[0].medicineId).toBe("amlodipine-5");
    expect(gaps[0].status).toBe("escalate");
    expect(gaps[0].redistributionCloses).toBe(false);
  });
});
