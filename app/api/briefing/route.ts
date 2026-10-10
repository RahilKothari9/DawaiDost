// OWNER: ai agent. POST /api/briefing — Responses API writes the officer's morning brief (EN + HI) from a
// compact district summary, via strict structured output. Template brief on any failure.
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiKey, fallbackReasonOf, generateStructured, MODELS } from "../../../lib/ai/openai";
import { briefingSummarySchema, templateBriefing } from "../../../lib/ai/summary";
import type { Briefing } from "../../../lib/ai/types";

export const runtime = "nodejs";

const bi = z.object({ en: z.string(), hi: z.string() });
const outputSchema = z.object({
  headline: bi.describe("One line, under 14 words: the single most important thing today."),
  bullets: z.array(bi.extend({ tone: z.enum(["risk", "progress", "info"]) })).describe("3 to 5 bullets, most urgent first."),
  actions: z.array(bi).describe("1 to 3 concrete actions for the officer this morning."),
});

const INSTRUCTIONS = `You write the 8 a.m. briefing for an Indian District Health Officer about essential-medicine stock at rural health facilities.
Use ONLY facts and numbers present in the summary JSON. Name facilities and medicines exactly. Lead with stockouts and the shortest days of stock, then pending AI decisions, transfers in motion, escalations.
Be terse and operational, like a good chief of staff. No medical advice, no invented numbers. Hindi in simple Devanagari, faithful to the English.
Tone per bullet: "risk" for stock danger, "progress" for transfers, deliveries or good news, "info" otherwise. The data is a synthetic demo district.`;

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = briefingSummarySchema.safeParse((raw as { summary?: unknown } | null)?.summary);
  if (!parsed.success) return NextResponse.json({ error: "A district summary is required." }, { status: 400 });
  const summary = parsed.data;
  const key = apiKey();
  if (!key) return NextResponse.json(templateBriefing(summary, "missing_api_key"));
  try {
    const { data, model, latencyMs } = await generateStructured({ key, model: MODELS.briefing(), instructions: INSTRUCTIONS, input: JSON.stringify(summary), schema: outputSchema, name: "morning_briefing" });
    if (!data.bullets.length || !data.headline.en.trim()) return NextResponse.json(templateBriefing(summary, "unexpected_response"));
    const brief: Briefing = { headline: data.headline, bullets: data.bullets.slice(0, 5), actions: data.actions.slice(0, 3), source: "live", model, latencyMs, generatedAt: new Date().toISOString() };
    return NextResponse.json(brief);
  } catch (error) {
    console.warn("Briefing failed", error instanceof Error ? error.message : error);
    return NextResponse.json(templateBriefing(summary, fallbackReasonOf(error)));
  }
}
