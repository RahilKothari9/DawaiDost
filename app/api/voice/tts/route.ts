import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const TTS_MODEL = "gpt-4o-mini-tts";

const Body = z.object({
  text: z.string().min(1).max(600),
  voice: z.enum(["marin", "cedar", "alloy", "coral", "sage", "verse"]).optional(),
  style: z.string().max(200).optional(),
});

/**
 * POST { text, voice?, style? } → audio/mpeg (Hindi voice note via gpt-4o-mini-tts).
 * 503/502 JSON on failure — the client then falls back to the browser's speechSynthesis (labeled).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Expected { text } up to 600 characters." }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Speech credentials are not configured.", fallback: "browser_tts" }, { status: 503 });

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: parsed.data.voice ?? "marin",
        input: parsed.data.text,
        instructions: parsed.data.style ?? "Speak in warm, clear, unhurried Hindi, like a respectful district health office colleague leaving a short voice note for a rural pharmacist.",
        response_format: "mp3",
      }),
      cache: "no-store",
    });
    if (!response.ok || !response.body) {
      console.warn("TTS request rejected", response.status);
      return NextResponse.json({ error: "Could not generate the voice note.", fallback: "browser_tts" }, { status: 502 });
    }
    return new Response(response.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Model": TTS_MODEL } });
  } catch {
    return NextResponse.json({ error: "Could not generate the voice note.", fallback: "browser_tts" }, { status: 502 });
  }
}
