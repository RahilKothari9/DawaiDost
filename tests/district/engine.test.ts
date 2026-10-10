import { describe, expect, it } from "vitest";
import { SEED_NOW, createInitialState } from "../../lib/district/data";
import {
  assessDistrict, assessStock, buildDistrictSnapshot, detectAnomaly, districtKpis, donorCandidates, forecastSeries, haversineKm, transferEtaHours, weekStart,
} from "../../lib/district/engine";
import type { StockRecord } from "../../lib/district/types";

const state = createInitialState();
const rec = (f: string, m: string) => state.stock.find((r) => r.facilityId === f && r.medicineId === m)!;
const med = (m: string) => state.medicines.find((x) => x.id === m)!;
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);

describe("seed", () => {
  it("keeps the hero metformin numbers exact", () => {
    expect([rec("saraswati", "metformin-500").stock, rec("saraswati", "metformin-500").dailyUse]).toEqual([16, 8]);
    expect([rec("kalyanpur", "metformin-500").stock, rec("kalyanpur", "metformin-500").dailyUse]).toEqual([80, 5]);
    expect([rec("rampur", "metformin-500").stock, rec("rampur", "metformin-500").dailyUse]).toEqual([9, 6]);
  });

  it("has a full facility x medicine grid with 12 weeks of ledger-consistent history", () => {
    expect(state.stock).toHaveLength(state.facilities.length * state.medicines.length);
    expect(state.facilities.filter((f) => f.type === "PHC").length).toBeGreaterThanOrEqual(14);
    for (const r of state.stock) {
      expect(r.history).toHaveLength(12);
      expect(r.history.every((p) => p.closingStock >= 0 && p.dispensed >= 0)).toBe(true);
      for (let i = 1; i < r.history.length - 1; i++) {
        const [p, c] = [r.history[i - 1], r.history[i]];
        expect(c.closingStock).toBe(p.closingStock + (c.received ?? 0) - c.dispensed);
      }
    }
  });

  it("places every facility inside the district bounding box", () => {
    for (const f of state.facilities) {
      expect(f.lat).toBeGreaterThan(22.6); expect(f.lat).toBeLessThan(23.4);
      expect(f.lng).toBeGreaterThan(76.6); expect(f.lng).toBeLessThan(77.8);
    }
  });

  it("is deterministic", () => {
    expect(createInitialState()).toEqual(createInitialState());
  });
});

describe("assessStock", () => {
  it("classifies the hero trio", () => {
    const m = med("metformin-500");
    expect(assessStock(rec("saraswati", "metformin-500"), m, SEED_NOW)).toMatchObject({ daysOfStock: 2, thresholdDays: 8, risk: "critical", transferable: 0, gapUnits: 48 });
    expect(assessStock(rec("kalyanpur", "metformin-500"), m, SEED_NOW)).toMatchObject({ daysOfStock: 16, risk: "surplus", transferable: 45 });
    expect(assessStock(rec("rampur", "metformin-500"), m, SEED_NOW)).toMatchObject({ daysOfStock: 1.5, risk: "critical" });
  });

  it("marks empty shelves as stockout and projects the stockout date", () => {
    expect(assessStock(rec("tulsipur", "salbutamol-inhaler"), med("salbutamol-inhaler"), SEED_NOW).risk).toBe("stockout");
    expect(assessStock(rec("saraswati", "metformin-500"), med("metformin-500"), SEED_NOW).projectedStockoutDate).toBe("2026-10-12");
  });

  it("treats zero use as infinite cover", () => {
    const r: StockRecord = { ...rec("saraswati", "metformin-500"), dailyUse: 0 };
    expect(assessStock(r, med("metformin-500"), SEED_NOW)).toMatchObject({ daysOfStock: Infinity, projectedStockoutDate: null });
  });
});

describe("geometry and time", () => {
  it("computes haversine distance and ETA", () => {
    expect(haversineKm({ lat: 23, lng: 77 }, { lat: 23, lng: 77 })).toBe(0);
    expect(haversineKm({ lat: 23, lng: 77 }, { lat: 24, lng: 77 })).toBeCloseTo(111.2, 0);
    expect(transferEtaHours(30)).toBe(2.3);
  });

  it("finds the IST Monday", () => {
    expect(weekStart(SEED_NOW)).toBe("2026-10-05");
    expect(weekStart("2026-10-04T19:00:00Z")).toBe("2026-10-05"); // Monday 00:30 IST
  });
});

describe("detectAnomaly", () => {
  it("flags only the engineered suspicious count", () => {
    const flagged = state.stock.filter((r) => detectAnomaly(r).flagged).map((r) => `${r.facilityId}/${r.medicineId}`);
    expect(flagged).toEqual(["hirapur/telmisartan-40"]);
    expect(detectAnomaly(rec("hirapur", "telmisartan-40"))).toMatchObject({ kind: "unexplained_increase", reported: 168 });
  });

  it("flags a large unexplained drop and stale reports", () => {
    const r = rec("kalyanpur", "metformin-500");
    const h = [...r.history];
    h[h.length - 1] = { ...h[h.length - 1], closingStock: 0 };
    expect(detectAnomaly({ ...r, stock: 0, history: h }).kind).toBe("unexplained_drop");
    expect(detectAnomaly(rec("bhimpura", "paracetamol-500"), SEED_NOW).kind).toBe("stale_report");
  });

  it("does not flag without history", () => {
    expect(detectAnomaly({ ...rec("saraswati", "metformin-500"), history: [] }).flagged).toBe(false);
  });
});

describe("forecastSeries", () => {
  it("projects at the recent weekly average and adds inbound", () => {
    const r = rec("saraswati", "metformin-500");
    const s = forecastSeries(r, 5, SEED_NOW);
    expect(s).toHaveLength(6);
    expect(s[0].stock).toBe(16);
    expect(s[1].stock).toBe(8);
    expect(s[3].stock).toBe(0);
    const withInbound = forecastSeries(r, 3, SEED_NOW, [{ at: "2026-10-10T12:00:00Z", quantity: 24 }]);
    expect(withInbound[1]).toMatchObject({ stock: 32, inbound: 24 });
  });
});

describe("donors and snapshot", () => {
  it("excludes the suspicious count as a donor", () => {
    const d = donorCandidates(state, "gopalpura", "telmisartan-40").find((x) => x.facilityId === "hirapur")!;
    expect(d).toMatchObject({ anomaly: true, eligible: false });
  });

  it("builds a facts-only hero snapshot", () => {
    const s = buildDistrictSnapshot(state, "saraswati", "metformin-500");
    expect(get(s, "target")).toMatchObject({ stock: 16, dailyUse: 8, daysOfStock: 2, risk: "critical", verified: true, unitsToCoverLeadTime: 24, unitsToReachThreshold: 48 });
    expect(get(s, "medicine")).toMatchObject({ leadTimeDays: 5, safetyBufferDays: 3, reserveDays: 7, thresholdDays: 8 });
    expect(get(s, "donorCandidates.0")).toMatchObject({ facilityId: "kalyanpur", transferable: 45, eligible: true });
    expect(get(s, "localTransferCapacity")).toMatchObject({ eligibleDonors: 1, totalTransferable: 45, coversLeadTimeGap: true, coversThresholdGap: false });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("shows the amlodipine gap with no donor and an empty warehouse", () => {
    const s = buildDistrictSnapshot(state, "kesarpura", "amlodipine-5");
    expect(get(s, "localTransferCapacity.eligibleDonors")).toBe(0);
    expect(get(s, "districtTotals.warehouseStock")).toBe(0);
    expect(get(s, "medicine.upstreamSupply.status")).toBe("delayed");
  });

  it("surfaces the count check for the suspicious record", () => {
    const s = buildDistrictSnapshot(state, "hirapur", "telmisartan-40");
    expect(get(s, "target.verified")).toBe(false);
    expect(get(s, "target.countCheck")).toMatchObject({ flagged: true, kind: "unexplained_increase" });
  });
});

describe("districtKpis", () => {
  it("summarises the seeded district", () => {
    const k = districtKpis(state);
    expect(k.facilitiesTotal).toBe(state.facilities.length - 1);
    expect(k.facilitiesReporting).toBe(k.facilitiesTotal - 2);
    expect(k.stockouts).toBe(1);
    expect(k.unitsInTransit).toBe(300);
    expect(k.anomalies).toBe(1);
    expect(k.liveRatio).toBe(0.5);
    expect(k.stockoutDaysAverted).toBeGreaterThan(0);
    expect(assessDistrict(state)).toHaveLength(state.stock.length);
  });
});
