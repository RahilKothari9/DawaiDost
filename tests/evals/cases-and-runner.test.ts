import { describe, expect, it, vi } from "vitest";
import { EVAL_CASES, LIVE_SUBSET_IDS } from "../../lib/evals/cases";
import { makeConfig, parseNextAction, runBaseline, runCase, runPool } from "../../lib/evals/run";

type Snap = {
  target: { verified: boolean; reportFlag: string | null; gapUnits: number; dailyUse: number; weeklyDispensedTrend: number[] };
  donors: { verified: boolean; coversGapPct: number; transferable: number }[];
  upstream: { status: string } | null;
  districtStore: { daysOfDistrictDemand: number | null } | null;
  medicine: { leadTimeDays: number };
};
const snap = (id: string) => EVAL_CASES.find((c) => c.id === id)!.snapshot as unknown as Snap;

describe("labeled case set", () => {
  it("has 40-60 unique cases covering every action", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(40);
    expect(EVAL_CASES.length).toBeLessThanOrEqual(60);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    for (const a of ["verify_count", "transfer_surplus", "draft_indent", "escalate_supply_gap"]) expect(EVAL_CASES.some((c) => c.expected === a && !c.ambiguous)).toBe(true);
    for (const id of LIVE_SUBSET_IDS) expect(EVAL_CASES.some((c) => c.id === id)).toBe(true);
  });

  it("tags exactly the cases with acceptable alternatives as ambiguous", () => {
    for (const c of EVAL_CASES) {
      expect(c.ambiguous).toBe(c.acceptable.length > 0);
      expect(c.acceptable).not.toContain(c.expected);
      expect(c.reason.length).toBeGreaterThan(10);
    }
  });

  // The labels must follow from the snapshot facts under EVAL_POLICY; these checks keep them honest.
  it("labels follow the policy for unambiguous cases", () => {
    for (const c of EVAL_CASES.filter((x) => !x.ambiguous)) {
      const s = snap(c.id);
      const doubtful = !s.target.verified || !!s.target.reportFlag;
      const verifiedCover = s.donors.filter((d) => d.verified).reduce((m, d) => Math.max(m, d.coversGapPct), 0);
      const upstreamBad = s.upstream?.status !== "available" || (s.districtStore?.daysOfDistrictDemand ?? 99) < s.medicine.leadTimeDays;
      if (c.expected === "verify_count") {
        const trendPerDay = s.target.weeklyDispensedTrend.reduce((a, b) => a + b, 0) / s.target.weeklyDispensedTrend.length / 7;
        expect(doubtful || Math.abs(trendPerDay - s.target.dailyUse) > s.target.dailyUse / 2, c.id).toBe(true);
      } else {
        expect(doubtful, c.id).toBe(false);
        if (c.expected === "transfer_surplus") expect(verifiedCover, c.id).toBe(100);
        if (c.expected === "draft_indent") expect([verifiedCover < 60, upstreamBad], c.id).toEqual([true, false]);
        if (c.expected === "escalate_supply_gap") expect([verifiedCover < 60, upstreamBad], c.id).toEqual([true, true]);
      }
    }
  });

  it("snapshots carry the product facts shape", () => {
    for (const c of EVAL_CASES) {
      expect(c.snapshot.kind).toBe("dawai-dost/decision-snapshot@2");
      expect(c.snapshot.donors.every((d) => d.transferable > 0)).toBe(true);
    }
  });
});

describe("deterministic baseline", () => {
  it("returns a valid action for every case", () => {
    for (const c of EVAL_CASES) expect(["verify_count", "transfer_surplus", "draft_indent", "escalate_supply_gap"]).toContain(runBaseline(c).choice);
  });
});

describe("runner", () => {
  const c = EVAL_CASES[0];
  const okBody = { model: "gpt-6-luna", answers: [{ name: "next_action", type: "choice", choice: "transfer_surplus", confidence: 0.8, probabilities: [{ value: "transfer_surplus", probability: 0.8 }, { value: "draft_indent", probability: 0.2 }, { value: "bogus", probability: 0.5 }] }], usage: { input_tokens: 900, output_tokens: 12 } };

  it("parses next_action and ignores unknown probability values", () => {
    const p = parseNextAction(okBody);
    expect(p.choice).toBe("transfer_surplus");
    expect(p.probabilities).toEqual({ verify_count: 0, transfer_surplus: 0.8, draft_indent: 0.2, escalate_supply_gap: 0 });
    expect(() => parseNextAction({ answers: [{ name: "next_action", choice: "move_everything" }] })).toThrow();
  });

  it("retries 5xx then succeeds, recording attempts and tokens", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "x" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(okBody), { status: 200 }));
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    const r = await runCase(c, makeConfig("gpt-6-luna", "action_only", c), { key: "k", fetch });
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.inputTokens).toBe(900);
    const sent = JSON.parse(fetch.mock.calls[1][1].body);
    expect(sent.questions).toHaveLength(1);
    expect(JSON.parse(sent.input).kind).toBe("dawai-dost/decision-snapshot@2");
  });

  it("does not retry an exhausted quota", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }));
    const r = await runCase(c, makeConfig("gpt-6-luna", "minimal", c), { key: "k", fetch });
    expect(r.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends the full product question set for the product variant", () => {
    const cfg = makeConfig("gpt-6-luna", "product", c);
    expect(cfg.questions).toContain("next_action");
    expect(cfg.questions.length).toBeGreaterThan(1);
    expect(makeConfig("gpt-6-luna", "minimal", c).instructions.length).toBeLessThan(cfg.instructions.length);
  });

  it("bounds concurrency", async () => {
    let inFlight = 0, peak = 0;
    await runPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBe(3);
  });
});
