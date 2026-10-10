import { NextResponse } from "next/server";
import { z } from "zod";
import { glossLines } from "../../../../lib/voice/gloss";

export const runtime = "nodejs";

const Body = z.object({ lines: z.array(z.string().max(1000)).min(1).max(12) });

/** POST { lines: string[] } → { glosses: string[], source: "live" | "fallback" } (English gloss of Hindi lines). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Expected { lines: string[] } (1–12 lines)." }, { status: 400 });
  return NextResponse.json(await glossLines(parsed.data.lines, process.env.OPENAI_API_KEY));
}
