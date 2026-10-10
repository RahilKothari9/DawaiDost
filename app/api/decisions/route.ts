import { NextResponse } from "next/server";
import { actionChoices, getFallbackDecision, buildDecisionSnapshot, type Clinic, type DecisionAction } from "../../../lib/scenario";

export const runtime = "nodejs";

type DecisionApiAnswer = {
  choice?: DecisionAction;
  confidence?: number;
  probabilities?: { value: DecisionAction; probability: number }[];
};

export async function POST(request: Request) {
  let clinics: Clinic[];
  try {
    const body = await request.json();
    clinics = Array.isArray(body.clinics) ? body.clinics : [];
    if (!clinics.length) return NextResponse.json({ error: "Clinic inventory is required." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const fallback = getFallbackDecision(clinics);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ ...fallback, fallbackReason: "missing_api_key" });

  try {
    const response = await fetch("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_DECISIONS_MODEL || "gpt-6-luna",
        input: JSON.stringify(buildDecisionSnapshot(clinics)),
        questions: [{
          type: "choice",
          name: "next_action",
          instructions: "Choose the single safest next operational step for the target PHC. Consider report verification, days of stock, the resupply lead time plus safety buffer, donor surplus after its reserve, and whether the action can bridge the gap. Prefer a local transfer when sufficient surplus exists and preserve the donor's 7-day reserve. Do not treat a transfer as a cure for upstream shortages. The officer must approve all actions.",
          choices: actionChoices,
        }],
      }),
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      console.warn("Decisions API rejected request", response.status, payload.error?.message ?? "Unknown API error");
      return NextResponse.json({ ...fallback, fallbackReason: "upstream_unavailable" });
    }
    const answer = (payload.answers ?? []).find((item: DecisionApiAnswer & { name?: string }) => item.name === "next_action") as DecisionApiAnswer | undefined;
    if (!answer?.choice || !actionChoices.some((choice) => choice.value === answer.choice)) {
      console.warn("Decisions API returned an unexpected answer", Object.keys(payload));
      return NextResponse.json({ ...fallback, fallbackReason: "unexpected_response" });
    }
    const probabilities = Object.fromEntries(actionChoices.map(({ value }) => [value, 0])) as Record<DecisionAction, number>;
    for (const item of answer.probabilities ?? []) {
      if (item.value in probabilities) probabilities[item.value] = item.probability;
    }
    return NextResponse.json({
      action: answer.choice,
      confidence: typeof answer.confidence === "number" ? answer.confidence : probabilities[answer.choice],
      probabilities,
      source: "live",
    });
  } catch (error) {
    console.warn("Decisions API request failed", error instanceof Error ? error.message : "Unknown request error");
    return NextResponse.json({ ...fallback, fallbackReason: "request_failed" });
  }
}
