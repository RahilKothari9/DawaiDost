// OWNER: ai agent. Browser-side helpers for the AI routes (fetch + NDJSON streaming).
import type { CompactState } from "./compact";
import type { BriefingSummary } from "./summary";
import type { AiDecisionRecord, AskEvent, BatchEvent, Briefing, DistrictDecisionRequest, ExplainResult, IndentDocument } from "./types";

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Read an NDJSON response body, calling onEvent for each parsed line. */
export async function readNdjson<T>(res: Response, onEvent: (e: T) => void): Promise<void> {
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as T);
        } catch {
          /* ignore malformed line */
        }
      }
    }
    if (done) break;
  }
  if (buf.trim()) {
    try {
      onEvent(JSON.parse(buf) as T);
    } catch {
      /* ignore */
    }
  }
}

export function requestDistrictDecision(req: DistrictDecisionRequest, signal?: AbortSignal) {
  return postJson<AiDecisionRecord>("/api/decisions/district", req, signal);
}

export async function streamBatchDecisions(items: DistrictDecisionRequest[], onEvent: (e: BatchEvent) => void, opts: { concurrency?: number; signal?: AbortSignal } = {}) {
  const res = await fetch("/api/decisions/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items, concurrency: opts.concurrency }), signal: opts.signal });
  await readNdjson<BatchEvent>(res, onEvent);
}

export function requestExplain(body: { decision: { action: string; confidence: number; probabilities: Record<string, number>; source: string; urgencyLevel?: string; donorId?: string | null; donorName?: string | null; recountProbability?: number }; snapshot: unknown }, signal?: AbortSignal) {
  return postJson<ExplainResult>("/api/explain", body, signal);
}

export function requestBriefing(summary: BriefingSummary, signal?: AbortSignal) {
  return postJson<Briefing>("/api/briefing", { summary }, signal);
}

/** Returns an mp3 Blob, or null when the server says to fall back to browser speech. */
export async function requestSpeech(text: string, language: "en" | "hi", signal?: AbortSignal): Promise<Blob | null> {
  const res = await fetch("/api/briefing/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language }), signal });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("audio")) return null;
  return res.blob();
}

export async function streamAsk(messages: { role: "user" | "assistant"; content: string }[], state: CompactState, onEvent: (e: AskEvent) => void, signal?: AbortSignal) {
  const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, state }), signal });
  await readNdjson<AskEvent>(res, onEvent);
}

export function requestIndent(body: { facilityId: string; state: CompactState; reviewPeriodDays?: number; medicineIds?: string[] }, signal?: AbortSignal) {
  return postJson<IndentDocument>("/api/indent", body, signal);
}
