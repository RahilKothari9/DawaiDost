// OWNER: ai agent. POST /api/briefing/speech — streams gpt-4o-mini-tts audio (mp3) for the briefing.
// On failure returns 503 JSON {fallback: "browser_speech"} so the client can use the browser voice, labeled.
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiKey, MODELS, openaiClient } from "../../../../lib/ai/openai";

export const runtime = "nodejs";

const schema = z.object({ text: z.string().trim().min(1).max(3000), language: z.enum(["en", "hi"]).default("en") });

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "text (max 3000 chars) is required." }, { status: 400 });
  const key = apiKey();
  if (!key) return NextResponse.json({ fallback: "browser_speech", fallbackReason: "missing_api_key" }, { status: 503 });
  try {
    const audio = await openaiClient(key).audio.speech.create({
      model: MODELS.tts(),
      voice: "marin",
      input: parsed.data.text,
      response_format: "mp3",
      instructions: parsed.data.language === "hi"
        ? "Speak in clear, warm Hindi at a measured pace, like a calm public-health briefing."
        : "Speak in clear Indian English at a measured pace, like a calm public-health briefing for a district officer.",
    });
    if (!audio.ok || !audio.body) throw new Error(`TTS HTTP ${audio.status}`);
    return new Response(audio.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Model": MODELS.tts() } });
  } catch (error) {
    console.warn("TTS failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ fallback: "browser_speech", fallbackReason: "upstream_unavailable" }, { status: 503 });
  }
}
