// OWNER: escalations agent. Escalation memo contract shared by client and server. Code computes every figure; the
// model may only write prose around fact keys, and any number in its prose must already exist in the facts.
import { z } from "zod";
import type { DistrictState } from "../district/types";
import type { SupplyGap } from "./gap";
import type { LeadTimeWatch } from "./leadtime";

export const MEMO_RECIPIENT = {
  to: "The Managing Director, State Medical Services Corporation (Drug Procurement), Madhya Pradesh",
  cc: ["Director, Directorate of Health Services, Madhya Pradesh", "Mission Director, National Health Mission, Madhya Pradesh"],
};

export const EVIDENCE_KEYS = [
  "siteCoverage",
  "threshold",
  "dailyUse",
  "siteStock",
  "warehouseStock",
  "needUnits",
  "transferableUnits",
  "gapUnits",
  "affectedFacilities",
  "affectedPopulation",
  "stockedOut",
  "districtStockoutDate",
  "warehouseOverdue",
  "requestedDeliveryDate",
  "replenishmentUnits",
  "decisions",
] as const;
export type EvidenceKey = (typeof EVIDENCE_KEYS)[number];

const Fact = z.object({ label: z.string().max(120), value: z.string().max(80) });

export const MemoFactsSchema = z.object({
  ref: z.string().max(80),
  asOf: z.string().max(40),
  district: z.string().max(60),
  state: z.string().max(60),
  officer: z.object({ name: z.string().max(80), title: z.string().max(80) }),
  medicine: z.object({ id: z.string().max(60), label: z.string().max(80), unit: z.string().max(60) }),
  upstream: z.object({ status: z.enum(["available", "delayed", "unavailable"]), note: z.string().max(400), expectedOn: z.string().max(20).nullable() }),
  facts: z.record(z.enum(EVIDENCE_KEYS), Fact),
  emergencyUnits: z.number().int().min(0),
  replenishmentUnits: z.number().int().min(0),
  requestedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  districtStockoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  flaggedSince: z.string().max(40).nullable(),
  affected: z.array(z.object({
    name: z.string().max(80), block: z.string().max(60), daysOfStock: z.number().nullable(), needUnits: z.number().int(), population: z.number().int(),
  })).max(30),
  decisions: z.array(z.object({ id: z.string().max(80), confidence: z.number(), source: z.string().max(20), createdAt: z.string().max(40) })).max(10),
});
export type MemoFacts = z.infer<typeof MemoFactsSchema>;

export type EvidenceRow = { key: EvidenceKey; label: string; value: string; remark: string };

export type EscalationMemo = {
  ref: string;
  date: string; // ISO date
  from: string;
  to: string;
  cc: string[];
  subject: string;
  summary: string;
  hindiSummary: string;
  evidence: EvidenceRow[];
  asks: string[];
  requestedDeliveryDate: string;
  annex: MemoFacts["affected"];
};

export type MemoResponse = {
  memo: EscalationMemo;
  source: "live" | "fallback";
  fallbackReason?: "missing_api_key" | "upstream_unavailable" | "unexpected_response" | "unverified_number" | "request_failed";
  model?: string;
  latencyMs?: number;
};

const intFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const dayFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
export const fmtUnits = (n: number) => intFmt.format(Math.round(n));
export const fmtLongDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/** Builds the memo facts from code-computed gap and lead-time results. */
export function buildMemoFacts(state: DistrictState, gap: SupplyGap, lead: LeadTimeWatch | null, ref: string): MemoFacts {
  const u = gap.medicine.unit;
  const flagged = state.timeline
    .filter((e) => e.medicineId === gap.medicineId && !e.facilityId && (e.kind === "alert" || e.kind === "escalation"))
    .map((e) => e.at)
    .sort()[0] ?? null;
  const decisions = state.decisions.filter((d) => d.action === "escalate_supply_gap" && d.medicineId === gap.medicineId).slice(0, 10);
  const facts: MemoFacts["facts"] = {
    siteCoverage: { label: "District facility cover", value: gap.siteCoverageDays === null ? "no consumption" : `${dayFmt.format(gap.siteCoverageDays)} days` },
    threshold: { label: "Required cover (lead time + buffer)", value: `${gap.thresholdDays} days` },
    dailyUse: { label: "District consumption", value: `${dayFmt.format(gap.totalDailyUse)} ${u}/day` },
    siteStock: { label: "Stock on facility shelves", value: `${fmtUnits(gap.siteStock)} ${u}` },
    warehouseStock: { label: "District warehouse stock", value: `${fmtUnits(gap.warehouseStock)} ${u}` },
    needUnits: { label: "Units facilities need to reach required cover", value: `${fmtUnits(gap.needUnits)} ${u}` },
    transferableUnits: { label: "Safe surplus transferable within district", value: `${fmtUnits(gap.transferableUnits)} ${u}` },
    gapUnits: { label: "Shortfall after all local options", value: `${fmtUnits(gap.gapUnits)} ${u}` },
    affectedFacilities: { label: "Facilities below required cover", value: `${gap.affected.length} of ${gap.facilities}` },
    affectedPopulation: { label: "Catchment population of those facilities", value: fmtUnits(gap.affectedPopulation) },
    stockedOut: { label: "Facilities already stocked out", value: String(gap.stockedOut) },
    districtStockoutDate: { label: "District stock exhausted (with full redistribution)", value: gap.districtStockoutDate ? fmtLongDate(gap.districtStockoutDate) : "not projected" },
    warehouseOverdue: {
      label: "Last state consignment to warehouse",
      value: lead?.warehouse.lastReceiptWeekOf
        ? `week of ${fmtLongDate(lead.warehouse.lastReceiptWeekOf)}${lead.warehouse.overdueDays > 0 ? `, ${Math.round(lead.warehouse.overdueDays)} days overdue` : ""}`
        : "none on record",
    },
    requestedDeliveryDate: { label: "Requested delivery to district warehouse", value: `on or before ${fmtLongDate(gap.requestedDeliveryDate)}` },
    replenishmentUnits: { label: "One month of district consumption", value: `${fmtUnits(gap.replenishmentUnits)} ${u}` },
    decisions: { label: "Decisions API escalation recommendations", value: decisions.length ? `${decisions.length} (top confidence ${Math.round(Math.max(...decisions.map((d) => d.confidence)) * 100)}%)` : "none recorded" },
  };
  return {
    ref, asOf: state.now, district: state.district.name, state: state.district.state, officer: state.district.officer,
    medicine: { id: gap.medicineId, label: `${gap.medicine.name} ${gap.medicine.strength}`, unit: u },
    upstream: { status: gap.upstream.status, note: gap.upstream.note, expectedOn: gap.upstream.expectedOn ?? null },
    facts, emergencyUnits: gap.emergencyUnits, replenishmentUnits: gap.replenishmentUnits,
    requestedDeliveryDate: gap.requestedDeliveryDate, districtStockoutDate: gap.districtStockoutDate, flaggedSince: flagged,
    affected: gap.affected.slice(0, 30).map((a) => ({ name: a.name, block: a.block, daysOfStock: a.daysOfStock, needUnits: a.needUnits, population: a.population })),
    decisions: decisions.map((d) => ({ id: d.id, confidence: d.confidence, source: d.source, createdAt: d.createdAt })),
  };
}

/** Default evidence rows, in the order a procurement officer reads them. */
export const DEFAULT_EVIDENCE: EvidenceKey[] = [
  "siteCoverage", "threshold", "needUnits", "transferableUnits", "warehouseStock", "gapUnits", "affectedFacilities", "affectedPopulation", "warehouseOverdue", "districtStockoutDate",
];

export function evidenceRow(facts: MemoFacts, key: EvidenceKey, remark = ""): EvidenceRow {
  return { key, label: facts.facts[key].label, value: facts.facts[key].value, remark };
}

/** Deterministic template memo. Used whenever the live model is unavailable or its output fails a check. */
export function fallbackMemo(f: MemoFacts): EscalationMemo {
  const F = f.facts;
  const short = f.emergencyUnits > 0;
  const subject = short
    ? `Urgent supply of ${f.medicine.label}: ${fmtUnits(f.emergencyUnits)} ${f.medicine.unit} short in ${f.district} district`
    : `Supply risk for ${f.medicine.label} in ${f.district} district`;
  const summary = [
    `${f.district} district holds ${F.siteCoverage.value} of ${f.medicine.label} at facilities against a required ${F.threshold.value}.`,
    `${F.affectedFacilities.value} facilities, serving ${F.affectedPopulation.value} people, are below required cover; ${F.stockedOut.value} are already stocked out.`,
    `Safe surplus within the district (${F.transferableUnits.value}) and the district warehouse (${F.warehouseStock.value}) cannot close the need of ${F.needUnits.value}${short ? `, leaving ${F.gapUnits.value} short` : ""}.`,
    f.upstream.status !== "available" ? `The state supply line is ${f.upstream.status}: ${f.upstream.note}` : "",
  ].filter(Boolean).join(" ");
  const hindiSummary = [
    `${f.district} ज़िले में ${f.medicine.label} का भंडार ज़रूरी स्तर से कम है।`,
    `${F.affectedFacilities.value} स्वास्थ्य केंद्र (${F.affectedPopulation.value} आबादी) प्रभावित हैं।`,
    short ? `ज़िले के भीतर स्थानांतरण और गोदाम के बाद भी ${fmtUnits(f.emergencyUnits)} ${f.medicine.unit} की कमी है।` : "",
    `कृपया ${fmtLongDate(f.requestedDeliveryDate)} तक आपूर्ति सुनिश्चित करें।`,
  ].filter(Boolean).join(" ");
  const asks = [
    short ? `Emergency dispatch of ${fmtUnits(f.emergencyUnits)} ${f.medicine.unit} of ${f.medicine.label} to the ${f.district} district warehouse, ${F.requestedDeliveryDate.value}.` : "",
    `Confirm a dated schedule for the next regular consignment (${F.replenishmentUnits.value}, one month of district consumption).`,
    f.upstream.status !== "available" ? "If the rate-contract supplier cannot deliver, authorise local purchase or inter-district transfer for the shortfall." : "",
    "Acknowledge this request so the district can plan facility allocations.",
  ].filter(Boolean);
  return assemble(f, { subject, summary, hindiSummary, asks, evidence: DEFAULT_EVIDENCE.map((k) => evidenceRow(f, k)) });
}

export function assemble(f: MemoFacts, parts: { subject: string; summary: string; hindiSummary: string; asks: string[]; evidence: EvidenceRow[] }): EscalationMemo {
  return {
    ref: f.ref,
    date: f.asOf.slice(0, 10),
    from: `${f.officer.name}, ${f.officer.title}, ${f.district}`,
    to: MEMO_RECIPIENT.to,
    cc: MEMO_RECIPIENT.cc,
    ...parts,
    requestedDeliveryDate: f.requestedDeliveryDate,
    annex: f.affected,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Live-output contract and number guard

export function memoOutputSchema() {
  return z.object({
    subject: z.string().describe("One line, under 120 characters."),
    summary: z.string().describe("Two to four sentences in formal English. Only cite figures that appear in the facts."),
    hindiSummary: z.string().describe("Two or three sentences in formal Hindi (Devanagari), Western digits only."),
    evidence: z.array(z.object({
      key: z.enum(EVIDENCE_KEYS),
      remark: z.string().describe("Short interpretation of this fact, no new numbers. May be empty."),
    })).describe("Five to nine fact keys, most decisive first."),
    asks: z.array(z.string()).describe("Two to four specific requests to the state, each one sentence."),
  });
}
export type MemoModelOutput = z.infer<ReturnType<typeof memoOutputSchema>>;

const DEVANAGARI_DIGITS = "०१२३४५६७८९";
const toAscii = (s: string) => s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
const numbersIn = (s: string) => (toAscii(s).replace(/(\d),(?=\d)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));

/** Every number that appears anywhere in the facts (values, labels, dates, notes) is allowed in model prose. */
export function allowedNumbers(f: MemoFacts): Set<string> {
  const set = new Set(numbersIn(JSON.stringify(f)));
  for (const d of [f.requestedDeliveryDate, f.districtStockoutDate, f.asOf.slice(0, 10)]) if (d) numbersIn(fmtLongDate(d)).forEach((n) => set.add(n));
  for (let i = 0; i <= 10; i++) set.add(String(i)); // small counts and ordinals ("two facilities", "1.")
  set.add("100"); // percentages
  return set;
}

/** Numbers in model prose that are not present in the facts. Empty array = output is grounded. */
export function unverifiedNumbers(f: MemoFacts, out: MemoModelOutput): string[] {
  const allowed = allowedNumbers(f);
  const text = [out.subject, out.summary, out.hindiSummary, ...out.asks, ...out.evidence.map((e) => e.remark)].join("\n");
  return [...new Set(numbersIn(text).filter((n) => !allowed.has(n)))];
}

/** Turns validated model output into a memo; evidence values always come from facts. */
export function memoFromModel(f: MemoFacts, out: MemoModelOutput): EscalationMemo {
  const seen = new Set<EvidenceKey>();
  const evidence = out.evidence.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true))).map((e) => evidenceRow(f, e.key, e.remark.trim()));
  if (!seen.has("gapUnits") && f.emergencyUnits > 0) evidence.push(evidenceRow(f, "gapUnits"));
  return assemble(f, {
    subject: out.subject.trim(),
    summary: out.summary.trim(),
    hindiSummary: out.hindiSummary.trim(),
    asks: out.asks.map((a) => a.trim()).filter(Boolean).slice(0, 4),
    evidence: evidence.slice(0, 10),
  });
}
