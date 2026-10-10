// OWNER: ai agent. POST /api/decisions/batch — runs many district decisions with bounded concurrency and
// streams NDJSON BatchEvents so the Decision Queue fills in live.
import { NextResponse } from "next/server";
import { z } from "zod";
import { decideDistrict, districtRequestSchema } from "../../../../lib/ai/decide";
import { apiKey, MODELS } from "../../../../lib/ai/openai";
import type { BatchEvent } from "../../../../lib/ai/types";

export const runtime = "nodejs";

const batchSchema = z.object({
  items: z.array(districtRequestSchema).min(1).max(80),
  concurrency: z.number().int().min(1).max(8).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "items[] of {facilityId, medicineId, snapshot} is required (max 80).", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const { items } = parsed.data;
  const concurrency = Math.min(parsed.data.concurrency ?? 4, items.length);
  const encoder = new TextEncoder();
  const started = performance.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: BatchEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      send({ type: "start", total: items.length, concurrency, model: MODELS.decisions(), live: !!apiKey() });
      let next = 0, live = 0, fallback = 0, failed = 0, totalTokens = 0;
      const worker = async () => {
        while (next < items.length && !request.signal.aborted) {
          const index = next++;
          const item = items[index];
          send({ type: "progress", index, facilityId: item.facilityId, medicineId: item.medicineId, state: "running" });
          try {
            const decision = await decideDistrict(item, { signal: request.signal });
            if (decision.source === "live") live++;
            else fallback++;
            totalTokens += decision.ai.usage?.totalTokens ?? 0;
            send({ type: "decision", index, decision });
          } catch (error) {
            failed++;
            send({ type: "error", index, facilityId: item.facilityId, medicineId: item.medicineId, message: error instanceof Error ? error.message : "failed" });
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
      send({ type: "done", total: items.length, live, fallback, failed, totalTokens, elapsedMs: Math.round(performance.now() - started) });
      if (!closed) controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
