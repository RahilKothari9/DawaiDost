// OWNER: ai agent. Server-only OpenAI plumbing. Never import from client components.
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { DecisionCreateParams, Decision } from "openai/resources/decisions";
import type { z } from "zod";
import type { TokenUsage } from "./types";

export const MODELS = {
  decisions: () => process.env.OPENAI_DECISIONS_MODEL || "gpt-6-luna",
  explain: () => process.env.OPENAI_EXPLAIN_MODEL || "gpt-5.4-mini",
  briefing: () => process.env.OPENAI_BRIEFING_MODEL || "gpt-6-sol",
  ask: () => process.env.OPENAI_ASK_MODEL || "gpt-5.5",
  indent: () => process.env.OPENAI_INDENT_MODEL || "gpt-5.4-mini",
  tts: () => process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
};

export function apiKey(): string | null {
  const k = process.env.OPENAI_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

/** SDK client that resolves `fetch` at call time so tests can stub globalThis.fetch. */
export function openaiClient(key: string): OpenAI {
  return new OpenAI({ apiKey: key, maxRetries: 1, timeout: 30_000, fetch: (input, init) => globalThis.fetch(input, init) });
}

export class UpstreamError extends Error {
  constructor(public reason: "upstream_unavailable" | "unexpected_response" | "request_failed", message: string, public status?: number) {
    super(message);
  }
}

export function mapUsage(u: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | null | undefined): TokenUsage | null {
  if (!u) return null;
  return { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, totalTokens: u.total_tokens ?? 0, cachedTokens: u.input_tokens_details?.cached_tokens ?? 0 };
}

/**
 * POST /v1/decisions. Raw fetch keeps parity with the original /api/decisions route; types come from the SDK.
 * Throws UpstreamError with a fallback reason on any failure.
 */
export async function callDecisions(key: string, body: DecisionCreateParams, signal?: AbortSignal): Promise<{ decision: Decision; latencyMs: number }> {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new UpstreamError("request_failed", error instanceof Error ? error.message : "request failed");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError("unexpected_response", "non-JSON response", response.status);
  }
  if (!response.ok) {
    const msg = (payload as { error?: { message?: string } })?.error?.message ?? `HTTP ${response.status}`;
    console.warn("Decisions API rejected request", response.status, msg);
    throw new UpstreamError("upstream_unavailable", msg, response.status);
  }
  if (!payload || !Array.isArray((payload as Decision).answers)) throw new UpstreamError("unexpected_response", "missing answers");
  return { decision: payload as Decision, latencyMs: Math.round(performance.now() - started) };
}

/** Responses API with a strict JSON schema derived from zod. Returns parsed output or throws. */
export async function generateStructured<S extends z.ZodType>(opts: {
  key: string;
  model: string;
  instructions: string;
  input: string;
  schema: S;
  name: string;
  effort?: "minimal" | "low" | "medium" | "high";
}): Promise<{ data: z.infer<S>; model: string; latencyMs: number; usage: TokenUsage | null }> {
  const started = performance.now();
  const client = openaiClient(opts.key);
  const res = await client.responses.parse({
    model: opts.model,
    instructions: opts.instructions,
    input: opts.input,
    reasoning: { effort: opts.effort ?? "low" },
    text: { format: zodTextFormat(opts.schema, opts.name) },
  });
  if (!res.output_parsed) throw new UpstreamError("unexpected_response", "no parsed output");
  const parsed = opts.schema.safeParse(res.output_parsed);
  if (!parsed.success) throw new UpstreamError("unexpected_response", "schema mismatch");
  return { data: parsed.data, model: res.model ?? opts.model, latencyMs: Math.round(performance.now() - started), usage: mapUsage(res.usage) };
}

export function fallbackReasonOf(error: unknown): string {
  if (error instanceof UpstreamError) return error.reason;
  const status = (error as { status?: number })?.status;
  if (typeof status === "number") return "upstream_unavailable";
  return "request_failed";
}
