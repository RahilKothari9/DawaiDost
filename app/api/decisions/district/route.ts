// OWNER: ai agent. POST /api/decisions/district — one facility × medicine, one multi-question Decisions API call.
import { NextResponse } from "next/server";
import { decideDistrict, districtRequestSchema } from "../../../../lib/ai/decide";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = districtRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "facilityId, medicineId and an object snapshot are required.", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const decision = await decideDistrict(parsed.data, { signal: request.signal });
  return NextResponse.json(decision, { headers: { "Cache-Control": "no-store" } });
}
