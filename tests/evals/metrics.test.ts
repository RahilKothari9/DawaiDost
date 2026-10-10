import { describe, expect, it } from "vitest";
import { brierOne, compareSystems, computeMetrics, isCorrect, percentile, reliability, type Prediction } from "../../lib/evals/metrics";
import type { DecisionAction } from "../../lib/district/types";

const probs = (top: DecisionAction, p: number): Record<DecisionAction, number> => {
  const rest = (1 - p) / 3;
  return { verify_count: rest, transfer_surplus: rest, draft_indent: rest, escalate_supply_gap: rest, [top]: p };
};

function pred(id: string, expected: DecisionAction, choice: DecisionAction | null, confidence = 0.9, extra: Partial<Prediction> = {}): Prediction {
  return { caseId: id, category: "c", expected, acceptable: [], ambiguous: false, choice, confidence: choice ? confidence : null, probabilities: choice ? probs(choice, confidence) : null, latencyMs: 100, inputTokens: 10, outputTokens: 2, ...extra };
}

describe("isCorrect", () => {
  it("accepts the expected label and listed alternatives only", () => {
    expect(isCorrect({ expected: "transfer_surplus", acceptable: [], choice: "transfer_surplus" })).toBe(true);
    expect(isCorrect({ expected: "transfer_surplus", acceptable: ["draft_indent"], choice: "draft_indent" })).toBe(true);
    expect(isCorrect({ expected: "transfer_surplus", acceptable: [], choice: "draft_indent" })).toBe(false);
    expect(isCorrect({ expected: "transfer_surplus", acceptable: [], choice: null })).toBe(false);
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.95)).toBe(19);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("reliability / ECE", () => {
  it("measures the gap between confidence and accuracy", () => {
    const pts = [
      ...Array.from({ length: 4 }, () => ({ confidence: 0.9, correct: true })), // all correct at 0.9 → gap 0.1
    ];
    const r = reliability(pts, 5);
    expect(r.bins).toHaveLength(1);
    expect(r.ece).toBeCloseTo(0.1, 6);
  });

  it("weights bins by count", () => {
    const pts = [{ confidence: 0.1, correct: false }, { confidence: 0.1, correct: false }, { confidence: 0.9, correct: true }, { confidence: 0.9, correct: false }];
    const r = reliability(pts, 5);
    // bin [0,0.2): acc 0, conf 0.1 → 0.1 ; bin [0.8,1]: acc 0.5, conf 0.9 → 0.4 ; each weight 0.5
    expect(r.ece).toBeCloseTo(0.25, 6);
    expect(r.bins.map((b) => b.count)).toEqual([2, 2]);
  });

  it("puts confidence 1.0 in the top bin", () => {
    expect(reliability([{ confidence: 1, correct: true }], 5).bins[0].hi).toBe(1);
  });
});

describe("brier", () => {
  it("is 0 for a perfect one-hot and 2 for a confident wrong answer", () => {
    expect(brierOne({ verify_count: 0, transfer_surplus: 1, draft_indent: 0, escalate_supply_gap: 0 }, "transfer_surplus")).toBe(0);
    expect(brierOne({ verify_count: 1, transfer_surplus: 0, draft_indent: 0, escalate_supply_gap: 0 }, "transfer_surplus")).toBe(2);
  });
});

describe("computeMetrics", () => {
  const preds: Prediction[] = [
    pred("a", "transfer_surplus", "transfer_surplus", 0.95),
    pred("b", "transfer_surplus", "draft_indent", 0.8),
    pred("c", "draft_indent", "draft_indent", 0.7),
    pred("d", "verify_count", null, 0.9, { inputTokens: null, outputTokens: null, latencyMs: null }),
    pred("e", "transfer_surplus", "draft_indent", 0.55, { ambiguous: true, acceptable: ["draft_indent"] }),
  ];
  const m = computeMetrics(preds, { pricing: { inputPerMTok: 1, outputPerMTok: 4 } });

  it("counts accuracy with and without accepted alternatives", () => {
    expect(m.n).toBe(5);
    expect(m.failed).toBe(1);
    expect(m.accuracy).toBeCloseTo(3 / 5);
    expect(m.strictAccuracy).toBeCloseTo(2 / 5);
    expect(m.unambiguousAccuracy).toBeCloseTo(2 / 4);
    expect(m.ambiguousAccuracy).toBe(1);
  });

  it("builds the confusion matrix from answered cases", () => {
    expect(m.confusion.transfer_surplus.transfer_surplus).toBe(1);
    expect(m.confusion.transfer_surplus.draft_indent).toBe(2);
    expect(m.confusion.draft_indent.draft_indent).toBe(1);
    expect(m.confusion.verify_count.verify_count).toBe(0);
  });

  it("computes per-action precision and recall", () => {
    const t = m.perAction.find((x) => x.action === "transfer_surplus")!;
    expect(t.precision).toBe(1);
    expect(t.recall).toBeCloseTo(1 / 3);
    const d = m.perAction.find((x) => x.action === "draft_indent")!;
    expect(d.predicted).toBe(3);
    expect(d.precision).toBeCloseTo(2 / 3); // c correct, e accepted alternative, b wrong
    expect(d.recall).toBe(1);
    const v = m.perAction.find((x) => x.action === "verify_count")!;
    expect(v.precision).toBeNull();
    expect(v.recall).toBe(0);
  });

  it("lists high-confidence errors, sorted", () => {
    expect(m.highConfidenceErrors).toEqual([{ caseId: "b", expected: "transfer_surplus", choice: "draft_indent", confidence: 0.8 }]);
  });

  it("estimates cost and latency from answered calls", () => {
    expect(m.tokens.input).toBe(40);
    expect(m.tokens.output).toBe(8);
    expect(m.costUsd).toBeCloseTo((40 * 1 + 8 * 4) / 1e6);
    expect(m.latency.mean).toBe(100);
  });

  it("computes Brier on unambiguous answered cases", () => {
    const expected = (brierOne(probs("transfer_surplus", 0.95), "transfer_surplus") + brierOne(probs("draft_indent", 0.8), "transfer_surplus") + brierOne(probs("draft_indent", 0.7), "draft_indent")) / 3;
    expect(m.brier).toBeCloseTo(expected, 10);
  });
});

describe("compareSystems", () => {
  it("splits cases by which system got them right", () => {
    const a = [pred("1", "transfer_surplus", "transfer_surplus"), pred("2", "draft_indent", "transfer_surplus")];
    const b = [pred("1", "transfer_surplus", "draft_indent"), pred("2", "draft_indent", "draft_indent")];
    expect(compareSystems(a, b)).toEqual({ aOnly: ["1"], bOnly: ["2"], both: [], neither: [] });
  });
});
