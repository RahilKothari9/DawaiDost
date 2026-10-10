// OWNER: evals agent. Shapes of the committed results file and the live-run stream. Safe for client and server.
import type { DecisionAction } from "../district/types";
import type { EvalCategory } from "./cases";

export type PromptVariantId = "product" | "action_only" | "minimal";

export type RunConfig = {
  id: string; // `${model}:${variant}`
  model: string;
  variant: PromptVariantId;
  /** The next_action instructions sent for this config, recorded verbatim. */
  instructions: string;
  /** Names of every question sent in the same call. */
  questions: string[];
};

export type CaseResult = {
  caseId: string;
  configId: string;
  ok: boolean;
  error?: string;
  choice: DecisionAction | null;
  confidence: number | null;
  probabilities: Record<DecisionAction, number> | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  attempts: number;
  modelReturned?: string | null;
};

export type BaselineResult = {
  caseId: string;
  choice: DecisionAction;
  confidence: number;
  probabilities: Record<DecisionAction, number>;
  ruleTrace: string[];
};

export type ResultsCase = {
  id: string;
  title: string;
  category: EvalCategory;
  expected: DecisionAction;
  acceptable: DecisionAction[];
  ambiguous: boolean;
  rule: string;
  reason: string;
  snapshot: Record<string, unknown>;
};

export type ResultsFile = {
  schema: "dawai-dost/evals@1";
  runId: string;
  startedAt: string;
  finishedAt: string;
  policyVersion: string;
  policy: string;
  concurrency: number;
  maxAttempts: number;
  timeoutMs: number;
  cases: ResultsCase[];
  configs: RunConfig[];
  results: CaseResult[];
  baseline: { name: string; source: string; results: BaselineResult[] };
  notes: string[];
};

export type LiveEvent =
  | { type: "start"; total: number; model: string; variant: PromptVariantId; live: boolean }
  | { type: "result"; index: number; caseId: string; expected: DecisionAction; acceptable: DecisionAction[]; baseline: DecisionAction; result: CaseResult }
  | { type: "done"; total: number; correct: number; baselineCorrect: number; failed: number; elapsedMs: number }
  | { type: "error"; message: string };
