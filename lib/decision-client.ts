import type { Clinic, DecisionAction } from "./scenario";

export type DecisionResult = {
  action: DecisionAction;
  confidence: number;
  probabilities: Record<DecisionAction, number>;
  source: "live" | "demo_fallback";
  fallbackReason?: string;
};

export async function requestDecision(clinics: Clinic[]): Promise<DecisionResult> {
  const response = await fetch("/api/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clinics }),
  });
  if (!response.ok) throw new Error("Decision request failed");
  return response.json() as Promise<DecisionResult>;
}
