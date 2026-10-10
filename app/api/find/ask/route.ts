import { NextResponse } from "next/server";
import { answerQuestion, transcribe } from "../../../../lib/find/ask";
import { AskFieldsSchema } from "../../../../lib/find/schema";
import { fallbackReasonOf } from "../../../../lib/ai/openai";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/**
 * POST /api/find/ask
 *   multipart/form-data: audio? (webm/ogg/mp4/wav, <= 4 MB), text?, lang ("hi" | "en"), snapshot (JSON FindSnapshot), origin? (JSON Origin)
 *   application/json:    { text, lang, snapshot, origin? }
 * → AskResponse { transcript, medicineIds, conditionId, place, answerText, needs, source, fallbackReason? }
 * Without credentials, typed text is still answered with the deterministic parser; audio returns 503 { fallback: "text" }.
 */
export async function POST(request: Request) {
  let raw: Record<string, unknown>;
  let audio: File | null = null;
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("audio");
      if (file instanceof File && file.size > 0) audio = file;
      const json = (k: string) => {
        const v = form.get(k);
        return typeof v === "string" && v ? JSON.parse(v) : undefined;
      };
      raw = { text: form.get("text") ?? undefined, lang: form.get("lang") ?? undefined, snapshot: json("snapshot"), origin: json("origin") };
    } else {
      raw = await request.json();
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = AskFieldsSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid find request.", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) }, { status: 400 });
  if (audio && audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "Recording is too long." }, { status: 413 });

  const key = process.env.OPENAI_API_KEY?.trim() || null;
  let transcript = parsed.data.text?.trim() ?? "";
  let transcribed = false;
  if (!transcript && audio) {
    if (!key) return NextResponse.json({ error: "Voice is not configured.", fallback: "text", fallbackReason: "missing_api_key" }, { status: 503 });
    try {
      transcript = await transcribe(key, audio, parsed.data.snapshot, parsed.data.lang);
      transcribed = true;
    } catch (error) {
      return NextResponse.json({ error: "Could not understand the recording.", fallback: "text", fallbackReason: fallbackReasonOf(error) }, { status: 502 });
    }
  }
  if (!transcript) return NextResponse.json({ error: "Nothing to answer.", fallback: "text" }, { status: 422 });

  return NextResponse.json(await answerQuestion(parsed.data, transcript, key, transcribed));
}
