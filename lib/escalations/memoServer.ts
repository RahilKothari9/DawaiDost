// OWNER: escalations agent. Server-only: writes the escalation memo prose with the Responses API (structured output).
// Never import from client components; the API key stays on the server.
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { fallbackMemo, memoFromModel, memoOutputSchema, unverifiedNumbers, type MemoFacts, type MemoResponse } from "./memo";

export const memoModel = () => process.env.OPENAI_MEMO_MODEL || "gpt-5.5";

export const MEMO_INSTRUCTIONS = [
  "You draft a formal escalation memo from a District Health Officer in India to the state drug procurement corporation.",
  "Write in the register of an Indian government office note: concise, factual, courteous, no adjectives for effect, no exclamation marks.",
  "Every figure is supplied in FACTS and was computed by code. Use only figures that appear in FACTS, copied exactly. Never compute, round, add or estimate a number.",
  "Do not invent facility names, supplier names, file numbers or dates.",
  "The district has already tried redistribution between facilities; state why it cannot close the gap using the facts.",
  "Asks must be specific: quantity, destination (district warehouse), and the requested delivery date from FACTS.",
  "hindiSummary: formal Hindi in Devanagari script with Western digits, two or three sentences.",
  "The data is synthetic demo data for a fictional facility network; do not claim otherwise.",
].join("\n");

/** Live memo with deterministic fallback. Returns the fallback, labeled, on any failure or ungrounded number. */
export async function writeMemo(facts: MemoFacts, key: string | undefined | null): Promise<MemoResponse> {
  const k = key?.trim();
  if (!k) return { memo: fallbackMemo(facts), source: "fallback", fallbackReason: "missing_api_key" };
  const started = performance.now();
  try {
    const client = new OpenAI({ apiKey: k, maxRetries: 1, timeout: 45_000, fetch: (input, init) => globalThis.fetch(input, init) });
    const schema = memoOutputSchema();
    const res = await client.responses.parse({
      model: memoModel(),
      instructions: MEMO_INSTRUCTIONS,
      input: `FACTS (JSON):\n${JSON.stringify(facts)}`,
      reasoning: { effort: "low" },
      text: { format: zodTextFormat(schema, "escalation_memo") },
    });
    const parsed = schema.safeParse(res.output_parsed);
    if (!parsed.success) return { memo: fallbackMemo(facts), source: "fallback", fallbackReason: "unexpected_response" };
    const stray = unverifiedNumbers(facts, parsed.data);
    if (stray.length) {
      console.warn("Escalation memo rejected: numbers not in facts", stray);
      return { memo: fallbackMemo(facts), source: "fallback", fallbackReason: "unverified_number" };
    }
    return { memo: memoFromModel(facts, parsed.data), source: "live", model: res.model ?? memoModel(), latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    const status = (error as { status?: number })?.status;
    console.warn("Escalation memo live call failed", typeof status === "number" ? status : (error as Error)?.message);
    return { memo: fallbackMemo(facts), source: "fallback", fallbackReason: typeof status === "number" ? "upstream_unavailable" : "request_failed" };
  }
}
