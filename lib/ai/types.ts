// OWNER: ai agent. Types for the district AI decision layer (Decisions API + Responses API features).
import type { DecisionAction, DecisionRecord } from "../district/types";

export type AiSource = "live" | "demo_fallback";

export const URGENCY_LEVELS = ["monitor", "this_week", "today"] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens: number };

/** A donor option as offered to (and judged by) the Decisions API. `false` = "no suitable donor". */
export type DonorVerdict = {
  facilityId: string | null;
  confidence: number;
  probabilities: { value: string | false; probability: number }[];
};

/** Everything the multi-question Decisions API call returned beyond the 4-way action. */
export type AiDecisionMeta = {
  engine: "decisions-api" | "rules";
  model: string;
  latencyMs: number;
  usage: TokenUsage | null;
  questions: string[]; // names of the questions asked in the single call
  urgencyLevel: UrgencyLevel;
  urgencyScore: number; // 0..2 expected value over the score levels
  urgencyConfidence: number;
  urgencyProbabilities: Record<UrgencyLevel, number>;
  recountProbability: number; // predicate: recount_needed
  transferBridgesGap: number | null; // predicate: transfer_bridges_gap (null when no donor offered)
  indentInTime: number | null; // predicate: indent_arrives_in_time
  donor: DonorVerdict | null;
  refusals: string[]; // question names the host declined
  ruleTrace?: string[]; // deterministic fallback: which rules fired
};

export type AiDecisionRecord = DecisionRecord & { ai: AiDecisionMeta; model: string; latencyMs: number };

export function isAiDecision(d: DecisionRecord | undefined | null): d is AiDecisionRecord {
  return !!d && typeof (d as Partial<AiDecisionRecord>).ai === "object" && (d as Partial<AiDecisionRecord>).ai !== null;
}

export type DistrictDecisionRequest = {
  facilityId: string;
  medicineId: string;
  snapshot: Record<string, unknown>;
  donorIds?: string[];
};

export type BatchEvent =
  | { type: "start"; total: number; concurrency: number; model: string; live: boolean }
  | { type: "progress"; index: number; facilityId: string; medicineId: string; state: "running" }
  | { type: "decision"; index: number; decision: AiDecisionRecord }
  | { type: "error"; index: number; facilityId: string; medicineId: string; message: string }
  | { type: "done"; total: number; live: number; fallback: number; failed: number; totalTokens: number; elapsedMs: number };

export type Bilingual = { en: string; hi: string };

export type ExplainResult = Bilingual & {
  keyFacts: string[];
  source: AiSource;
  model: string | null;
  fallbackReason?: string;
  latencyMs: number;
  generatedAt: string;
};

export type BriefingTone = "risk" | "progress" | "info";

export type Briefing = {
  headline: Bilingual;
  bullets: (Bilingual & { tone: BriefingTone })[];
  actions: Bilingual[];
  source: AiSource;
  model: string | null;
  fallbackReason?: string;
  latencyMs: number;
  generatedAt: string;
};

export type AskEvent =
  | { type: "meta"; source: AiSource; model: string | null; fallbackReason?: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; summary: string }
  | { type: "delta"; text: string }
  | { type: "done"; source: AiSource; latencyMs: number; fallbackReason?: string }
  | { type: "error"; message: string };

export type IndentLine = {
  medicineId: string;
  name: string;
  strength: string;
  unit: string;
  avgDailyUse: number;
  basis: "ledger" | "reported";
  leadTimeDays: number;
  bufferDays: number;
  reviewDays: number;
  coverDays: number;
  stock: number;
  inbound: number;
  required: number;
  daysOfStock: number | null;
  justification: string;
};

export type IndentDocument = {
  id: string;
  facilityId: string;
  facilityName: string;
  block: string;
  district: string;
  officer: string;
  createdAt: string;
  reviewPeriodDays: number;
  lines: IndentLine[];
  coveringNote: string;
  source: AiSource;
  model: string | null;
  fallbackReason?: string;
  latencyMs: number;
};

export type { DecisionAction };
