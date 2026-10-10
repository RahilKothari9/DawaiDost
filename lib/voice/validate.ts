// Deterministic plausibility checks for spoken counts. Used by the check_count Realtime tool,
// by /api/voice/extract after structured extraction, and by the offline fallback parser.
import type { VoiceReport } from "../district/types";
import type { FacilityRef, MedicineFact } from "./types";

export type CountCheck = {
  medicineId: string;
  count: number;
  plausible: boolean;
  expected: number;
  expectedRange: [number, number];
  lastCount: number;
  dailyUse: number;
  reason?: string;
  guidance: string;
};

export function checkCount(fact: MedicineFact, count: number): CountCheck {
  const base = {
    medicineId: fact.id,
    count,
    expected: fact.expected,
    expectedRange: [fact.expectedMin, fact.expectedMax] as [number, number],
    lastCount: fact.lastCount,
    dailyUse: fact.dailyUse,
  };
  const unit = fact.unit || "units";
  let reason: string | undefined;
  if (!Number.isFinite(count) || count < 0) reason = `Count "${count}" is not a valid shelf quantity.`;
  else if (count > fact.expectedMax) {
    reason = `Reported ${count} ${unit}, but about ${fact.expected} were expected (range ${fact.expectedMin}–${fact.expectedMax}) from the last count of ${fact.lastCount} and ~${fact.dailyUse}/day use. Unexplained increase.`;
  } else if (count < fact.expectedMin) {
    reason = `Reported ${count} ${unit}, but about ${fact.expected} were expected (range ${fact.expectedMin}–${fact.expectedMax}) from the last count of ${fact.lastCount} and ~${fact.dailyUse}/day use. Unexplained drop.`;
  }
  if (reason) {
    return { ...base, plausible: false, reason, guidance: "Politely say the number differs from what records suggest and ask the pharmacist to recount this one medicine now. Do not tell them the expected number." };
  }
  return { ...base, plausible: true, guidance: "Read the number back once in Hindi and ask the pharmacist to confirm it." };
}

export function toVoiceReport(
  facility: FacilityRef,
  fact: MedicineFact,
  input: { count: number; confidence: number; transcript: string; language?: string; pharmacistInsisted?: boolean },
): VoiceReport {
  const check = checkCount(fact, input.count);
  const lowConfidence = input.confidence < 0.5;
  const needsRecount = !check.plausible || lowConfidence;
  return {
    facilityId: facility.id,
    medicineId: fact.id,
    count: Math.round(input.count),
    unit: fact.unit,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    transcript: input.transcript.slice(0, 600),
    language: input.language ?? facility.language ?? "hi",
    needsRecount,
    reason: !check.plausible
      ? `${check.reason}${input.pharmacistInsisted ? " Pharmacist repeated the number." : ""}`
      : lowConfidence ? `Low extraction confidence (${Math.round(input.confidence * 100)}%); please confirm the count.` : undefined,
  };
}
