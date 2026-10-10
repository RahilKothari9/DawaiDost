// English gloss for Hindi transcript lines: live via the Responses API, with a labeled keyword fallback.
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { fallbackGloss } from "./gloss-fallback";

export { fallbackGloss };

export const GLOSS_MODEL = "gpt-5.4-mini";

export async function glossLines(lines: string[], apiKey?: string): Promise<{ glosses: string[]; source: "live" | "fallback" }> {
  const fallback = () => ({ glosses: lines.map(fallbackGloss), source: "fallback" as const });
  if (!apiKey || !lines.length) return fallback();
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 8_000, fetch: (...args) => globalThis.fetch(...args) });
  try {
    const res = await client.responses.parse({
      model: GLOSS_MODEL,
      instructions: "Translate each Hindi (or Hinglish) line from a medicine stock phone call into short, plain English. Keep numbers as digits and medicine names in English. Return exactly one translation per input line, same order.",
      input: JSON.stringify(lines),
      reasoning: { effort: "low" },
      text: { format: zodTextFormat(z.object({ glosses: z.array(z.string()) }), "glosses") },
      store: false,
    });
    const g = res.output_parsed?.glosses;
    if (!g || g.length !== lines.length) return fallback();
    return { glosses: g, source: "live" };
  } catch {
    return fallback();
  }
}
