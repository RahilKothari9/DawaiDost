// OWNER: evals agent. Product prompt versions and the committed runs that measured them. Numbers are never
// written here: they are computed from the results files.
import { computeMetrics } from "./metrics";
import { toPredictions } from "./report";
import type { ResultsFile } from "./types";

export type PromptVersion = {
  version: string;
  commit: string;
  /** Results file and config id that measured this version. */
  file: string;
  configId: string;
  change: string;
};

export const PROMPT_HISTORY: PromptVersion[] = [
  {
    version: "v1",
    commit: "d041df4",
    file: "data/evals/results-2026-10-10.json",
    configId: "gpt-6-luna:product",
    change: "Signals listed in prose (verification, days of stock, donor surplus, upstream), with no order between them. Generic choice descriptions: transfer applies whenever a donor has surplus.",
  },
  {
    version: "v2",
    commit: "a1699a5",
    file: "data/evals/results-2026-10-10-v2.json",
    configId: "gpt-6-luna:product",
    change: "Checks applied in order: verify, then transfer only when one verified donor covers the gap (or at least 75% of it), then escalate, then indent. The transfer choice description now carries the same coverage condition.",
  },
];

export type PromptHistoryRow = PromptVersion & {
  accuracy: number;
  correct: number;
  n: number;
  unambiguousAccuracy: number;
  ece: number | null;
  transferPicks: number;
  wrongTransfers: number;
  misses: string[];
};

export function promptHistory(runs: { file: string; data: ResultsFile }[]): PromptHistoryRow[] {
  return PROMPT_HISTORY.flatMap((v) => {
    const run = runs.find((r) => r.file === v.file);
    if (!run) return [];
    const preds = toPredictions(run.data.cases, run.data.results.filter((r) => r.configId === v.configId));
    if (!preds.length) return [];
    const m = computeMetrics(preds);
    const ok = (p: (typeof preds)[number]) => p.choice !== null && (p.choice === p.expected || p.acceptable.includes(p.choice));
    return [{
      ...v,
      accuracy: m.accuracy,
      correct: preds.filter(ok).length,
      n: m.n,
      unambiguousAccuracy: m.unambiguousAccuracy,
      ece: m.ece,
      transferPicks: preds.filter((p) => p.choice === "transfer_surplus").length,
      wrongTransfers: preds.filter((p) => p.choice === "transfer_surplus" && !ok(p)).length,
      misses: preds.filter((p) => !ok(p)).map((p) => p.caseId),
    }];
  });
}
