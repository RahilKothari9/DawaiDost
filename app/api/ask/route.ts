// OWNER: ai agent. POST /api/ask — "Ask the district". Responses API with function tools executed server-side
// over a client-sent compact state; streams NDJSON AskEvents (meta, tool_call, tool_result, delta, done).
// Deterministic fallback: keyword planner runs the same tools and composes a templated answer.
import { NextResponse } from "next/server";
import { z } from "zod";
import type { ResponseInput, ResponseStreamEvent } from "openai/resources/responses/responses";
import { parseCompactState } from "../../../lib/ai/compact";
import { apiKey, fallbackReasonOf, MODELS, openaiClient } from "../../../lib/ai/openai";
import { composeFallbackAnswer, planFallback, runTool, summarizeToolResult, toolDefinitions } from "../../../lib/ai/tools";
import type { AskEvent } from "../../../lib/ai/types";
import type { DistrictState } from "../../../lib/district/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) })).min(1).max(16),
  state: z.unknown(),
});

const MAX_ROUNDS = 5;

function instructions(state: DistrictState) {
  return `You are the district medicine-supply assistant for ${state.district.officer.name} (${state.district.officer.title}), ${state.district.name} district, ${state.district.state}. Clock: ${state.now}.
Answer questions about essential-medicine stock at health facilities by calling the tools. Every number, date, or facility in your answer MUST come from a tool result in this conversation; if the tools don't return it, say you don't have it.
Be brief: 1-4 short sentences or a compact bullet list. Name facilities and medicines exactly as the tools do. If asked in Hindi, answer in Hindi.
You can draft a transfer proposal but cannot execute anything: the officer approves actions in the Decision Queue. No clinical advice. Data is a synthetic demo district.`;
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success || parsed.data.messages[parsed.data.messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "messages (ending with a user turn) and state are required." }, { status: 400 });
  }
  const state = parseCompactState(parsed.data.state);
  if (!state) return NextResponse.json({ error: "state is not a valid district snapshot." }, { status: 400 });
  const messages = parsed.data.messages;
  const question = messages[messages.length - 1].content;
  const key = apiKey();
  const encoder = new TextEncoder();
  const started = performance.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: AskEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      const runFallback = (reason: string) => {
        send({ type: "meta", source: "demo_fallback", model: null, fallbackReason: reason });
        const plan = planFallback(state, question);
        const parts: string[] = [];
        plan.calls.forEach((c, i) => {
          const id = `fb_${i}`;
          send({ type: "tool_call", id, name: c.name, args: c.args });
          const result = runTool(state, c.name, c.args);
          send({ type: "tool_result", id, name: c.name, summary: summarizeToolResult(c.name, result) });
          parts.push(composeFallbackAnswer(c.name, result));
        });
        send({ type: "delta", text: parts.join("\n\n") });
        send({ type: "done", source: "demo_fallback", latencyMs: Math.round(performance.now() - started), fallbackReason: reason });
        finish();
      };

      if (!key) return runFallback("missing_api_key");

      const client = openaiClient(key);
      const model = MODELS.ask();
      let emittedText = false;
      let metaSent = false;
      try {
        let previousId: string | undefined;
        let input: ResponseInput = messages.map((m) => ({ role: m.role, content: m.content }));
        for (let round = 0; round < MAX_ROUNDS; round++) {
          const events = await client.responses.create({
            model,
            instructions: instructions(state),
            input,
            tools: toolDefinitions,
            previous_response_id: previousId,
            reasoning: { effort: "low" },
            stream: true,
          }, { signal: request.signal });
          if (!metaSent) {
            send({ type: "meta", source: "live", model });
            metaSent = true;
          }
          const calls: { call_id: string; name: string; arguments: string }[] = [];
          let responseId: string | undefined;
          for await (const ev of events as AsyncIterable<ResponseStreamEvent>) {
            if (ev.type === "response.output_text.delta") {
              emittedText = true;
              send({ type: "delta", text: ev.delta });
            } else if (ev.type === "response.output_item.done" && ev.item.type === "function_call") {
              calls.push({ call_id: ev.item.call_id, name: ev.item.name, arguments: ev.item.arguments });
            } else if (ev.type === "response.completed") {
              responseId = ev.response.id;
            } else if (ev.type === "response.failed" || ev.type === "error") {
              throw new Error("response stream failed");
            }
          }
          if (!calls.length) break;
          previousId = responseId;
          input = calls.map((c) => {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(c.arguments || "{}");
            } catch {
              args = {};
            }
            send({ type: "tool_call", id: c.call_id, name: c.name, args });
            const result = runTool(state, c.name, args);
            send({ type: "tool_result", id: c.call_id, name: c.name, summary: summarizeToolResult(c.name, result) });
            return { type: "function_call_output" as const, call_id: c.call_id, output: JSON.stringify(result) };
          });
          if (round === MAX_ROUNDS - 1) send({ type: "delta", text: "\n(Stopped after several tool calls; please narrow the question.)" });
        }
        send({ type: "done", source: "live", latencyMs: Math.round(performance.now() - started) });
        finish();
      } catch (error) {
        console.warn("Ask failed", error instanceof Error ? error.message : error);
        if (!emittedText) return runFallback(fallbackReasonOf(error));
        send({ type: "error", message: "The live answer was interrupted." });
        send({ type: "done", source: "live", latencyMs: Math.round(performance.now() - started), fallbackReason: "interrupted" });
        finish();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
