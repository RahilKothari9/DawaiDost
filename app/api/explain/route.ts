// OWNER: ai agent. POST /api/explain — after a decision is made, the Responses API turns the snapshot +
// Decisions API output into a short officer-facing rationale (English + Hindi). It never changes the decision.
import { NextResponse } from "next/server";
import { z } from "zod";
import { actionLabels } from "../../../lib/scenario";
import { apiKey, fallbackReasonOf, generateStructured, MODELS } from "../../../lib/ai/openai";
import { templateExplain } from "../../../lib/ai/templates";

export const runtime = "nodejs";

const actions = ["verify_count", "transfer_surplus", "draft_indent", "escalate_supply_gap"] as const;
const requestSchema = z.object({
  decision: z.object({
    action: z.enum(actions),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number()),
    source: z.enum(["live", "demo_fallback"]),
    urgencyLevel: z.string().max(20).optional(),
    donorId: z.string().max(80).nullable().optional(),
    donorName: z.string().max(120).nullable().optional(),
    recountProbability: z.number().min(0).max(1).optional(),
  }),
  snapshot: z.record(z.string(), z.unknown()).refine((s) => JSON.stringify(s).length <= 40_000, "snapshot too large"),
});

const outputSchema = z.object({
  en: z.string().describe("2-3 plain English sentences for the district officer."),
  hi: z.string().describe("The same rationale in natural Hindi (Devanagari)."),
  keyFacts: z.array(z.string()).describe("2-4 short facts with numbers copied from the snapshot."),
});

const INSTRUCTIONS = `You explain a medicine-supply recommendation to an Indian District Health Officer.
A separate model (the OpenAI Decisions API) has ALREADY chosen the action; you are writing after the fact and must not change, second-guess, or re-rank it.
If decision.donorName is set, that is the donor the Decisions API chose: refer to it and no other donor.
Write 2-3 short sentences (English under 60 words): what is happening at the facility, why this action fits, and what the officer should check. If the top two probabilities are within 0.15, say the case is borderline.
Use only numbers that appear in the snapshot or decision. Never invent quantities, dates, or names. No medical advice. Hindi must be natural, simple, in Devanagari, keeping facility and medicine names as-is.`;

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "decision and snapshot are required." }, { status: 400 });
  const body = parsed.data;
  const key = apiKey();
  if (!key) return NextResponse.json(templateExplain(body, "missing_api_key"));
  try {
    const { data, model, latencyMs } = await generateStructured({
      key,
      model: MODELS.explain(),
      instructions: INSTRUCTIONS,
      input: JSON.stringify({ decision: { ...body.decision, actionLabel: actionLabels[body.decision.action] }, snapshot: body.snapshot }),
      schema: outputSchema,
      name: "decision_rationale",
    });
    if (!data.en.trim() || !data.hi.trim()) return NextResponse.json(templateExplain(body, "unexpected_response"));
    return NextResponse.json({ en: data.en.trim(), hi: data.hi.trim(), keyFacts: data.keyFacts.slice(0, 4), source: "live", model, latencyMs, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.warn("Explain failed", error instanceof Error ? error.message : error);
    return NextResponse.json(templateExplain(body, fallbackReasonOf(error)));
  }
}
