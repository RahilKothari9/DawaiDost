import { describe, expect, it } from "vitest";
import { computeLeadTimeWatch, observeDeliveries } from "../../lib/escalations/leadtime";
import { MED, makeState, rec, weeks } from "./fixtures";

describe("lead-time watch", () => {
  it("measures receipt week minus reorder week", () => {
    // dispensed 70/wk = 10/day; threshold 11 days = 110 units. Week 2 closes at 90 (<110), receipt lands in week 5.
    const r = rec("a", 200, 10, { history: weeks(6, [300, 200, 90, 20, 0, 250], [0, 0, 0, 0, 0, 300]) });
    const obs = observeDeliveries(r, MED);
    expect(obs).toHaveLength(1);
    expect(obs[0].leadDays).toBe(21 - 3.5);
    expect(obs[0].late).toBe(true); // 17.5 > 7 + 3.5
  });

  it("skips routine deliveries that arrive before the reorder point", () => {
    const r = rec("a", 200, 10, { history: weeks(4, [300, 200, 400, 330], [0, 0, 270, 0]) });
    expect(observeDeliveries(r, MED)).toHaveLength(0);
  });

  it("flags an overdue state consignment and uses configured lead time with few observations", () => {
    const wh = rec("wh", 0, 30, { history: weeks(12, [], [0, 0, 0, 0, 900]) }); // single receipt ~11 weeks back
    const w = computeLeadTimeWatch(makeState([wh, rec("a", 20, 10)]), MED.id)!;
    expect(w.source).toBe("configured");
    expect(w.observedLeadDays).toBeNull();
    expect(w.warehouse.cycleSource).toBe("assumed");
    expect(w.warehouse.overdueDays).toBeGreaterThan(20);
    expect(w.flag).toBe("late");
  });

  it("derives the consignment cycle from warehouse receipts", () => {
    const wh = rec("wh", 900, 30, { history: weeks(12, [], [0, 0, 0, 900, 0, 0, 0, 900, 0, 0, 0, 900]) });
    const s = makeState([wh], { medicines: [{ ...MED, upstream: { status: "available", note: "", expectedOn: null } }] });
    const w = computeLeadTimeWatch(s, MED.id)!;
    expect(w.warehouse.cycleDays).toBe(28);
    expect(w.warehouse.cycleSource).toBe("history");
    expect(w.warehouse.overdueDays).toBe(0);
    expect(w.flag).toBe("on_time");
  });
});
