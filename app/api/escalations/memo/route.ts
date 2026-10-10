import { NextResponse } from "next/server";
import { MemoFactsSchema } from "../../../../lib/escalations/memo";
import { writeMemo } from "../../../../lib/escalations/memoServer";

export const runtime = "nodejs";

/**
 * POST { facts: MemoFacts } -> MemoResponse { memo, source: "live" | "fallback", fallbackReason?, model?, latencyMs? }.
 * Facts are computed by lib/escalations (code); the model writes prose only, and its numbers are checked against facts.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = MemoFactsSchema.safeParse((body as { facts?: unknown } | null)?.facts);
  if (!parsed.success) return NextResponse.json({ error: "Expected { facts: MemoFacts } built by lib/escalations/memo.buildMemoFacts." }, { status: 400 });
  return NextResponse.json(await writeMemo(parsed.data, process.env.OPENAI_API_KEY));
}
