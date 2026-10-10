// OWNER: evals agent. POST /api/evals/run — streams a fresh, small eval run against the live Decisions API as NDJSON.
import { NextResponse } from "next/server";
import { z } from "zod";
import { EVAL_CASES, isAcceptable, LIVE_SUBSET_IDS } from "../../../../lib/evals/cases";
import { EVAL_MODELS, makeConfig, runBaseline, runCase, runPool } from "../../../../lib/evals/run";
import type { LiveEvent } from "../../../../lib/evals/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  model: z.enum(EVAL_MODELS).default("gpt-6-luna"),
  variant: z.enum(["product", "action_only", "minimal"]).default("product"),
  caseIds: z.array(z.string().regex(/^[A-Z]\d{2}$/)).min(1).max(12).optional(),
});

export async function POST(request: Request) {
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Expected { model?, variant?, caseIds? (max 12) }." }, { status: 400 });
  const { model, variant } = parsed.data;
  const ids = parsed.data.caseIds ?? LIVE_SUBSET_IDS;
  const cases = EVAL_CASES.filter((c) => ids.includes(c.id));
  if (!cases.length) return NextResponse.json({ error: "No matching cases." }, { status: 400 });

  const key = process.env.OPENAI_API_KEY?.trim() || null;
  const config = makeConfig(model, variant, cases[0]);
  const encoder = new TextEncoder();
  const started = performance.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: LiveEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      send({ type: "start", total: cases.length, model, variant, live: !!key });
      if (!key) {
        send({ type: "error", message: "OPENAI_API_KEY is not configured on the server, so a live run is not possible." });
        if (!closed) controller.close();
        return;
      }
      let correct = 0, baselineCorrect = 0, failed = 0;
      await runPool(
        cases,
        4,
        (c) => runCase(c, config, { key, maxAttempts: 2, timeoutMs: 30_000, signal: request.signal }),
        (result, index) => {
          const c = cases[index];
          const baseline = runBaseline(c).choice;
          if (!result.ok) failed++;
          else if (isAcceptable(c, result.choice!)) correct++;
          if (isAcceptable(c, baseline)) baselineCorrect++;
          send({ type: "result", index, caseId: c.id, expected: c.expected, acceptable: c.acceptable, baseline, result });
        },
      );
      send({ type: "done", total: cases.length, correct, baselineCorrect, failed, elapsedMs: Math.round(performance.now() - started) });
      if (!closed) controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
