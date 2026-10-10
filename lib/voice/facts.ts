// Builds the facts-only snapshot the voice layer sends to the server. Pure + deterministic.
import type { DistrictState, Facility, Medicine, StockRecord } from "../district/types";
import type { Directory, FacilityRef, MedicineFact, VoiceFacts } from "./types";

/** Common Hindi spellings for the tracer medicines; unknown names fall back to the English name. */
export const HINDI_MEDICINE_NAMES: Record<string, string[]> = {
  metformin: ["मेटफॉर्मिन", "मेटफार्मिन", "मेटफोर्मिन", "metformin"],
  amlodipine: ["एम्लोडिपिन", "अम्लोडिपिन", "एमलोडिपिन", "amlodipine"],
  telmisartan: ["टेल्मिसार्टन", "टेलमिसार्टन", "telmisartan"],
  glimepiride: ["ग्लिमेपिराइड", "glimepiride"],
  paracetamol: ["पैरासिटामोल", "पेरासिटामोल", "पैरासीटामोल", "paracetamol"],
  amoxicillin: ["एमोक्सिसिलिन", "अमोक्सिसिलिन", "एमॉक्सिसिलिन", "amoxicillin"],
  azithromycin: ["एज़िथ्रोमाइसिन", "अज़िथ्रोमाइसिन", "azithromycin"],
  ors: ["ओआरएस", "ओ आर एस", "ors"],
  zinc: ["ज़िंक", "जिंक", "zinc"],
  "iron folic": ["आयरन फोलिक", "आयरन", "आईएफए", "ifa", "iron"],
  ifa: ["आयरन फोलिक", "आयरन", "आईएफए", "ifa"],
  oxytocin: ["ऑक्सीटोसिन", "ऑक्सिटोसिन", "oxytocin"],
  misoprostol: ["मिसोप्रोस्टोल", "misoprostol"],
  salbutamol: ["सालबुटामोल", "साल्बुटामोल", "salbutamol"],
  cotrimoxazole: ["कोट्रिमोक्साज़ोल", "cotrimoxazole"],
  "calcium": ["कैल्शियम", "calcium"],
  albendazole: ["एल्बेंडाजोल", "अल्बेंडाज़ोल", "albendazole"],
  insulin: ["इंसुलिन", "insulin"],
  ibuprofen: ["आइबुप्रोफेन", "ibuprofen"],
  enalapril: ["एनालाप्रिल", "enalapril"],
  atenolol: ["एटेनोलोल", "atenolol"],
  ciprofloxacin: ["सिप्रोफ्लोक्सासिन", "ciprofloxacin"],
  dextrose: ["डेक्सट्रोज़", "dextrose"],
  magnesium: ["मैग्नीशियम", "magnesium"],
};

export function medicineAliases(name: string, id = ""): string[] {
  const key = name.toLowerCase();
  const out = new Set<string>([key, id.toLowerCase().split("-")[0]].filter(Boolean));
  for (const [k, v] of Object.entries(HINDI_MEDICINE_NAMES)) {
    if (key.includes(k) || id.toLowerCase().startsWith(k.replace(/\s+/g, "-"))) v.forEach((a) => out.add(a));
  }
  return [...out].filter((a) => a.length >= 3);
}

export function hindiMedicineName(name: string): string {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(HINDI_MEDICINE_NAMES)) if (key.includes(k)) return v[0];
  return name;
}

const DAY_MS = 864e5;

/** Plausible range for today's shelf count, derived from the last verified count, use rate, and weekly ledger. */
export function expectedRange(record: Pick<StockRecord, "stock" | "dailyUse" | "lastReportAt" | "history">, now: string) {
  const elapsedDays = Math.max(0, (new Date(now).getTime() - new Date(record.lastReportAt).getTime()) / DAY_MS);
  const expected = Math.max(0, Math.round(record.stock - record.dailyUse * elapsedDays));
  const recentDispensed = record.history?.slice(-4).map((h) => h.dispensed) ?? [];
  const weeklySwing = recentDispensed.length ? Math.max(...recentDispensed) - Math.min(...recentDispensed) : 0;
  const tolerance = Math.max(5, Math.round(record.dailyUse * 3), Math.round(expected * 0.35), weeklySwing);
  return { expected, expectedMin: Math.max(0, expected - tolerance), expectedMax: expected + tolerance, elapsedDays, tolerance };
}

/** Stable small hash for deterministic per-facility variation (schedules, simulated counts). */
export function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Synthetic "true" shelf count the simulated pharmacist reports: expected ± a small deterministic wobble. */
export function simulatedShelfCount(record: StockRecord, now: string, opts: { slip?: boolean } = {}): number {
  const { expected, tolerance } = expectedRange(record, now);
  const wobble = (stableHash(`${record.facilityId}:${record.medicineId}:${record.lastReportAt}`) % 5) - 2; // -2..+2
  const value = Math.max(0, expected + wobble);
  // A "slip" models a mis-spoken or mis-counted number (extra zero / wrong shelf) to exercise the recount path.
  return opts.slip ? Math.max(value * 10, value + tolerance * 4 + 40) : value;
}

export function facilityRef(f: Facility): FacilityRef {
  return { id: f.id, name: f.name, block: f.block, type: f.type, pharmacistName: f.pharmacist.name, language: f.pharmacist.language };
}

export function medicineFact(record: StockRecord, med: Medicine, now: string, shelfCount?: number): MedicineFact {
  const r = expectedRange(record, now);
  return {
    id: med.id,
    name: med.name,
    strength: med.strength,
    unit: med.unit,
    hindiName: hindiMedicineName(med.name),
    lastCount: record.stock,
    dailyUse: record.dailyUse,
    expected: r.expected,
    expectedMin: r.expectedMin,
    expectedMax: r.expectedMax,
    shelfCount,
    lastReportAt: record.lastReportAt,
  };
}

const RISK_ORDER = { stockout: 0, critical: 1, low: 2, ok: 3, surplus: 4 } as const;

/**
 * Tracer medicines for one facility's call: selected medicine first, then the riskiest, capped so a
 * call stays under ~90 seconds.
 */
export function tracerRecords(state: DistrictState, facilityId: string, limit = 4): StockRecord[] {
  const rows = state.stock.filter((s) => s.facilityId === facilityId);
  const score = (r: StockRecord) => {
    const days = r.dailyUse > 0 ? r.stock / r.dailyUse : 999;
    const med = state.medicines.find((m) => m.id === r.medicineId);
    const threshold = med ? med.leadTimeDays + med.safetyBufferDays : 8;
    const risk = r.stock <= 0 ? RISK_ORDER.stockout : days < (med?.leadTimeDays ?? 5) ? RISK_ORDER.critical : days < threshold ? RISK_ORDER.low : RISK_ORDER.ok;
    return (r.medicineId === state.selectedMedicineId ? -10 : 0) + (needsRecount(r) ? -5 : 0) + risk + days / 1000;
  };
  return [...rows].sort((a, b) => score(a) - score(b)).slice(0, limit);
}

export function needsRecount(record: StockRecord): boolean {
  const flagged = (record as StockRecord & { recountRequested?: { reason: string } | null }).recountRequested;
  return Boolean(flagged);
}

export function buildFacilityFacts(state: DistrictState, facilityId: string, opts: { limit?: number; slipMedicineId?: string | null } = {}): VoiceFacts & { facility: FacilityRef; medicines: MedicineFact[] } {
  const facility = state.facilities.find((f) => f.id === facilityId) ?? state.facilities[0];
  const records = tracerRecords(state, facility.id, opts.limit ?? 4);
  const medicines = records.flatMap((r) => {
    const med = state.medicines.find((m) => m.id === r.medicineId);
    if (!med) return [];
    return [medicineFact(r, med, state.now, simulatedShelfCount(r, state.now, { slip: opts.slipMedicineId === r.medicineId }))];
  });
  return { facility: facilityRef(facility), medicines, districtName: state.district.name, now: state.now };
}

export function buildDirectory(state: DistrictState): Directory {
  return {
    facilities: state.facilities.filter((f) => f.type !== "WAREHOUSE").map((f) => ({ id: f.id, name: f.name, block: f.block })),
    medicines: state.medicines.map((m) => ({ id: m.id, name: m.name, strength: m.strength, hindiName: hindiMedicineName(m.name) })),
  };
}

/** Deterministically choose whether a facility's simulated check-in contains a mis-count (for the roster run). */
export function slipMedicineFor(facilityId: string, medicineIds: string[], weekKey: string): string | null {
  if (!medicineIds.length) return null;
  const h = stableHash(`${facilityId}:${weekKey}`);
  return h % 4 === 1 ? medicineIds[h % medicineIds.length] : null;
}
