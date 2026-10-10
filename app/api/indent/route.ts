// OWNER: ai agent. POST /api/indent — code computes consumption-based quantities; the Responses API only
// writes per-line justification and a covering note (structured output). Template text on any failure.
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseCompactState } from "../../../lib/ai/compact";
import { computeIndentLines, DEFAULT_REVIEW_DAYS } from "../../../lib/ai/indent";
import { apiKey, fallbackReasonOf, generateStructured, MODELS } from "../../../lib/ai/openai";
import type { IndentDocument } from "../../../lib/ai/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  facilityId: z.string().min(1).max(80),
  state: z.unknown(),
  reviewPeriodDays: z.number().int().min(7).max(90).optional(),
  medicineIds: z.array(z.string().max(80)).max(60).optional(),
});

const outputSchema = z.object({
  coveringNote: z.string().describe("2-3 sentence covering note to the District Drug Store."),
  lines: z.array(z.object({ medicineId: z.string(), justification: z.string().describe("One sentence, citing the given numbers only.") })),
});

const INSTRUCTIONS = `You draft the justification text for a medicine indent (resupply requisition) from a rural Indian health facility to the District Drug Store.
Quantities are already computed by code: required = average daily use x (lead time + safety buffer + review period) - stock on hand - inbound.
For each line write ONE crisp sentence that justifies the quantity using only the given numbers (daily use, days of stock, cover days, inbound). Do not change any quantity and do not invent numbers.
Return exactly one entry per medicineId provided. Also write a short, formal covering note. Plain English. The data is a synthetic demo.`;

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "facilityId and state are required." }, { status: 400 });
  const state = parseCompactState(parsed.data.state);
  if (!state) return NextResponse.json({ error: "state is not a valid district snapshot." }, { status: 400 });
  const facility = state.facilities.find((f) => f.id === parsed.data.facilityId);
  if (!facility) return NextResponse.json({ error: "Unknown facility." }, { status: 404 });

  const review = parsed.data.reviewPeriodDays ?? DEFAULT_REVIEW_DAYS;
  const lines = computeIndentLines(state, facility.id, { reviewPeriodDays: review, medicineIds: parsed.data.medicineIds });
  const doc: IndentDocument = {
    id: `IND-${facility.id.toUpperCase().slice(0, 6)}-${state.now.slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    facilityId: facility.id,
    facilityName: facility.name,
    block: facility.block,
    district: `${state.district.name}, ${state.district.state}`,
    officer: `${state.district.officer.name}, ${state.district.officer.title}`,
    createdAt: state.now,
    reviewPeriodDays: review,
    lines,
    coveringNote: lines.length
      ? `${facility.name} requests ${lines.length} item${lines.length === 1 ? "" : "s"} computed from consumption over a ${review}-day review period plus lead time and safety buffer. Quantities already net off stock on hand and inbound transfers.`
      : `${facility.name} has enough stock for the lead time, buffer and a ${review}-day review period. No indent is needed.`,
    source: "demo_fallback",
    model: null,
    latencyMs: 0,
  };
  if (!lines.length) return NextResponse.json({ ...doc, fallbackReason: "nothing_to_indent" });

  const key = apiKey();
  if (!key) return NextResponse.json({ ...doc, fallbackReason: "missing_api_key" });
  try {
    const input = { facility: facility.name, block: facility.block, district: doc.district, reviewPeriodDays: review, lines: lines.map((l) => ({ medicineId: l.medicineId, name: `${l.name} ${l.strength}`, unit: l.unit, avgDailyUse: l.avgDailyUse, basis: l.basis, coverDays: l.coverDays, stock: l.stock, inbound: l.inbound, required: l.required, daysOfStock: l.daysOfStock })) };
    const { data, model, latencyMs } = await generateStructured({ key, model: MODELS.indent(), instructions: INSTRUCTIONS, input: JSON.stringify(input), schema: outputSchema, name: "indent_justification" });
    const byId = new Map(data.lines.filter((l) => l.justification.trim()).map((l) => [l.medicineId, l.justification.trim()]));
    const live: IndentDocument = {
      ...doc,
      lines: lines.map((l) => ({ ...l, justification: byId.get(l.medicineId) ?? l.justification })),
      coveringNote: data.coveringNote.trim() || doc.coveringNote,
      source: "live",
      model,
      latencyMs,
    };
    return NextResponse.json(live);
  } catch (error) {
    console.warn("Indent drafting failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ ...doc, fallbackReason: fallbackReasonOf(error) });
  }
}
