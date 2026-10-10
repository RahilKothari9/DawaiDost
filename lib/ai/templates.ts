// OWNER: ai agent. Deterministic text templates used when the Responses API is unavailable.
import { actionLabels } from "../scenario";
import type { DecisionAction } from "../district/types";
import type { ExplainResult } from "./types";

function pick(s: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), s);
}

export function templateExplain(body: { decision: { action: DecisionAction; confidence: number; donorId?: string | null }; snapshot: Record<string, unknown> }, reason: string): ExplainResult {
  const s = body.snapshot;
  const name = String(pick(s, ["target", "name"]) ?? "The facility");
  const med = [pick(s, ["medicine", "name"]), pick(s, ["medicine", "strength"])].filter(Boolean).join(" ") || "this medicine";
  const days = pick(s, ["target", "daysOfStock"]) ?? "?";
  const lead = pick(s, ["medicine", "leadTimeDays"]) ?? "?";
  const donors = (pick(s, ["donors"]) as { facilityId?: string; name?: string; transferable?: number }[] | undefined) ?? [];
  const donor = donors.find((d) => d.facilityId === body.decision.donorId) ?? donors[0];
  const pct = Math.round(body.decision.confidence * 100);
  const label = actionLabels[body.decision.action];
  const useDonor = body.decision.action === "transfer_surplus" && donor;
  const en = `${name} has ${days} days of ${med} against a ${lead}-day resupply lead time. The recommended step is "${label}" (${pct}% confidence)${useDonor ? `, using ${donor.name}'s ${donor.transferable} units of safe surplus` : ""}. Confirm the facts before approving.`;
  const hi = `${name} में ${med} का ${days} दिन का स्टॉक है, जबकि आपूर्ति में ${lead} दिन लगते हैं। सुझाया गया कदम "${label}" है (${pct}% भरोसा)${useDonor ? `, ${donor.name} के ${donor.transferable} सुरक्षित अतिरिक्त यूनिट से` : ""}। मंज़ूरी से पहले तथ्यों की पुष्टि करें।`;
  return {
    en,
    hi,
    keyFacts: [`${days} days of stock`, `${lead}-day lead time`, ...(donor ? [`${donor.name}: ${donor.transferable} transferable`] : [])],
    source: "demo_fallback",
    model: null,
    fallbackReason: reason,
    latencyMs: 0,
    generatedAt: new Date().toISOString(),
  };
}
