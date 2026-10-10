// OWNER: evals agent. Joins cases with results into graded predictions and metrics. Pure; safe for client and server.
import { computeMetrics, type Metrics, type Prediction, type Pricing } from "./metrics";
import type { BaselineResult, CaseResult, ResultsCase, ResultsFile } from "./types";

type CaseLike = Pick<ResultsCase, "id" | "category" | "expected" | "acceptable" | "ambiguous">;

/**
 * USD per 1M tokens. Left null on purpose: we do not publish rates we have not verified for these models.
 * Fill in from the OpenAI pricing page to turn the token totals into a cost estimate.
 */
export const PRICING: Record<string, Pricing | null> = {
  "gpt-6-luna": null,
  "gpt-6-sol": null,
  "gpt-6.1-sol": null,
  "gpt-5.5": null,
  "gpt-5.4-mini": null,
};

export function toPredictions(cases: CaseLike[], results: CaseResult[]): Prediction[] {
  const byId = new Map(results.map((r) => [r.caseId, r]));
  return cases.flatMap((c) => {
    const r = byId.get(c.id);
    if (!r) return [];
    return [{ caseId: c.id, category: c.category, expected: c.expected, acceptable: c.acceptable, ambiguous: c.ambiguous, choice: r.ok ? r.choice : null, confidence: r.ok ? r.confidence : null, probabilities: r.ok ? r.probabilities : null, latencyMs: r.latencyMs, inputTokens: r.inputTokens, outputTokens: r.outputTokens }];
  });
}

export function baselinePredictions(cases: CaseLike[], baseline: BaselineResult[]): Prediction[] {
  const byId = new Map(baseline.map((r) => [r.caseId, r]));
  return cases.flatMap((c) => {
    const r = byId.get(c.id);
    return r ? [{ caseId: c.id, category: c.category, expected: c.expected, acceptable: c.acceptable, ambiguous: c.ambiguous, choice: r.choice, confidence: r.confidence, probabilities: r.probabilities }] : [];
  });
}

export function gradeConfig(cases: CaseLike[], results: CaseResult[], model?: string): Metrics {
  return computeMetrics(toPredictions(cases, results), { pricing: model ? PRICING[model] ?? null : null });
}

export function gradeBaseline(cases: CaseLike[], baseline: BaselineResult[]): Metrics {
  return computeMetrics(baselinePredictions(cases, baseline));
}

export type ConfigReport = { id: string; model: string; variant: string; label: string; metrics: Metrics; predictions: Prediction[] };

export function buildReport(file: ResultsFile): { configs: ConfigReport[]; baseline: ConfigReport } {
  const configs = file.configs.map((cfg) => {
    const rs = file.results.filter((r) => r.configId === cfg.id);
    const predictions = toPredictions(file.cases, rs);
    return { id: cfg.id, model: cfg.model, variant: cfg.variant, label: cfg.id, metrics: computeMetrics(predictions, { pricing: PRICING[cfg.model] ?? null }), predictions };
  });
  const bp = baselinePredictions(file.cases, file.baseline.results);
  return { configs, baseline: { id: "rules", model: "rules", variant: "fallback", label: file.baseline.name, metrics: computeMetrics(bp), predictions: bp } };
}
