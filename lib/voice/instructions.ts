// Role-specific Realtime session configuration, built server-side from facts-only snapshots.
// Rule shared by every mode: the voice model never invents quantities.
import type { MedicineFact, VoiceFacts, VoiceMode } from "./types";

export const REALTIME_MODEL = "gpt-realtime-2.1";
export const TRANSCRIPTION_MODEL = "gpt-transcribe";
export const VOICE = "marin";

export const LEGACY_INSTRUCTIONS =
  "You are role-playing a fictional PHC pharmacist in Sehore district, India, during a stock-taking call. Speak briefly and naturally in Hindi. The caller asks about Metformin 500 mg. Use only these supplied facts: 16 strips are on the shelf, the count has been physically confirmed, the clinic dispenses about 8 strips per day, and district resupply usually takes 5 days. Confirm these figures when asked. Do not invent other counts, make medical recommendations, or decide what the district should do. This is a clearly simulated demo conversation.";

export type RealtimeTool = { type: "function"; name: string; description: string; parameters: Record<string, unknown> };

export const CHECK_COUNT_TOOL: RealtimeTool = {
  type: "function",
  name: "check_count",
  description: "Call this every time the pharmacist states a shelf count for a medicine, BEFORE reading it back. Returns whether the number is plausible versus the facility's history and what to do next.",
  parameters: {
    type: "object",
    properties: {
      medicine_id: { type: "string", description: "Medicine id from the list in your instructions." },
      count: { type: "number", description: "The count exactly as the pharmacist said it, converted to digits." },
    },
    required: ["medicine_id", "count"],
  },
};

export const CONFIRM_COUNT_TOOL: RealtimeTool = {
  type: "function",
  name: "confirm_count",
  description: "Call after the pharmacist confirms your read-back (e.g. 'हाँ', 'सही है'). Records the final count for that medicine.",
  parameters: {
    type: "object",
    properties: {
      medicine_id: { type: "string" },
      count: { type: "number" },
      pharmacist_insisted: { type: "boolean", description: "True if the pharmacist repeated an implausible number after a recount request." },
    },
    required: ["medicine_id", "count"],
  },
};

export const END_CALL_TOOL: RealtimeTool = {
  type: "function",
  name: "end_call",
  description: "Call once after every medicine is confirmed and you have said a short goodbye.",
  parameters: { type: "object", properties: { summary: { type: "string", description: "One short English line, e.g. 'Metformin 14 confirmed; Amlodipine recount requested'." } }, required: [] },
};

export const CHECK_AVAILABILITY_TOOL: RealtimeTool = {
  type: "function",
  name: "check_availability",
  description: "Look up whether a medicine is in stock at a facility, using the district's latest verified shelf reports. Returns the nearest facility with stock when it is not available. Always call this before answering any availability question.",
  parameters: {
    type: "object",
    properties: {
      medicine: { type: "string", description: "Medicine name in English as listed in your instructions, e.g. 'Metformin'." },
      facility: { type: "string", description: "Facility name in English as listed in your instructions, e.g. 'Saraswati PHC'." },
    },
    required: ["medicine", "facility"],
  },
};

const medLabel = (m: MedicineFact) => `${m.name}${m.strength ? ` ${m.strength}` : ""}`;

function pharmacistSimInstructions(facts: VoiceFacts): string {
  const f = facts.facility;
  const meds = facts.medicines ?? [];
  const lines = meds.map((m) => `- ${medLabel(m)} (${m.hindiName ?? m.name}): ${m.shelfCount ?? m.expected} ${m.unit} on the shelf now; about ${m.dailyUse} ${m.unit} dispensed per day.`);
  return [
    `Role-play ${f?.pharmacistName ?? "the pharmacist"}, the fictional pharmacist at ${f?.name ?? "a PHC"}${f?.block ? ` (${f.block} block)` : ""}, ${facts.districtName ?? "Sehore"} district, during the weekly Dawai Dost stock call.`,
    "Answer each question in Hindi, briefly and warmly (one or two short sentences). Say counts as digits-style Hindi numbers.",
    "Facts are fixed. Use only these shelf counts:",
    ...lines,
    "If asked to confirm or recount, repeat the same number. Do not invent other quantities, medicines, expiry dates, or deliveries. Do not give medical advice or decide district actions. This is a simulated demo call with synthetic data.",
  ].join("\n");
}

function callerAgentInstructions(facts: VoiceFacts): string {
  const f = facts.facility;
  const meds = facts.medicines ?? [];
  const list = meds.map((m, i) => `${i + 1}. id="${m.id}" — ${medLabel(m)}, Hindi: ${m.hindiName ?? m.name}, unit: ${m.unit}`);
  return [
    `You are Dawai Dost, the ${facts.districtName ?? "Sehore"} district health office's weekly stock check-in voice agent, calling ${f?.pharmacistName ?? "the pharmacist"} at ${f?.name ?? "the PHC"}.`,
    "Speak natural, polite Hindi (simple words; English medicine names are fine). Keep every turn under two short sentences.",
    "Flow:",
    "1. Greet the pharmacist by name, say this is the weekly Dawai Dost stock call, and ask for the first medicine's shelf count.",
    "2. Ask for the medicines below one at a time, in order:",
    ...list,
    "3. When the pharmacist states a number, call check_count with the medicine id and the number. Never skip this.",
    "   - If plausible: read the number back in Hindi (e.g. 'मेटफॉर्मिन — सोलह स्ट्रिप, सही?') and wait. When they confirm, call confirm_count, then move to the next medicine.",
    "   - If not plausible: politely ask them to recount that shelf now. Never reveal or suggest the expected number. When they give a new number, call check_count again. If they repeat the same number, accept it, call confirm_count with pharmacist_insisted=true.",
    "   - If they say a number is unclear or they don't know, ask once more, then move on.",
    "4. After the last medicine, thank them briefly, say the district office has recorded the report, then call end_call.",
    "Rules: Never invent, guess, or round quantities — only use numbers the pharmacist says. Do not give medical advice or promise deliveries. If the pharmacist asks about resupply, say the district officer will review the report today. This is a demo with synthetic data.",
  ].join("\n");
}

function availabilityInstructions(facts: VoiceFacts): string {
  const dir = facts.directory;
  const facilities = dir?.facilities.map((f) => `${f.name}${f.block ? ` (${f.block})` : ""}`).join("; ") ?? "";
  const medicines = dir?.medicines.map((m) => `${m.name} ${m.strength}${m.hindiName && m.hindiName !== m.name ? ` / ${m.hindiName}` : ""}`).join("; ") ?? "";
  return [
    `You are the Dawai Dost medicine availability line for ${facts.districtName ?? "Sehore"} district. Callers are ASHA workers or patients asking whether a medicine is available at a health centre before they travel.`,
    "Speak short, warm, simple Hindi. Greet only once at the start: 'नमस्ते, दवाई दोस्त में आपका स्वागत है। किस दवा और किस स्वास्थ्य केंद्र के बारे में पूछना है?'",
    "For every question, call check_availability first with the English medicine and facility names from these lists, then answer in one or two sentences.",
    `Facilities: ${facilities}`,
    `Medicines: ${medicines}`,
    "Answering rules: say available / running low / not available. If not available or low, name the nearest alternative facility and its approximate distance in kilometres from the tool result. Do not say exact unit counts to patients. Never guess availability without the tool. If the medicine or facility is unclear, ask once. Do not give medical or dosage advice; for symptoms, suggest visiting the health centre or calling 108 in an emergency. Synthetic demo data.",
  ].join("\n");
}

export type SessionConfig = {
  instructions: string;
  tools: RealtimeTool[];
  micInput: boolean;
  session: Record<string, unknown>;
};

export function buildSessionConfig(mode: VoiceMode | "legacy", facts: VoiceFacts = {}): SessionConfig {
  const instructions =
    mode === "legacy" ? LEGACY_INSTRUCTIONS
      : mode === "pharmacist_sim" ? pharmacistSimInstructions(facts)
        : mode === "caller_agent" ? callerAgentInstructions(facts)
          : availabilityInstructions(facts);
  const tools = mode === "caller_agent" ? [CHECK_COUNT_TOOL, CONFIRM_COUNT_TOOL, END_CALL_TOOL] : mode === "availability" ? [CHECK_AVAILABILITY_TOOL] : [];
  const micInput = mode === "caller_agent" || mode === "availability";
  const keywords = [
    ...(facts.medicines ?? []).flatMap((m) => [m.name, m.hindiName ?? ""]),
    ...(facts.directory?.medicines ?? []).flatMap((m) => [m.name, m.hindiName ?? ""]),
    ...(facts.directory?.facilities ?? []).map((f) => f.name),
    facts.facility?.name ?? "",
    "Dawai Dost", "स्ट्रिप", "PHC",
  ].filter(Boolean).slice(0, 40);

  const audio: Record<string, unknown> = { output: { voice: VOICE } };
  if (micInput) {
    audio.input = {
      noise_reduction: { type: "near_field" },
      transcription: { model: TRANSCRIPTION_MODEL, languages: ["hi", "en"], keywords: [...new Set(keywords)] },
      turn_detection: { type: "semantic_vad", eagerness: mode === "caller_agent" ? "low" : "auto", create_response: true, interrupt_response: true },
    };
  }
  const session: Record<string, unknown> = {
    type: "realtime",
    model: REALTIME_MODEL,
    output_modalities: ["audio"],
    audio,
    instructions,
  };
  if (tools.length) {
    session.tools = tools;
    session.tool_choice = "auto";
  }
  return { instructions, tools, micInput, session };
}
