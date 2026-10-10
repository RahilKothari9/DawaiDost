import { NextResponse } from "next/server";
import { z } from "zod";
import { FIND_MODELS } from "../../../../lib/find/ask";

export const runtime = "nodejs";

const Body = z.object({ text: z.string().min(1).max(700), lang: z.enum(["hi", "en"]).default("hi") });

const STYLE = {
  hi: "Speak simple, clear Hindi slowly and warmly, like a helpful health worker talking to a village patient. Say numbers clearly.",
  en: "Speak simple, clear Indian English slowly and warmly, like a helpful health worker talking to a patient.",
};

/** POST { text, lang } → audio/mpeg. 503/502 JSON { fallback: "browser_tts" } when speech is unavailable. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Expected { text, lang }." }, { status: 400 });
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "Speech is not configured.", fallback: "browser_tts" }, { status: 503 });
  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: FIND_MODELS.tts(), voice: "marin", input: parsed.data.text, instructions: STYLE[parsed.data.lang], response_format: "mp3" }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok || !response.body) return NextResponse.json({ error: "Could not generate speech.", fallback: "browser_tts" }, { status: 502 });
    return new Response(response.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not generate speech.", fallback: "browser_tts" }, { status: 502 });
  }
}
