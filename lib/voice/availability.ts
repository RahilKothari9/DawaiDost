// Answers the Realtime `check_availability` tool (and its offline fallback) from the district store.
import { assessStock, haversineKm } from "../district/engine";
import type { DistrictState, Facility, Medicine } from "../district/types";
import { medicineAliases } from "./facts";
import { normalizeHindi } from "./numbers";

export type AvailabilityAnswer = {
  found: boolean;
  medicine?: { id: string; name: string; strength: string; unit: string };
  facility?: { id: string; name: string; block: string };
  available?: boolean;
  stock?: number;
  daysOfStock?: number | null;
  risk?: string;
  verified?: boolean;
  lastReportAt?: string;
  alternatives?: { facilityId: string; name: string; block: string; distanceKm: number; stock: number; daysOfStock: number | null }[];
  note: string;
};

function score(query: string, candidates: string[]): number {
  const q = normalizeHindi(query).replace(/\s+/g, " ").trim();
  if (!q) return 0;
  let best = 0;
  for (const c of candidates) {
    const n = normalizeHindi(c);
    if (n === q) return 1;
    if (n.includes(q) || q.includes(n)) best = Math.max(best, 0.8);
    const qTokens = q.split(" ");
    if (qTokens.some((t) => t.length >= 4 && n.includes(t))) best = Math.max(best, 0.6);
  }
  return best;
}

export function matchMedicine(state: DistrictState, query: string): Medicine | undefined {
  const ranked = state.medicines
    .map((m) => ({ m, s: score(query, [m.id, m.name, `${m.name} ${m.strength}`, ...medicineAliases(m.name, m.id)]) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.m;
}

export function matchFacility(state: DistrictState, query: string): Facility | undefined {
  const strip = (s: string) => s.replace(/\b(phc|chc|dh|primary health cent(re|er)|health cent(re|er))\b/gi, "").replace(/(पीएचसी|सीएचसी|स्वास्थ्य केंद्र|प्राथमिक)/g, "").trim();
  const ranked = state.facilities
    .filter((f) => f.type !== "WAREHOUSE")
    .map((f) => ({ f, s: Math.max(score(query, [f.id, f.name]), score(strip(query), [strip(f.name), f.id])) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.f;
}

const days = (stock: number, use: number) => (use > 0 ? Math.round((stock / use) * 10) / 10 : null);

export function checkAvailability(state: DistrictState, medicineQuery: string, facilityQuery: string): AvailabilityAnswer {
  const med = matchMedicine(state, medicineQuery);
  if (!med) return { found: false, note: `No medicine matching "${medicineQuery}" is tracked in this district. Ask the caller to repeat the medicine name.` };
  const facility = facilityQuery ? matchFacility(state, facilityQuery) : undefined;
  if (!facility) return { found: false, medicine: { id: med.id, name: med.name, strength: med.strength, unit: med.unit }, note: `No facility matching "${facilityQuery}". Ask which PHC the caller means.` };

  const record = state.stock.find((s) => s.facilityId === facility.id && s.medicineId === med.id);
  const assessment = record ? assessStock(record, med, state.now) : undefined;
  const available = Boolean(record && record.stock > 0);

  const alternatives = state.stock
    .filter((s) => s.medicineId === med.id && s.facilityId !== facility.id && s.stock > 0)
    .flatMap((s) => {
      const f = state.facilities.find((x) => x.id === s.facilityId);
      if (!f || f.type === "WAREHOUSE") return [];
      return [{ facilityId: f.id, name: f.name, block: f.block, distanceKm: Math.round(haversineKm(facility, f) * 10) / 10, stock: s.stock, daysOfStock: days(s.stock, s.dailyUse) }];
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 2);

  const lowStock = assessment && (assessment.risk === "critical" || assessment.risk === "low");
  return {
    found: true,
    medicine: { id: med.id, name: med.name, strength: med.strength, unit: med.unit },
    facility: { id: facility.id, name: facility.name, block: facility.block },
    available,
    stock: record?.stock ?? 0,
    daysOfStock: record ? days(record.stock, record.dailyUse) : null,
    risk: assessment?.risk ?? "not_stocked",
    verified: record?.verified,
    lastReportAt: record?.lastReportAt,
    alternatives: !available || lowStock ? alternatives : alternatives.slice(0, 1),
    note: !record
      ? "This facility does not stock this medicine. Suggest the nearest alternative."
      : !available
        ? "Out of stock here. Suggest the nearest facility with stock, with distance."
        : lowStock
          ? "Available but running low; suggest the caller go soon or use the nearest alternative."
          : "Available. Answer yes, without promising an exact quantity to a patient.",
  };
}

/** Deterministic Hindi answer used when Realtime is unavailable (labeled fallback). */
export function availabilityAnswerHindi(a: AvailabilityAnswer, hindiMed: string): string {
  if (!a.found || !a.facility) return "माफ़ कीजिए, मुझे यह दवा या स्वास्थ्य केंद्र रिकॉर्ड में नहीं मिला। कृपया नाम दोबारा बताइए।";
  const alt = a.alternatives?.[0];
  const altText = alt ? ` नज़दीकी विकल्प ${alt.name} है, लगभग ${Math.round(alt.distanceKm)} किलोमीटर दूर, जहाँ यह दवा उपलब्ध है।` : "";
  if (!a.available) return `${a.facility.name} में अभी ${hindiMed} उपलब्ध नहीं है।${altText || " ज़िले में अभी कोई नज़दीकी विकल्प नहीं मिला।"}`;
  if (a.risk === "critical" || a.risk === "low") return `हाँ, ${a.facility.name} में ${hindiMed} उपलब्ध है, लेकिन स्टॉक कम है, जल्दी जाएँ।${altText}`;
  return `हाँ, ${a.facility.name} में ${hindiMed} उपलब्ध है।`;
}
