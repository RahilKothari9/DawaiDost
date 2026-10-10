// OWNER: ai agent. Server-side district decision: one Decisions API call, many questions, strict validation,
// deterministic fallback that mirrors the engine rules. Used by /api/decisions/district and /api/decisions/batch.
import { z } from "zod";
import type { Decision, DecisionCreateParams } from "openai/resources/decisions";
import { actionChoices } from "../scenario";
import type { DecisionAction } from "../district/types";
import { apiKey, callDecisions, MODELS, UpstreamError } from "./openai";
import { URGENCY_LEVELS, type AiDecisionMeta, type AiDecisionRecord, type UrgencyLevel } from "./types";

export const ACTIONS = actionChoices.map((c) => c.value) as DecisionAction[];

export const NEXT_ACTION_INSTRUCTIONS =
  "Choose the single safest next operational step for the target facility. Consider report verification (verified flag, reportFlag, report age), days of stock against the resupply lead time plus safety buffer, inbound transfers, donor surplus after its reserve, and whether the action can bridge the gap. Prefer a local transfer when a verified donor has sufficient surplus and preserve every donor's reserve. Do not treat a transfer as a cure for upstream shortages: when upstream supply is delayed or unavailable and local surplus cannot cover the gap, escalate. The officer must approve all actions. If the snapshot contains a counterfactual field, judge that hypothetical scenario as stated.";

// ---------- request validation ----------

const id = z.string().trim().min(1).max(80).regex(/^[\w.:-]+$/);

export const districtRequestSchema = z.object({
  facilityId: id,
  medicineId: id,
  snapshot: z.record(z.string(), z.unknown()).refine((s) => JSON.stringify(s).length <= 40_000, "snapshot too large"),
  donorIds: z.array(id).max(6).optional(),
});
export type ValidDistrictRequest = z.infer<typeof districtRequestSchema>;

/** Loose view of the facts we rely on; tolerates engine snapshots that only carry part of it. */
const num = z.number().finite();
const factsView = z.object({
  medicine: z.object({ name: z.string().optional(), leadTimeDays: num.optional(), safetyBufferDays: num.optional() }).partial().optional(),
  target: z.object({
    name: z.string(), stock: num, dailyUse: num, daysOfStock: num.nullable(), thresholdDays: num, risk: z.string(), gapUnits: num,
    verified: z.boolean(), reportFlag: z.string().nullable(), inboundUnits: num,
  }).partial().optional(),
  donors: z.array(z.object({ facilityId: z.string(), name: z.string().optional(), distanceKm: num.optional(), transferable: num.optional(), coversGapPct: num.optional(), verified: z.boolean().optional() }).passthrough()).optional(),
  donorCandidates: z.array(z.object({ facilityId: z.string(), name: z.string().optional(), distanceKm: num.optional(), transferable: num.optional(), eligible: z.boolean().optional() }).passthrough()).optional(),
  upstream: z.object({ status: z.string() }).passthrough().nullable().optional(),
  districtStore: z.object({ daysOfDistrictDemand: num.nullable().optional() }).passthrough().nullable().optional(),
}).passthrough();
type FactsView = z.infer<typeof factsView>;

export type DonorOption = { facilityId: string; name: string; distanceKm?: number; transferable: number; coversGapPct?: number; verified?: boolean };

export function extractDonors(snapshot: Record<string, unknown>, only?: string[]): DonorOption[] {
  const v = factsView.safeParse(snapshot);
  if (!v.success) return [];
  const raw = v.data.donors ?? v.data.donorCandidates?.filter((d) => d.eligible !== false) ?? [];
  const list = raw
    .map((d) => ({ facilityId: d.facilityId, name: d.name ?? d.facilityId, distanceKm: d.distanceKm, transferable: d.transferable ?? 0, coversGapPct: (d as { coversGapPct?: number }).coversGapPct, verified: (d as { verified?: boolean }).verified }))
    .filter((d) => d.transferable > 0 && (!only || only.includes(d.facilityId)));
  return list.slice(0, 3);
}

// ---------- question set ----------

export function buildQuestions(donors: DonorOption[]): DecisionCreateParams["questions"] {
  const qs: DecisionCreateParams["questions"] = [
    { type: "choice", name: "next_action", instructions: NEXT_ACTION_INSTRUCTIONS, choices: actionChoices },
    {
      type: "score",
      name: "urgency",
      instructions: "How soon must the officer act on the target facility, given days of stock versus lead time, the projected stockout date, and inbound stock?",
      levels: [
        { label: "monitor", description: "Stock covers the lead time plus buffer, or the gap is already covered by inbound stock. Review at the next cycle." },
        { label: "this_week", description: "Stock runs below the lead time plus buffer within the week; act in the next few days." },
        { label: "today", description: "Stockout has happened or will happen before resupply could arrive; act today." },
      ],
    },
    {
      type: "predicate",
      name: "recount_needed",
      instructions: "Is the target's latest stock count doubtful enough that it should be re-verified before any stock is moved or ordered? Consider the verified flag, reportFlag, report age and the dispensing trend.",
    },
    {
      type: "predicate",
      name: "indent_arrives_in_time",
      instructions: "Would a routine district indent placed today arrive before the target runs out? Compare days of stock with the resupply lead time and consider upstream supply status and district store stock.",
    },
  ];
  if (donors.length) {
    qs.push({
      type: "choice",
      name: "donor",
      instructions: "If stock is moved to the target, which donor should send it? Prefer verified donors whose safe surplus (already net of reserve) covers most of the gap at the shortest distance. Choose false when no donor can safely help.",
      choices: [
        ...donors.map((d) => ({
          value: d.facilityId,
          description: `${d.name}: ${d.transferable} units transferable after reserve${d.distanceKm !== undefined ? `, ${d.distanceKm} km away` : ""}${d.coversGapPct !== undefined ? `, covers ${d.coversGapPct}% of the gap` : ""}${d.verified === false ? ", count unverified" : ""}.`,
        })),
        { value: false, description: "No donor: none can safely bridge the gap." },
      ],
    });
    qs.push({
      type: "predicate",
      name: "transfer_bridges_gap",
      instructions: "Would a transfer from the best donor alone bridge the target's gap until resupply, without pushing that donor below its reserve?",
    });
  }
  return qs;
}

// ---------- mapping ----------

type Answer = Decision["answers"][number];
const byName = (answers: Answer[], name: string) => answers.find((a) => a.name === name);

export function emptyProbabilities(): Record<DecisionAction, number> {
  return Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<DecisionAction, number>;
}

function clamp01(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

export function mapDecision(decision: Decision, donors: DonorOption[], askedQuestions: string[]): { action: DecisionAction; confidence: number; probabilities: Record<DecisionAction, number>; meta: Omit<AiDecisionMeta, "model" | "latencyMs" | "usage" | "engine"> } {
  const answers = decision.answers;
  const next = byName(answers, "next_action");
  if (!next || next.type === "refusal") throw new UpstreamError("unexpected_response", next ? "next_action refused" : "next_action missing");
  if (next.type !== "choice" || typeof next.choice !== "string" || !ACTIONS.includes(next.choice as DecisionAction)) throw new UpstreamError("unexpected_response", "invalid next_action choice");
  const action = next.choice as DecisionAction;
  const probabilities = emptyProbabilities();
  for (const p of next.probabilities ?? []) {
    const v = clamp01(p.probability);
    if (typeof p.value === "string" && p.value in probabilities && v !== null) probabilities[p.value as DecisionAction] = v;
  }
  const confidence = clamp01(next.confidence) ?? probabilities[action];
  const refusals = answers.filter((a) => a.type === "refusal").map((a) => a.name ?? "(unnamed)");

  // urgency score
  const urgencyProbabilities = Object.fromEntries(URGENCY_LEVELS.map((l) => [l, 0])) as Record<UrgencyLevel, number>;
  let urgencyScore = 0;
  let urgencyConfidence = 0;
  const u = byName(answers, "urgency");
  if (u?.type === "score") {
    for (const p of u.probabilities ?? []) if ((URGENCY_LEVELS as readonly string[]).includes(p.label)) urgencyProbabilities[p.label as UrgencyLevel] = clamp01(p.probability) ?? 0;
    urgencyScore = typeof u.score === "number" && Number.isFinite(u.score) ? Math.min(2, Math.max(0, u.score)) : 0;
    urgencyConfidence = clamp01(u.confidence) ?? 0;
  }
  const urgencyLevel = (Object.entries(urgencyProbabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "monitor") as UrgencyLevel;

  const pred = (name: string) => {
    const a = byName(answers, name);
    return a?.type === "predicate" ? clamp01(a.probability) : null;
  };

  let donor: AiDecisionMeta["donor"] = null;
  const d = byName(answers, "donor");
  if (d?.type === "choice") {
    const valid = d.choice === false || (typeof d.choice === "string" && donors.some((x) => x.facilityId === d.choice));
    if (valid) {
      donor = {
        facilityId: typeof d.choice === "string" ? d.choice : null,
        confidence: clamp01(d.confidence) ?? 0,
        probabilities: (d.probabilities ?? []).filter((p) => p.value === false || (typeof p.value === "string" && donors.some((x) => x.facilityId === p.value))).map((p) => ({ value: p.value as string | false, probability: clamp01(p.probability) ?? 0 })),
      };
    }
  }
  if (!donor && action === "transfer_surplus" && donors[0]) donor = { facilityId: donors[0].facilityId, confidence: 0, probabilities: [] };

  return {
    action,
    confidence,
    probabilities,
    meta: {
      questions: askedQuestions,
      urgencyLevel,
      urgencyScore,
      urgencyConfidence,
      urgencyProbabilities,
      recountProbability: pred("recount_needed") ?? 0,
      indentInTime: pred("indent_arrives_in_time"),
      transferBridgesGap: pred("transfer_bridges_gap"),
      donor,
      refusals,
    },
  };
}

// ---------- deterministic fallback (mirrors the engine rules) ----------

const TEMPLATES: Record<DecisionAction, Record<DecisionAction, number>> = {
  verify_count: { verify_count: 0.74, transfer_surplus: 0.1, draft_indent: 0.1, escalate_supply_gap: 0.06 },
  transfer_surplus: { verify_count: 0.05, transfer_surplus: 0.82, draft_indent: 0.09, escalate_supply_gap: 0.04 },
  draft_indent: { verify_count: 0.06, transfer_surplus: 0.08, draft_indent: 0.64, escalate_supply_gap: 0.22 },
  escalate_supply_gap: { verify_count: 0.04, transfer_surplus: 0.06, draft_indent: 0.24, escalate_supply_gap: 0.66 },
};

export function fallbackDecision(snapshot: Record<string, unknown>, donors: DonorOption[]): { action: DecisionAction; confidence: number; probabilities: Record<DecisionAction, number>; meta: Omit<AiDecisionMeta, "model" | "latencyMs" | "usage" | "engine"> } {
  const parsed = factsView.safeParse(snapshot);
  const f: FactsView = parsed.success ? parsed.data : {};
  const t = f.target ?? {};
  const lead = f.medicine?.leadTimeDays ?? 5;
  const threshold = t.thresholdDays ?? lead + (f.medicine?.safetyBufferDays ?? 3);
  const dos = t.daysOfStock ?? (t.stock !== undefined && t.dailyUse ? t.stock / t.dailyUse : null);
  const gap = t.gapUnits ?? 0;
  const trace: string[] = [];

  const doubtful = t.verified === false || !!t.reportFlag;
  const best = donors[0];
  const totalTransferable = donors.reduce((s, d) => s + d.transferable, 0);
  const transferCovers = !!best && (gap <= 0 || best.transferable >= gap * 0.6 || totalTransferable >= gap);
  const upstreamBad = f.upstream?.status === "delayed" || f.upstream?.status === "unavailable";
  const storeShort = typeof f.districtStore?.daysOfDistrictDemand === "number" && f.districtStore.daysOfDistrictDemand < lead;

  let action: DecisionAction;
  if (doubtful) { action = "verify_count"; trace.push(`count doubtful: ${t.reportFlag ?? "not verified"}`); }
  else if (transferCovers) { action = "transfer_surplus"; trace.push(`${best!.name} can send ${best!.transferable} after reserve (gap ${gap})`); }
  else if (upstreamBad || storeShort) { action = "escalate_supply_gap"; trace.push(upstreamBad ? `upstream ${f.upstream?.status}` : "district store below lead-time demand"); }
  else { action = "draft_indent"; trace.push(best ? `best donor covers only ${best.coversGapPct ?? "?"}% of the gap` : "no donor with safe surplus"); }

  const urgencyLevel: UrgencyLevel = t.risk === "stockout" || t.risk === "critical" || (dos !== null && dos < lead) ? "today" : (dos !== null && dos < threshold) || t.risk === "low" ? "this_week" : "monitor";
  trace.push(`urgency ${urgencyLevel}: ${dos === null ? "no use" : `${Math.round(dos * 10) / 10} days`} vs lead ${lead} + buffer`);
  const urgencyProbabilities: Record<UrgencyLevel, number> = { monitor: urgencyLevel === "monitor" ? 0.8 : 0.1, this_week: urgencyLevel === "this_week" ? 0.8 : 0.1, today: urgencyLevel === "today" ? 0.8 : 0.1 };
  const probabilities = { ...TEMPLATES[action] };
  return {
    action,
    confidence: probabilities[action],
    probabilities,
    meta: {
      questions: [],
      urgencyLevel,
      urgencyScore: URGENCY_LEVELS.indexOf(urgencyLevel),
      urgencyConfidence: 0.8,
      urgencyProbabilities,
      recountProbability: doubtful ? 0.8 : 0.1,
      indentInTime: dos === null ? null : dos >= lead ? 0.75 : 0.2,
      transferBridgesGap: best ? (transferCovers ? 0.8 : 0.2) : null,
      donor: best ? { facilityId: transferCovers ? best.facilityId : null, confidence: 0.8, probabilities: [] } : null,
      refusals: [],
      ruleTrace: trace,
    },
  };
}

// ---------- orchestration ----------

function newId(facilityId: string, medicineId: string) {
  return `dec-${facilityId}-${medicineId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function decideDistrict(req: ValidDistrictRequest, opts: { signal?: AbortSignal } = {}): Promise<AiDecisionRecord> {
  const donors = extractDonors(req.snapshot, req.donorIds);
  const model = MODELS.decisions();
  const base = { id: newId(req.facilityId, req.medicineId), facilityId: req.facilityId, medicineId: req.medicineId, snapshot: req.snapshot, status: "pending" as const, createdAt: new Date().toISOString() };
  const key = apiKey();

  const fallback = (reason: string, latencyMs = 0): AiDecisionRecord => {
    const fb = fallbackDecision(req.snapshot, donors);
    const urgency = fb.meta.urgencyScore / 2;
    return { ...base, action: fb.action, confidence: fb.confidence, probabilities: fb.probabilities, urgency, source: "demo_fallback", fallbackReason: reason, model: "rules", latencyMs, ai: { ...fb.meta, engine: "rules", model: "rules", latencyMs, usage: null } };
  };
  if (!key) return fallback("missing_api_key");

  const questions = buildQuestions(donors);
  const names = questions.map((q) => q.name ?? "");
  const started = performance.now();
  try {
    const { decision, latencyMs } = await callDecisions(key, { model, input: JSON.stringify(req.snapshot), questions }, opts.signal);
    const mapped = mapDecision(decision, donors, names);
    const usage = decision.usage ? { inputTokens: decision.usage.input_tokens ?? 0, outputTokens: decision.usage.output_tokens ?? 0, totalTokens: decision.usage.total_tokens ?? 0, cachedTokens: decision.usage.input_tokens_details?.cached_tokens ?? 0 } : null;
    const usedModel = decision.model || model;
    return {
      ...base,
      action: mapped.action,
      confidence: mapped.confidence,
      probabilities: mapped.probabilities,
      urgency: mapped.meta.urgencyScore / 2,
      source: "live",
      model: usedModel,
      latencyMs,
      ai: { ...mapped.meta, engine: "decisions-api", model: usedModel, latencyMs, usage },
    };
  } catch (error) {
    const reason = error instanceof UpstreamError ? error.reason : "request_failed";
    if (!(error instanceof UpstreamError)) console.warn("District decision failed", error instanceof Error ? error.message : error);
    return fallback(reason, Math.round(performance.now() - started));
  }
}
