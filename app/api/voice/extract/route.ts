import { NextResponse } from "next/server";
import { extractReports } from "../../../../lib/voice/extract";
import { ExtractRequestSchema } from "../../../../lib/voice/types";

export const runtime = "nodejs";

/**
 * POST { facts: { facility, medicines[] }, transcript: string | {speaker,text}[] }
 *   → { reports: VoiceReport[], source: "live" | "fallback", model?, fallbackReason?, englishSummary? }
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = ExtractRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid extraction request.", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) }, { status: 400 });

  const result = await extractReports(parsed.data, { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_VOICE_EXTRACT_MODEL || undefined });
  return NextResponse.json(result);
}
