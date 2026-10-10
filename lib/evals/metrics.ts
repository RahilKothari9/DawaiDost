// OWNER: evals agent. Pure metrics over eval predictions. No I/O; safe for client and server.
import type { DecisionAction } from "../district/types";

export const EVAL_ACTIONS: DecisionAction[] = ["verify_count", "transfer_surplus", "draft_indent", "escalate_supply_gap"];

/** One graded prediction: what the case expected and what a system chose. */
export type Prediction = {
  caseId: string;
  category: string;
  expected: DecisionAction;
  acceptable: DecisionAction[];
  ambiguous: boolean;
  /** null when the call failed (counted as wrong, excluded from calibration). */
  choice: DecisionAction | null;
  confidence: number | null;
  probabilities: Record<DecisionAction, number> | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export type ReliabilityBin = { lo: number; hi: number; count: number; meanConfidence: number; accuracy: number };
export type PerAction = { action: DecisionAction; precision: number | null; recall: number | null; f1: number | null; support: number; predicted: number };
export type Pricing = { inputPerMTok: number; outputPerMTok: number };

export type Metrics = {
  n: number;
  answered: number;
  failed: number;
  /** Chosen === expected, or an accepted alternative on ambiguous cases. */
  accuracy: number;
  /** Chosen === expected exactly, all cases. */
  strictAccuracy: number;
  unambiguousN: number;
  unambiguousAccuracy: number;
  ambiguousN: number;
  ambiguousAccuracy: number;
  perAction: PerAction[];
  macroF1: number | null;
  /** confusion[expected][chosen]; failed calls are not counted. Expected = the primary label. */
  confusion: Record<DecisionAction, Record<DecisionAction, number>>;
  ece: number | null;
  reliability: ReliabilityBin[];
  /** Multi-class Brier score vs one-hot expected label, unambiguous answered cases only. 0 is perfect, 2 is worst. */
  brier: number | null;
  meanConfidence: number | null;
  latency: { mean: number | null; p50: number | null; p95: number | null };
  tokens: { input: number; output: number; perCase: number | null };
  costUsd: number | null;
  highConfidenceErrors: { caseId: string; expected: DecisionAction; choice: DecisionAction; confidence: number }[];
  byCategory: { category: string; n: number; correct: number; accuracy: number }[];
};

export function isCorrect(p: Pick<Prediction, "expected" | "acceptable" | "choice">): boolean {
  return p.choice !== null && (p.choice === p.expected || p.acceptable.includes(p.choice));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Nearest-rank percentile (q in 0..1) of a non-empty list. */
export function percentile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1];
}

export function emptyConfusion(): Record<DecisionAction, Record<DecisionAction, number>> {
  return Object.fromEntries(EVAL_ACTIONS.map((e) => [e, Object.fromEntries(EVAL_ACTIONS.map((c) => [c, 0]))])) as Record<DecisionAction, Record<DecisionAction, number>>;
}

/** Equal-width confidence bins. Returns only non-empty bins, plus ECE = sum(n_b/N * |acc_b - conf_b|). */
export function reliability(points: { confidence: number; correct: boolean }[], bins = 5): { bins: ReliabilityBin[]; ece: number | null } {
  if (!points.length) return { bins: [], ece: null };
  const out: ReliabilityBin[] = [];
  let ece = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const inBin = points.filter((p) => (b === bins - 1 ? p.confidence >= lo && p.confidence <= hi : p.confidence >= lo && p.confidence < hi));
    if (!inBin.length) continue;
    const conf = mean(inBin.map((p) => p.confidence))!;
    const acc = inBin.filter((p) => p.correct).length / inBin.length;
    ece += (inBin.length / points.length) * Math.abs(acc - conf);
    out.push({ lo, hi, count: inBin.length, meanConfidence: conf, accuracy: acc });
  }
  return { bins: out, ece };
}

/** Multi-class Brier for one prediction against a one-hot label. */
export function brierOne(probabilities: Record<DecisionAction, number>, expected: DecisionAction): number {
  return EVAL_ACTIONS.reduce((s, a) => s + ((probabilities[a] ?? 0) - (a === expected ? 1 : 0)) ** 2, 0);
}

export function computeMetrics(preds: Prediction[], opts: { pricing?: Pricing | null; highConfidence?: number; bins?: number } = {}): Metrics {
  const n = preds.length;
  const answered = preds.filter((p) => p.choice !== null);
  const correct = preds.filter(isCorrect);
  const unamb = preds.filter((p) => !p.ambiguous);
  const amb = preds.filter((p) => p.ambiguous);

  const confusion = emptyConfusion();
  for (const p of answered) confusion[p.expected][p.choice!]++;

  // Per-action precision/recall: a prediction of action a is a true positive when it is correct and equals a
  // (so an accepted alternative counts for the action actually chosen); support = cases whose expected label is a.
  const perAction: PerAction[] = EVAL_ACTIONS.map((a) => {
    const predicted = answered.filter((p) => p.choice === a);
    const tp = predicted.filter(isCorrect).length;
    const support = preds.filter((p) => p.expected === a).length;
    const recallHits = preds.filter((p) => p.expected === a && p.choice === a).length;
    const precision = predicted.length ? tp / predicted.length : null;
    const recall = support ? recallHits / support : null;
    const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : precision !== null && recall !== null ? 0 : null;
    return { action: a, precision, recall, f1, support, predicted: predicted.length };
  });
  const f1s = perAction.map((x) => x.f1).filter((x): x is number => x !== null);

  const calPoints = answered.filter((p) => typeof p.confidence === "number").map((p) => ({ confidence: p.confidence!, correct: isCorrect(p) }));
  const rel = reliability(calPoints, opts.bins ?? 5);

  const brierPts = unamb.filter((p) => p.choice !== null && p.probabilities).map((p) => brierOne(p.probabilities!, p.expected));

  const latencies = answered.map((p) => p.latencyMs).filter((x): x is number => typeof x === "number");
  const inTok = preds.reduce((s, p) => s + (p.inputTokens ?? 0), 0);
  const outTok = preds.reduce((s, p) => s + (p.outputTokens ?? 0), 0);
  const tokCases = preds.filter((p) => typeof p.inputTokens === "number").length;
  const pricing = opts.pricing ?? null;
  const hc = opts.highConfidence ?? 0.7;

  const cats = [...new Set(preds.map((p) => p.category))];
  return {
    n,
    answered: answered.length,
    failed: n - answered.length,
    accuracy: ratio(correct.length, n),
    strictAccuracy: ratio(preds.filter((p) => p.choice === p.expected).length, n),
    unambiguousN: unamb.length,
    unambiguousAccuracy: ratio(unamb.filter(isCorrect).length, unamb.length),
    ambiguousN: amb.length,
    ambiguousAccuracy: ratio(amb.filter(isCorrect).length, amb.length),
    perAction,
    macroF1: mean(f1s),
    confusion,
    ece: rel.ece,
    reliability: rel.bins,
    brier: mean(brierPts),
    meanConfidence: mean(calPoints.map((p) => p.confidence)),
    latency: { mean: mean(latencies), p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    tokens: { input: inTok, output: outTok, perCase: tokCases ? (inTok + outTok) / tokCases : null },
    costUsd: pricing && tokCases ? (inTok * pricing.inputPerMTok + outTok * pricing.outputPerMTok) / 1e6 : null,
    highConfidenceErrors: answered
      .filter((p) => !isCorrect(p) && (p.confidence ?? 0) >= hc)
      .map((p) => ({ caseId: p.caseId, expected: p.expected, choice: p.choice!, confidence: p.confidence! }))
      .sort((a, b) => b.confidence - a.confidence),
    byCategory: cats.map((c) => {
      const items = preds.filter((p) => p.category === c);
      const ok = items.filter(isCorrect).length;
      return { category: c, n: items.length, correct: ok, accuracy: ratio(ok, items.length) };
    }),
  };
}

/** Cases where two systems disagree on correctness: where model judgment helps or hurts versus a baseline. */
export function compareSystems(a: Prediction[], b: Prediction[]): { aOnly: string[]; bOnly: string[]; both: string[]; neither: string[] } {
  const byId = new Map(b.map((p) => [p.caseId, p]));
  const out = { aOnly: [] as string[], bOnly: [] as string[], both: [] as string[], neither: [] as string[] };
  for (const p of a) {
    const q = byId.get(p.caseId);
    if (!q) continue;
    const ca = isCorrect(p), cb = isCorrect(q);
    (ca && cb ? out.both : ca ? out.aOnly : cb ? out.bOnly : out.neither).push(p.caseId);
  }
  return out;
}
