// Server-side transcript → VoiceReport[] using the Responses API with structured outputs (zod),
// followed by deterministic validation. Falls back to the labeled regex/number-word parser.
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { VoiceReport } from "../district/types";
import { fallbackExtract, normalizeTranscript } from "./fallbackExtract";
import type { ExtractRequest, ExtractResponse } from "./types";
import { toVoiceReport } from "./validate";

export const EXTRACT_MODEL = "gpt-5.4-mini";

export function extractionSchema(medicineIds: [string, ...string[]]) {
  return z.object({
    reports: z.array(z.object({
      medicine_id: z.enum(medicineIds),
      count: z.number().int().describe("Final shelf count the pharmacist stated, in digits. After a recount, use the recounted number."),
      confidence: z.number().describe("0..1 — how clearly the pharmacist stated and confirmed this number."),
      pharmacist_confirmed: z.boolean().describe("True if the pharmacist confirmed a read-back of this number."),
      evidence: z.string().describe("The pharmacist's exact words that state the count."),
    })),
    english_summary: z.string().describe("One-line English summary of the call."),
  });
}

const INSTRUCTIONS = [
  "You extract medicine shelf counts from a Hindi/English stock-taking phone call transcript between the Dawai Dost agent and a PHC pharmacist.",
  "Return one report per medicine for which the PHARMACIST explicitly stated a shelf count. Hindi number words (e.g. सोलह = 16, बयालीस = 42, डेढ़ सौ = 150) must be converted to digits.",
  "Ignore numbers spoken only by the agent, daily usage, days, strengths (500 mg), and lead times. If the pharmacist recounted, use the final recounted number.",
  "Never infer or invent a count that was not said. Omit medicines without a stated count.",
].join(" ");

function transcriptText(transcript: ExtractRequest["transcript"]): string {
  const lines = normalizeTranscript(transcript);
  return lines
    .filter((l) => l.speaker !== "system")
    .map((l) => `${l.speaker === "pharmacist" ? "Pharmacist" : l.speaker === "tool" ? "Tool" : "Agent"}: ${l.text}`)
    .join("\n");
}

export async function extractReports(req: ExtractRequest, opts: { apiKey?: string; timeoutMs?: number; model?: string } = {}): Promise<ExtractResponse> {
  const { facility, medicines } = req.facts;
  const fallback = (reason: string): ExtractResponse => ({ reports: fallbackExtract(facility, medicines, req.transcript), source: "fallback", fallbackReason: reason });
  if (!opts.apiKey) return fallback("missing_api_key");

  const model = opts.model ?? EXTRACT_MODEL;
  const ids = medicines.map((m) => m.id) as [string, ...string[]];
  const catalog = medicines.map((m) => `- id="${m.id}": ${m.name} ${m.strength} (Hindi: ${m.hindiName ?? m.name}), unit: ${m.unit}`).join("\n");
  const client = new OpenAI({ apiKey: opts.apiKey, maxRetries: 0, timeout: opts.timeoutMs ?? 15_000, fetch: (...args) => globalThis.fetch(...args) });

  try {
    const response = await client.responses.parse({
      model,
      instructions: INSTRUCTIONS,
      input: `Facility: ${facility.name}\nMedicines asked about:\n${catalog}\n\nTranscript:\n${transcriptText(req.transcript)}`,
      reasoning: { effort: "low" },
      text: { format: zodTextFormat(extractionSchema(ids), "voice_stock_reports") },
      store: false,
    });
    const parsed = response.output_parsed;
    if (!parsed) return fallback("unexpected_response");

    const byMed = new Map<string, (typeof parsed.reports)[number]>();
    for (const r of parsed.reports) byMed.set(r.medicine_id, r); // last mention wins (recounts)
    const reports: VoiceReport[] = [];
    for (const [id, r] of byMed) {
      const fact = medicines.find((m) => m.id === id);
      if (!fact || !Number.isFinite(r.count) || r.count < 0) continue;
      const confidence = Math.max(0, Math.min(1, r.confidence)) * (r.pharmacist_confirmed ? 1 : 0.9);
      reports.push(toVoiceReport(facility, fact, { count: r.count, confidence, transcript: r.evidence, language: req.language ?? facility.language }));
    }
    return { reports, source: "live", model, englishSummary: parsed.english_summary };
  } catch (error) {
    console.warn("Voice extraction failed", error instanceof Error ? error.message : "unknown");
    return fallback(error instanceof OpenAI.APIError ? "upstream_unavailable" : "request_failed");
  }
}
