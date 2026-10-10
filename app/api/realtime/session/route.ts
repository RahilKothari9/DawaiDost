import { NextResponse } from "next/server";
import { buildSessionConfig, TRANSCRIPTION_MODEL } from "../../../../lib/voice/instructions";
import { SessionRequestSchema, type SessionResponse, type VoiceMode } from "../../../../lib/voice/types";

export const runtime = "nodejs";

/**
 * Mints a short-lived Realtime client secret. Body is optional:
 *   {}                                 → legacy Saraswati pharmacist role-play (original demo)
 *   { mode, facilityId?, facts? }      → role-specific instructions + tools, built here from facts only
 */
export async function POST(request: Request) {
  let mode: VoiceMode | "legacy" = "legacy";
  let facts = {};
  try {
    const raw = await request.text();
    if (raw.trim()) {
      const parsed = SessionRequestSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return NextResponse.json({ error: "Invalid session request.", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) }, { status: 400 });
      mode = parsed.data.mode ?? (parsed.data.facts ? "pharmacist_sim" : "legacy");
      facts = parsed.data.facts ?? {};
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Realtime credentials are not configured." }, { status: 503 });

  const config = buildSessionConfig(mode, facts);
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 600 }, session: config.session }),
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      console.warn("Realtime client secret rejected", response.status, payload.error?.message ?? "Unknown API error");
      return NextResponse.json({ error: "Could not start the Realtime session." }, { status: 502 });
    }
    const clientSecret = payload.value ?? payload.client_secret?.value;
    if (!clientSecret) return NextResponse.json({ error: "Realtime did not return a client secret." }, { status: 502 });
    const body: SessionResponse = {
      clientSecret,
      mode,
      model: String(config.session.model),
      transcriptionModel: config.micInput ? TRANSCRIPTION_MODEL : null,
      instructions: config.instructions,
      tools: config.tools.map((t) => t.name),
    };
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "Could not start the Realtime session." }, { status: 502 });
  }
}
