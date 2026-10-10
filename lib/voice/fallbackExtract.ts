// Labeled deterministic fallback for transcript → VoiceReport[] when the Responses API is unavailable.
import type { VoiceReport } from "../district/types";
import { medicineAliases } from "./facts";
import { normalizeHindi, parseNumbers } from "./numbers";
import type { FacilityRef, MedicineFact, Speaker } from "./types";
import { toVoiceReport } from "./validate";

type Line = { speaker: Speaker; text: string };

const NON_COUNT_AFTER = /^\s*(mg|ml|मि\.?ग्रा|मिलीग्राम|दिन|days?|din|रोज|प्रतिदिन|per|प्रति|%|बजे|घंटे|hours?|minutes?|मिनट|तारीख|साल|वर्ष)/i;
const DAILY_CONTEXT = /(रोज|रोज़|प्रतिदिन|daily|per day|हर दिन|एक दिन में|सप्लाई|supply|lead)/i;

export function normalizeTranscript(transcript: string | Line[]): Line[] {
  if (Array.isArray(transcript)) return transcript;
  return transcript.split(/\n+/).map((raw) => {
    const m = raw.match(/^\s*(agent|caller|dawai dost|pharmacist|फार्मासिस्ट|asha|tool|system)\s*[:：-]\s*(.*)$/i);
    if (!m) return { speaker: "pharmacist" as Speaker, text: raw.trim() };
    const tag = m[1].toLowerCase();
    const speaker: Speaker = tag.startsWith("pharm") || tag === "फार्मासिस्ट" ? "pharmacist" : tag === "asha" ? "caller" : tag === "tool" ? "tool" : tag === "system" ? "system" : "agent";
    return { speaker, text: m[2].trim() };
  }).filter((l) => l.text);
}

function findMention(text: string, facts: MedicineFact[]): { id: string; index: number }[] {
  const norm = normalizeHindi(text);
  const found: { id: string; index: number }[] = [];
  for (const f of facts) {
    for (const alias of [...medicineAliases(f.name, f.id), ...(f.hindiName ? [f.hindiName] : [])]) {
      const idx = norm.indexOf(normalizeHindi(alias));
      if (idx >= 0) {
        found.push({ id: f.id, index: idx });
        break;
      }
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Extract counts from pharmacist turns, attributing each number to the medicine most recently named. */
export function fallbackExtract(facility: FacilityRef, facts: MedicineFact[], transcript: string | Line[]): VoiceReport[] {
  const lines = normalizeTranscript(transcript);
  const latest = new Map<string, { count: number; text: string }>();
  let context: string | null = null;

  for (const line of lines) {
    if (line.speaker === "tool" || line.speaker === "system") continue;
    const mentions = findMention(line.text, facts);
    if (line.speaker !== "pharmacist") {
      if (mentions.length) context = mentions[mentions.length - 1].id;
      continue;
    }
    const norm = normalizeHindi(line.text);
    // Split into clauses so "रोज़ 8 जाती हैं" doesn't overwrite a count in the same turn.
    const clauses = norm.split(/[।.!?;,]| और | and /);
    let offset = 0;
    for (const clause of clauses) {
      const start = norm.indexOf(clause, offset);
      offset = start + clause.length;
      if (DAILY_CONTEXT.test(clause)) continue;
      const clauseMentions = findMention(clause, facts);
      for (const num of parseNumbers(clause)) {
        if (NON_COUNT_AFTER.test(clause.slice(num.end))) continue;
        const before = clauseMentions.filter((m) => m.index <= num.index);
        const target = before.length ? before[before.length - 1].id : clauseMentions[0]?.id ?? context;
        if (!target) continue;
        latest.set(target, { count: num.value, text: line.text });
        break;
      }
      if (clauseMentions.length) context = clauseMentions[clauseMentions.length - 1].id;
    }
  }

  return facts.flatMap((f) => {
    const hit = latest.get(f.id);
    if (!hit) return [];
    return [toVoiceReport(facility, f, { count: hit.count, confidence: 0.6, transcript: hit.text, language: "hi" })];
  });
}
