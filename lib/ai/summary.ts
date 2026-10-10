// OWNER: ai agent. Compact district summary for the morning briefing (built client-side from the store).
import { z } from "zod";
import { actionLabels } from "../scenario";
import type { DistrictState, StockAssessment } from "../district/types";
import type { Bilingual, Briefing, BriefingTone } from "./types";

export const briefingSummarySchema = z.object({
  district: z.string().max(120),
  officer: z.string().max(120),
  asOf: z.string().max(40),
  counts: z.object({ facilities: z.number(), atRiskRecords: z.number(), stockouts: z.number(), critical: z.number(), pendingDecisions: z.number(), transfersInMotion: z.number(), escalations: z.number() }),
  topRisks: z.array(z.object({ facility: z.string(), block: z.string(), medicine: z.string(), daysOfStock: z.number().nullable(), risk: z.string(), stockoutDate: z.string().nullable() })).max(8),
  pendingDecisions: z.array(z.object({ facility: z.string(), medicine: z.string(), action: z.string(), confidence: z.number(), source: z.string() })).max(8),
  transfers: z.array(z.object({ from: z.string(), to: z.string(), medicine: z.string(), quantity: z.number(), status: z.string() })).max(8),
  escalations: z.array(z.object({ title: z.string().max(200), at: z.string() })).max(6),
});
export type BriefingSummary = z.infer<typeof briefingSummarySchema>;

const RISK_RANK: Record<string, number> = { stockout: 0, critical: 1, low: 2 };

export function buildBriefingSummary(state: DistrictState, assessments: StockAssessment[]): BriefingSummary {
  const fac = (id: string) => state.facilities.find((f) => f.id === id);
  const med = (id: string) => state.medicines.find((m) => m.id === id);
  const medName = (id: string) => { const m = med(id); return m ? `${m.name} ${m.strength}` : id; };
  const atRisk = assessments.filter((a) => a.risk in RISK_RANK && fac(a.facilityId)?.type !== "WAREHOUSE")
    .sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || a.daysOfStock - b.daysOfStock);
  const pending = state.decisions.filter((d) => d.status === "pending");
  const moving = state.transfers.filter((t) => t.status === "approved" || t.status === "in_transit" || t.status === "proposed");
  const escal = state.timeline.filter((e) => e.kind === "escalation");
  return {
    district: `${state.district.name}, ${state.district.state}`,
    officer: `${state.district.officer.name}, ${state.district.officer.title}`,
    asOf: state.now,
    counts: {
      facilities: state.facilities.filter((f) => f.type !== "WAREHOUSE").length,
      atRiskRecords: atRisk.length,
      stockouts: atRisk.filter((a) => a.risk === "stockout").length,
      critical: atRisk.filter((a) => a.risk === "critical").length,
      pendingDecisions: pending.length,
      transfersInMotion: moving.length,
      escalations: escal.length,
    },
    topRisks: atRisk.slice(0, 6).map((a) => ({ facility: fac(a.facilityId)?.name ?? a.facilityId, block: fac(a.facilityId)?.block ?? "", medicine: medName(a.medicineId), daysOfStock: Number.isFinite(a.daysOfStock) ? Math.round(a.daysOfStock * 10) / 10 : null, risk: a.risk, stockoutDate: a.projectedStockoutDate })),
    pendingDecisions: pending.slice(0, 6).map((d) => ({ facility: fac(d.facilityId)?.name ?? d.facilityId, medicine: medName(d.medicineId), action: actionLabels[d.action], confidence: Math.round(d.confidence * 100) / 100, source: d.source })),
    transfers: moving.slice(0, 6).map((t) => ({ from: fac(t.fromId)?.name ?? t.fromId, to: fac(t.toId)?.name ?? t.toId, medicine: medName(t.medicineId), quantity: t.quantity, status: t.status })),
    escalations: escal.slice(0, 4).map((e) => ({ title: e.title, at: e.at })),
  };
}

/** Deterministic template brief, used whenever the Responses API is unavailable. */
export function templateBriefing(s: BriefingSummary, fallbackReason: string): Briefing {
  const c = s.counts;
  const bullets: (Bilingual & { tone: BriefingTone })[] = [];
  const top = s.topRisks[0];
  if (top) bullets.push({ tone: "risk", en: `${top.facility} has ${top.daysOfStock ?? 0} days of ${top.medicine} left (${top.risk}).`, hi: `${top.facility} में ${top.medicine} का ${top.daysOfStock ?? 0} दिन का स्टॉक बचा है (${top.risk})।` });
  if (c.stockouts || c.critical) bullets.push({ tone: "risk", en: `${c.stockouts} stockouts and ${c.critical} critical records across ${c.facilities} facilities.`, hi: `${c.facilities} केंद्रों में ${c.stockouts} स्टॉकआउट और ${c.critical} गंभीर स्थिति।` });
  if (c.pendingDecisions) bullets.push({ tone: "info", en: `${c.pendingDecisions} AI-recommended decisions are waiting for your approval.`, hi: `${c.pendingDecisions} AI सुझाव आपकी मंज़ूरी का इंतज़ार कर रहे हैं।` });
  if (c.transfersInMotion) bullets.push({ tone: "progress", en: `${c.transfersInMotion} transfers are proposed or moving.`, hi: `${c.transfersInMotion} ट्रांसफर प्रस्तावित या रास्ते में हैं।` });
  if (c.escalations) bullets.push({ tone: "info", en: `${c.escalations} supply gaps have been escalated.`, hi: `${c.escalations} आपूर्ति कमियाँ आगे भेजी गई हैं।` });
  if (bullets.length < 3) bullets.push({ tone: "progress", en: `${c.facilities - new Set(s.topRisks.map((r) => r.facility)).size} facilities have no urgent risk today.`, hi: `आज बाकी केंद्रों में कोई तत्काल जोखिम नहीं है।` });
  return {
    headline: c.atRiskRecords
      ? { en: `${c.atRiskRecords} medicine risks need attention in ${s.district.split(",")[0]} today`, hi: `आज ${s.district.split(",")[0]} में ${c.atRiskRecords} दवा जोखिमों पर ध्यान देना है` }
      : { en: `No urgent medicine risks in ${s.district.split(",")[0]} today`, hi: `आज ${s.district.split(",")[0]} में कोई तत्काल दवा जोखिम नहीं` },
    bullets: bullets.slice(0, 5),
    actions: [
      c.pendingDecisions ? { en: "Review the decision queue and approve or reject each recommendation.", hi: "निर्णय कतार देखें और हर सुझाव को मंज़ूर या अस्वीकार करें।" } : { en: "Run the Decisions API on all at-risk items.", hi: "सभी जोखिम वाले मामलों पर Decisions API चलाएँ।" },
      ...(top ? [{ en: `Call ${top.facility} about ${top.medicine}.`, hi: `${top.medicine} के बारे में ${top.facility} से बात करें।` }] : []),
    ],
    source: "demo_fallback",
    model: null,
    fallbackReason,
    latencyMs: 0,
    generatedAt: new Date().toISOString(),
  };
}
