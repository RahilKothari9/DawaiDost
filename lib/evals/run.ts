// OWNER: evals agent. Server-only eval runner: sends labeled cases to the live Decisions API with bounded
// concurrency and retries, and grades the product's deterministic fallback on the same cases.
import type { DecisionCreateParams } from "openai/resources/decisions";
import { buildQuestions, DISTRICT_ACTION_CHOICES, extractDonors, fallbackDecision, NEXT_ACTION_INSTRUCTIONS } from "../ai/decide";
import { actionChoices } from "../scenario";
import type { DecisionAction } from "../district/types";
import type { EvalCase } from "./cases";
import { EVAL_ACTIONS } from "./metrics";
import type { BaselineResult, CaseResult, PromptVariantId, RunConfig } from "./types";

export const DECISIONS_URL = "https://api.openai.com/v1/decisions";

/** Models the live-run endpoint accepts (all verified to exist on the Decisions API). */
export const EVAL_MODELS = ["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-5.5", "gpt-5.4-mini"] as const;
/** Probed 2026-10-10 with the project key: only gpt-6-luna is enabled on /v1/decisions; the others return 404 model_not_found. */
export const DECISIONS_ENABLED_MODELS = ["gpt-6-luna"] as const;

/** Instructions for the "minimal" variant: no signals named, no policy, bare choice labels. */
export const MINIMAL_INSTRUCTIONS = "Choose the next action for the target facility.";
const MINIMAL_CHOICES = [
  { value: "verify_count", description: "Verify stock count." },
  { value: "transfer_surplus", description: "Transfer stock from a nearby facility." },
  { value: "draft_indent", description: "Draft a district indent." },
  { value: "escalate_supply_gap", description: "Escalate the supply gap." },
];

/**
 * HISTORICAL, frozen: the product's next_action prompt before the eval-driven fix (lib/ai/decide.ts before
 * commit a1699a5). Measured 64% on 2026-10-10 (results-2026-10-10.json). Kept only so `product_v1` can be rerun.
 */
export const PRODUCT_V1_INSTRUCTIONS =
  "Choose the single safest next operational step for the target facility. Consider report verification (verified flag, reportFlag, report age), days of stock against the resupply lead time plus safety buffer, inbound transfers, donor surplus after its reserve, and whether the action can bridge the gap. Prefer a local transfer when a verified donor has sufficient surplus and preserve every donor's reserve. Do not treat a transfer as a cure for upstream shortages: when upstream supply is delayed or unavailable and local surplus cannot cover the gap, escalate. The officer must approve all actions. If the snapshot contains a counterfactual field, judge that hypothetical scenario as stated.";
/** HISTORICAL, frozen: v1 used the generic lib/scenario.ts choice descriptions. */
export const PRODUCT_V1_CHOICES = actionChoices;

/**
 * Candidate instructions that state the decision criteria explicitly. Caveat: these mirror EVAL_POLICY, the same
 * policy the labels follow, so a gain here shows the model can follow stated criteria, not independent judgment.
 */
export const POLICY_INSTRUCTIONS =
  "Choose the single safest next operational step for the target facility. Apply these checks in order and stop at the first that holds. 1) If the target's count is unverified, has a reportFlag, is under recount, or its dailyUse is far from weeklyDispensedTrend divided by 7, choose verify_count. 2) If one verified donor's transferable units (already net of its own reserve) cover the target's gapUnits (coversGapPct 100), choose transfer_surplus. A donor that covers only part of the gap does not qualify, and unverified donors never count. 3) If no verified donor covers the gap and upstream status is delayed or unavailable, or districtStore.daysOfDistrictDemand is below the medicine's leadTimeDays, choose escalate_supply_gap. 4) Otherwise choose draft_indent. The officer must approve all actions.";

export const PROMPT_VARIANTS: Record<PromptVariantId, { label: string; description: string }> = {
  product_v1: { label: "Product call v1 (historical)", description: "Frozen pre-fix next_action prompt (generic choices, signals listed but no ordered criteria) inside the current product question set." },
  product: { label: "Product call", description: "Exactly what /api/decisions/district sends: next_action plus urgency, recount, indent-timing and donor questions in one call." },
  action_only: { label: "Action only", description: "Product instructions and choice descriptions, but next_action is the only question." },
  minimal: { label: "Minimal prompt", description: "One-line instruction and bare choice labels. Same snapshot." },
  policy: { label: "Explicit criteria", description: "Candidate: product choices with the decision criteria spelled out in order. Mirrors the labeling policy." },
};

export function buildEvalQuestions(c: EvalCase, variant: PromptVariantId): DecisionCreateParams["questions"] {
  if (variant === "product") return buildQuestions(extractDonors(c.snapshot));
  if (variant === "policy") return [{ type: "choice", name: "next_action", instructions: POLICY_INSTRUCTIONS, choices: actionChoices }];
  if (variant === "action_only") return [{ type: "choice", name: "next_action", instructions: NEXT_ACTION_INSTRUCTIONS, choices: DISTRICT_ACTION_CHOICES }];
  if (variant === "product_v1") {
    // Current companion questions with the frozen v1 next_action question swapped in.
    return buildQuestions(extractDonors(c.snapshot)).map((q) => (q.name === "next_action" ? { type: "choice" as const, name: "next_action", instructions: PRODUCT_V1_INSTRUCTIONS, choices: PRODUCT_V1_CHOICES } : q));
  }
  return [{ type: "choice", name: "next_action", instructions: MINIMAL_INSTRUCTIONS, choices: MINIMAL_CHOICES }];
}

export function makeConfig(model: string, variant: PromptVariantId, sample: EvalCase): RunConfig {
  const qs = buildEvalQuestions(sample, variant);
  const next = qs.find((q) => q.name === "next_action") as { instructions?: string } | undefined;
  return { id: `${model}:${variant}`, model, variant, instructions: next?.instructions ?? "", questions: qs.map((q) => q.name ?? "") };
}

type Fetch = typeof globalThis.fetch;
export type CallOptions = { key: string; maxAttempts?: number; timeoutMs?: number; fetch?: Fetch; signal?: AbortSignal };

class FatalError extends Error {}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

type RawAnswer = { name?: string; type?: string; choice?: unknown; confidence?: unknown; probabilities?: { value?: unknown; probability?: unknown }[] };

/** Parse the next_action answer into a graded-ready shape. Throws on anything the product would also reject. */
export function parseNextAction(payload: unknown): Pick<CaseResult, "choice" | "confidence" | "probabilities"> {
  const answers = (payload as { answers?: RawAnswer[] })?.answers;
  if (!Array.isArray(answers)) throw new Error("missing answers");
  const a = answers.find((x) => x.name === "next_action");
  if (!a) throw new Error("next_action missing");
  if (a.type === "refusal") throw new Error("next_action refused");
  if (typeof a.choice !== "string" || !EVAL_ACTIONS.includes(a.choice as DecisionAction)) throw new Error("invalid next_action choice");
  const probabilities = Object.fromEntries(EVAL_ACTIONS.map((x) => [x, 0])) as Record<DecisionAction, number>;
  for (const p of a.probabilities ?? []) {
    if (typeof p.value === "string" && p.value in probabilities && typeof p.probability === "number" && Number.isFinite(p.probability)) probabilities[p.value as DecisionAction] = p.probability;
  }
  const choice = a.choice as DecisionAction;
  const confidence = typeof a.confidence === "number" && Number.isFinite(a.confidence) ? a.confidence : probabilities[choice];
  return { choice, confidence, probabilities };
}

/** One case × one config against the live API, with retries on 429 / 5xx / network errors. Never throws. */
export async function runCase(c: EvalCase, config: RunConfig, opts: CallOptions): Promise<CaseResult> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const body = JSON.stringify({ model: config.model, input: JSON.stringify(c.snapshot), questions: buildEvalQuestions(c, config.variant) });
  const base = { caseId: c.id, configId: config.id };
  let lastError = "unknown";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) return { ...base, ok: false, error: "aborted", choice: null, confidence: null, probabilities: null, latencyMs: null, inputTokens: null, outputTokens: null, attempts: attempt - 1 };
    const started = performance.now();
    try {
      const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const res = await doFetch(DECISIONS_URL, { method: "POST", headers: { Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" }, body, signal });
      const latencyMs = Math.round(performance.now() - started);
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string; type?: string }; usage?: { input_tokens?: number; output_tokens?: number }; model?: string } | null;
      if (!res.ok) {
        const code = payload?.error?.code ?? payload?.error?.type ?? "";
        lastError = `HTTP ${res.status}${code ? ` ${code}` : ""}`;
        const retryable = (res.status === 429 && !/quota|credit/i.test(code)) || res.status >= 500;
        if (!retryable) throw new FatalError(lastError);
        await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 300, opts.signal);
        continue;
      }
      let parsed: ReturnType<typeof parseNextAction>;
      try {
        parsed = parseNextAction(payload);
      } catch (error) {
        throw new FatalError(error instanceof Error ? error.message : "unexpected response");
      }
      return {
        ...base,
        ok: true,
        ...parsed,
        latencyMs,
        inputTokens: payload?.usage?.input_tokens ?? null,
        outputTokens: payload?.usage?.output_tokens ?? null,
        attempts: attempt,
        modelReturned: payload?.model ?? null,
      };
    } catch (error) {
      if (error instanceof FatalError) return { ...base, ok: false, error: error.message, choice: null, confidence: null, probabilities: null, latencyMs: null, inputTokens: null, outputTokens: null, attempts: attempt };
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(1000 * 2 ** (attempt - 1), opts.signal);
    }
  }
  return { ...base, ok: false, error: lastError, choice: null, confidence: null, probabilities: null, latencyMs: null, inputTokens: null, outputTokens: null, attempts: maxAttempts };
}

/** Run jobs with at most `concurrency` in flight; `onResult` fires as each finishes. */
export async function runPool<J, R>(jobs: J[], concurrency: number, work: (job: J, index: number) => Promise<R>, onResult?: (r: R, index: number) => void): Promise<R[]> {
  const out = new Array<R>(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await work(jobs[i], i);
      onResult?.(out[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
  return out;
}

/** The product's deterministic fallback (lib/ai/decide.ts fallbackDecision), applied to the same snapshot. */
export function runBaseline(c: EvalCase): BaselineResult {
  const fb = fallbackDecision(c.snapshot, extractDonors(c.snapshot));
  return { caseId: c.id, choice: fb.action, confidence: fb.confidence, probabilities: fb.probabilities, ruleTrace: fb.meta.ruleTrace ?? [] };
}

export const BASELINE_SOURCE = "lib/ai/decide.ts fallbackDecision()";
