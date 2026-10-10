import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Reports whether live OpenAI credentials are configured. Never returns the key itself. */
export function GET() {
  const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
  return NextResponse.json({
    status: "ok",
    openai: {
      configured,
      mode: configured ? "live" : "demo",
      decisionsModel: process.env.OPENAI_DECISIONS_MODEL || "gpt-6-luna",
      realtimeModel: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1",
    },
    checkedAt: new Date().toISOString(),
  });
}
