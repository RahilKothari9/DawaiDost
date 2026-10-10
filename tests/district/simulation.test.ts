import { describe, expect, it } from "vitest";
import { createInitialState } from "../../lib/district/data";
import { buildPlayback, compareWeek, createPlayback, generateScenario } from "../../lib/district/simulation";

describe("simulation", () => {
  const s0 = createInitialState();

  it("builds a week of frames", () => {
    const frames = buildPlayback(s0, { stepHours: 12, voiceReports: true });
    expect(frames).toHaveLength(15);
    expect(new Date(frames.at(-1)!.at).getTime() - new Date(s0.now).getTime()).toBe(168 * 36e5);
    expect(frames.some((f) => f.newEvents.some((e) => e.kind === "voice_report"))).toBe(true);
  });

  it("autopilot averts stockout days versus doing nothing", () => {
    const c = compareWeek(s0, 168, 12);
    expect(c.withoutAction).toBeGreaterThan(c.withTransfers);
    expect(c.averted).toBeGreaterThan(0);
  });

  it("steps lazily to the end", () => {
    const p = createPlayback(s0, { hours: 24, stepHours: 6 });
    while (!p.done) p.next();
    expect(p.progress()).toBe(1);
  });

  it("generates deterministic seeded scenarios", () => {
    expect(generateScenario(7)).toEqual(generateScenario(7));
    expect(generateScenario(7).stock).not.toEqual(generateScenario(8).stock);
    expect(generateScenario(7).stock.find((r) => r.facilityId === "saraswati" && r.medicineId === "metformin-500")?.stock).toBe(16);
  });
});
