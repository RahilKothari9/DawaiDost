// OWNER: data agent. SYNTHETIC, FICTIONAL Sehore district network. No real facility, person, phone or stock data.
import type { DecisionRecord, DistrictInfo, DistrictState, Facility, FacilityType, Medicine, StockRecord, TimelineEvent, Transfer, WeeklyPoint } from "./types";

export const SEED_NOW = "2026-10-10T09:42:00+05:30";
export const SEED_VERSION = 3;
export const SYNTHETIC_DATA_NOTICE = "Synthetic demo data. Facilities (other than block names), people, phone numbers and stock counts are fictional.";
export const HISTORY_WEEKS = 12;

const HOUR = 36e5;
const DAY = 864e5;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const iso = (ms: number) => new Date(ms).toISOString();

export const DISTRICT: DistrictInfo = {
  name: "Sehore",
  state: "Madhya Pradesh",
  center: [77.12, 23.0],
  zoom: 8.6,
  officer: { name: "Dr. Ananya Rao", title: "District Health Officer" },
};

export const MEDICINES: Medicine[] = [
  { id: "metformin-500", name: "Metformin", strength: "500 mg", shortName: "Metformin 500", unit: "strip of 10 tablets", category: "diabetes", leadTimeDays: 5, safetyBufferDays: 3, reserveDays: 7, upstream: { status: "available", note: "District warehouse holds ~9 days of district issues; next state consignment due in 5 days.", expectedOn: "2026-10-15" } },
  { id: "glimepiride-2", name: "Glimepiride", strength: "2 mg", shortName: "Glimepiride 2", unit: "strip of 10 tablets", category: "diabetes", leadTimeDays: 7, safetyBufferDays: 3, reserveDays: 7, upstream: { status: "available", note: "Rate-contract supply normal.", expectedOn: "2026-10-20" } },
  { id: "amlodipine-5", name: "Amlodipine", strength: "5 mg", shortName: "Amlodipine 5", unit: "strip of 10 tablets", category: "hypertension", leadTimeDays: 7, safetyBufferDays: 4, reserveDays: 7, upstream: { status: "delayed", note: "State rate-contract supplier missed the September consignment; district warehouse is empty and no revised dispatch date is confirmed.", expectedOn: null } },
  { id: "telmisartan-40", name: "Telmisartan", strength: "40 mg", shortName: "Telmisartan 40", unit: "strip of 10 tablets", category: "hypertension", leadTimeDays: 7, safetyBufferDays: 3, reserveDays: 7, upstream: { status: "available", note: "Rate-contract supply normal.", expectedOn: "2026-10-19" } },
  { id: "atenolol-50", name: "Atenolol", strength: "50 mg", shortName: "Atenolol 50", unit: "strip of 14 tablets", category: "hypertension", leadTimeDays: 7, safetyBufferDays: 3, reserveDays: 7, upstream: { status: "available", note: "Rate-contract supply normal.", expectedOn: "2026-10-17" } },
  { id: "ifa-tablets", name: "IFA", strength: "60 mg Fe + 500 mcg FA", shortName: "IFA", unit: "strip of 10 tablets", category: "maternal", leadTimeDays: 6, safetyBufferDays: 4, reserveDays: 7, upstream: { status: "available", note: "Anemia Mukt Bharat allocation received; warehouse well stocked.", expectedOn: "2026-10-16" } },
  { id: "amoxicillin-500", name: "Amoxicillin", strength: "500 mg", shortName: "Amoxicillin 500", unit: "strip of 10 capsules", category: "antibiotic", leadTimeDays: 5, safetyBufferDays: 3, reserveDays: 7, upstream: { status: "available", note: "Rate-contract supply normal.", expectedOn: "2026-10-14" } },
  { id: "paracetamol-500", name: "Paracetamol", strength: "500 mg", shortName: "Paracetamol 500", unit: "strip of 10 tablets", category: "analgesic", leadTimeDays: 4, safetyBufferDays: 3, reserveDays: 7, upstream: { status: "available", note: "Supply normal; post-monsoon demand easing.", expectedOn: "2026-10-13" } },
  { id: "ors-sachet", name: "ORS", strength: "20.5 g WHO-ORS", shortName: "ORS", unit: "sachet", category: "nutrition", leadTimeDays: 4, safetyBufferDays: 3, reserveDays: 7, upstream: { status: "available", note: "Supply normal; monsoon diarrhoea season tailing off.", expectedOn: "2026-10-13" } },
  { id: "salbutamol-inhaler", name: "Salbutamol", strength: "100 mcg, 200 doses", shortName: "Salbutamol inhaler", unit: "inhaler", category: "respiratory", leadTimeDays: 10, safetyBufferDays: 5, reserveDays: 7, upstream: { status: "available", note: "Supply normal but slow; long lead time.", expectedOn: "2026-10-21" } },
];

type FacilitySeed = [id: string, name: string, type: FacilityType, block: string, lat: number, lng: number, pharmacist: string, population: number];

const FACILITY_SEEDS: FacilitySeed[] = [
  ["warehouse-sehore", "District Drug Warehouse", "WAREHOUSE", "Sehore", 23.195, 77.098, "M. Khan (store keeper)", 1311000],
  ["dh-sehore", "District Hospital Sehore", "DH", "Sehore", 23.207, 77.08, "A. Saxena", 210000],
  ["chc-ashta", "CHC Ashta", "CHC", "Ashta", 23.018, 76.722, "P. Malviya", 120000],
  ["chc-ichhawar", "CHC Ichhawar", "CHC", "Ichhawar", 23.028, 77.017, "N. Thakur", 95000],
  ["chc-nasrullaganj", "CHC Nasrullaganj", "CHC", "Nasrullaganj", 22.684, 77.27, "V. Rajput", 105000],
  ["chc-budhni", "CHC Budhni", "CHC", "Budhni", 22.783, 77.683, "S. Chouhan", 90000],
  ["chc-shyampur", "CHC Shyampur", "CHC", "Shyampur", 23.36, 77.11, "D. Meena", 80000],
  ["saraswati", "Saraswati PHC", "PHC", "Sehore", 23.262, 76.968, "R. Mishra", 31000],
  ["kalyanpur", "Kalyanpur PHC", "PHC", "Sehore", 23.14, 76.93, "S. Verma", 28000],
  ["devgarh", "Devgarh PHC", "PHC", "Sehore", 23.3, 77.18, "L. Patel", 26000],
  ["rampur", "Rampur PHC", "PHC", "Ichhawar", 23.11, 77.06, "K. Yadav", 25000],
  ["hirapur", "Hirapur PHC", "PHC", "Ichhawar", 22.93, 77.08, "G. Sharma", 27000],
  ["gopalpura", "Gopalpura PHC", "PHC", "Ichhawar", 22.96, 76.93, "B. Ahirwar", 23000],
  ["anandpur", "Anandpur PHC", "PHC", "Ashta", 23.09, 76.8, "H. Parmar", 32000],
  ["chandanpura", "Chandanpura PHC", "PHC", "Ashta", 22.94, 76.64, "J. Dangi", 29000],
  ["lakshmipura", "Lakshmipura PHC", "PHC", "Ashta", 23.12, 76.64, "U. Kushwaha", 24000],
  ["madhavgarh", "Madhavgarh PHC", "PHC", "Nasrullaganj", 22.76, 77.15, "F. Qureshi", 26000],
  ["kamalpur", "Kamalpur PHC", "PHC", "Nasrullaganj", 22.62, 77.35, "T. Lodhi", 22000],
  ["tulsipur", "Tulsipur PHC", "PHC", "Nasrullaganj", 22.7, 77.05, "C. Kirar", 25000],
  ["sundarpur", "Sundarpur PHC", "PHC", "Budhni", 22.85, 77.56, "I. Bhilala", 24000],
  ["narayanpur", "Narayanpur PHC", "PHC", "Budhni", 22.7, 77.6, "O. Gond", 21000],
  ["bhimpura", "Bhimpura PHC", "PHC", "Shyampur", 23.38, 77.0, "Y. Pawar", 23000],
  ["kesarpura", "Kesarpura PHC", "PHC", "Shyampur", 23.32, 77.25, "E. Jatav", 27000],
];

export const FACILITIES: Facility[] = FACILITY_SEEDS.map(([id, name, type, block, lat, lng, pharmacist, population], i) => ({
  id, name, type, block, lat, lng,
  pharmacist: { name: pharmacist, phone: `+91 90000 ${String(10001 + i).padStart(5, "0")}`, language: type === "WAREHOUSE" ? "en" : "hi" },
  catchmentPopulation: population,
}));

// Base units/day at a 30k-catchment PHC.
const BASE_DAILY: Record<string, number> = {
  "metformin-500": 6, "glimepiride-2": 3, "amlodipine-5": 5, "telmisartan-40": 3.5, "atenolol-50": 3,
  "ifa-tablets": 9, "amoxicillin-500": 5, "paracetamol-500": 10, "ors-sachet": 14, "salbutamol-inhaler": 0.6,
};
const MONSOON_AMPLITUDE: Record<string, number> = { "ors-sachet": 1.0, "paracetamol-500": 0.55, "amoxicillin-500": 0.35 };
const TYPE_FACTOR: Record<FacilityType, number> = { WAREHOUSE: 0, DH: 4, CHC: 2, PHC: 1 };

/** Monday (IST) of each history week, oldest first; last entry is the current week. */
export function historyWeeks(now: string = SEED_NOW, weeks = HISTORY_WEEKS): string[] {
  const ist = new Date(new Date(now).getTime() + 5.5 * HOUR);
  const dow = (ist.getUTCDay() + 6) % 7;
  const monday = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - dow * DAY;
  return Array.from({ length: weeks }, (_, i) => new Date(monday - (weeks - 1 - i) * 7 * DAY).toISOString().slice(0, 10));
}

const monsoon = (medicineId: string, weekIndex: number) => 1 + (MONSOON_AMPLITUDE[medicineId] ?? 0) * Math.exp(-((weekIndex - 5) ** 2) / (2 * 2.5 ** 2));

type RecordSpec = {
  days?: number; // target days of stock (ignored when stock is set)
  stock?: number;
  dailyUse?: number; // pinned exact daily use
  deliveries?: Record<number, number>; // weeksAgo -> qty (0 = current week); replaces the default schedule
  nearExpiry?: StockRecord["nearExpiry"];
  verified?: boolean;
  overrideLastClosing?: number; // suspicious count: ledger-inconsistent report
};

/** Builds a ledger-consistent weekly history ending at `stock`, then derives dailyUse from the last 4 weeks. */
function buildRecord(facility: Facility, medicine: Medicine, spec: RecordSpec, rand: () => number, weeks: string[], reportAt: string, source: StockRecord["reportSource"]): StockRecord {
  const n = weeks.length;
  const factor = facility.type === "PHC" ? facility.catchmentPopulation / 30000 : TYPE_FACTOR[facility.type];
  const base = spec.dailyUse ?? BASE_DAILY[medicine.id] * factor * (0.85 + rand() * 0.3);
  const weekly = (i: number) => 7 * base * (spec.dailyUse ? 1 : monsoon(medicine.id, i)) * (0.88 + rand() * 0.24);
  const dispensed = weeks.map((_, i) => Math.max(0, Math.round(weekly(i))));
  if (spec.dailyUse) {
    const target = Math.round(28 * spec.dailyUse);
    dispensed[n - 1] = target - dispensed[n - 4] - dispensed[n - 3] - dispensed[n - 2];
  }
  const dailyUse = spec.dailyUse ?? round1((dispensed[n - 1] + dispensed[n - 2] + dispensed[n - 3] + dispensed[n - 4]) / 28);
  const stock = spec.stock ?? Math.max(0, Math.round((spec.days ?? 12) * dailyUse));
  const weeklyUse = dailyUse * 7;
  const phase = Math.floor(rand() * 4);
  const planned = (weeksAgo: number) => spec.deliveries ? spec.deliveries[weeksAgo] ?? 0 : weeksAgo >= 2 && (weeksAgo + phase) % 4 === 0 ? Math.round(weeklyUse * 4) : 0;
  const closing = new Array<number>(n).fill(0);
  const received = new Array<number>(n).fill(0);
  closing[n - 1] = stock;
  for (let t = n - 1; t >= 1; t--) {
    if (stock === 0 && t === n - 1) dispensed[t] = Math.min(dispensed[t], Math.round(weeklyUse * 0.6));
    const floor = Math.round(weeklyUse * 0.4);
    received[t] = Math.max(0, Math.min(planned(n - 1 - t), closing[t] + dispensed[t] - floor));
    closing[t - 1] = closing[t] + dispensed[t] - received[t];
  }
  received[0] = planned(n - 1) ? Math.round(weeklyUse * 4) : 0;
  const history: WeeklyPoint[] = weeks.map((weekOf, i) => ({ weekOf, closingStock: closing[i], dispensed: dispensed[i], received: received[i] }));
  let finalStock = stock;
  if (spec.overrideLastClosing !== undefined) {
    finalStock = spec.overrideLastClosing;
    history[n - 1] = { ...history[n - 1], closingStock: finalStock };
  }
  return {
    facilityId: facility.id, medicineId: medicine.id, stock: finalStock, dailyUse, nearExpiry: spec.nearExpiry ?? null,
    lastReportAt: reportAt, reportSource: source, verified: spec.verified ?? true, history, recountRequested: null,
  };
}

/** Engineered story overrides: facilityId -> medicineId -> spec. */
const STORY: Record<string, Record<string, RecordSpec>> = {
  // Hero: Saraswati critical, Kalyanpur safe surplus 45, Rampur critical. Numbers fixed by README/docs.
  saraswati: { "metformin-500": { stock: 16, dailyUse: 8, deliveries: { 4: 230, 8: 220 } } },
  kalyanpur: { "metformin-500": { stock: 80, dailyUse: 5, deliveries: { 1: 90, 5: 140, 9: 140 } } },
  rampur: { "metformin-500": { stock: 9, dailyUse: 6, deliveries: { 4: 170, 8: 170 } } },
  // Near-expiry surplus: Anandpur holds amoxicillin it cannot use before expiry; preferred over nearer CHC Ashta.
  anandpur: { "amoxicillin-500": { days: 44, deliveries: { 3: 220, 8: 120 }, nearExpiry: { quantity: 150, expiresOn: "2026-10-28" } } },
  lakshmipura: { "amoxicillin-500": { days: 3.2, deliveries: { 4: 130, 8: 140 } } },
  // Suspicious count: Hirapur reports 168 strips telmisartan; ledger expects ~30.
  hirapur: { "telmisartan-40": { days: 9.5, deliveries: { 3: 100, 7: 100 }, overrideLastClosing: 168, verified: false } },
  gopalpura: { "telmisartan-40": { days: 4.2, deliveries: { 4: 80, 8: 80 } } },
  // Indent: Kesarpura low on IFA; nobody has IFA surplus but the warehouse does.
  kesarpura: { "ifa-tablets": { days: 5.5, deliveries: { 3: 220, 7: 240 } }, "amlodipine-5": { days: 0.6 } },
  // Already stocked out: Tulsipur salbutamol; CHC Nasrullaganj can spare.
  tulsipur: { "salbutamol-inhaler": { stock: 0, deliveries: { 6: 10, 10: 10 } } },
  // ORS critical at Madhavgarh with an in-transit transfer from CHC Nasrullaganj.
  madhavgarh: { "ors-sachet": { days: 1.6, deliveries: { 4: 400, 8: 450 } } },
  // Smaller cases that keep the map lively.
  devgarh: { "atenolol-50": { days: 4 } },
  kamalpur: { "atenolol-50": { days: 6 } },
  narayanpur: { "glimepiride-2": { days: 6.5 } },
  bhimpura: { "paracetamol-500": { days: 5.5 } },
  // Surplus hubs.
  "chc-ashta": { "paracetamol-500": { days: 38 }, "ors-sachet": { days: 34 }, "amoxicillin-500": { days: 30 }, "metformin-500": { days: 11 } },
  "chc-nasrullaganj": { "ors-sachet": { days: 36 }, "salbutamol-inhaler": { days: 42 } },
  "chc-budhni": { "glimepiride-2": { days: 40 }, "salbutamol-inhaler": { days: 45 } },
  "dh-sehore": { "atenolol-50": { days: 30 }, "metformin-500": { days: 12 } },
};

// District-wide amlodipine shortage: ~12 days district cover vs 11-day threshold, nobody above the surplus line (no donor), warehouse empty, upstream delayed.
const AMLODIPINE_DAYS = [12.6, 14.4, 4.1, 15.8, 13.6, 2.8, 13.9, 6.3, 16.2, 12.8, 3.4, 14.7, 15.1, 1.9, 12.6, 15.1, 11.7, 13.9, 16.2, 12.8, 14.5, 0.6];

const WAREHOUSE_DAYS: Record<string, number> = {
  "metformin-500": 9, "glimepiride-2": 40, "amlodipine-5": 0, "telmisartan-40": 30, "atenolol-50": 25,
  "ifa-tablets": 60, "amoxicillin-500": 35, "paracetamol-500": 50, "ors-sachet": 22, "salbutamol-inhaler": 28,
};

/** Hours before SEED_NOW of each facility's latest report. Bhimpura and Narayanpur have not reported this week. */
const REPORT_HOURS_AGO: Record<string, number> = {
  saraswati: 0, kalyanpur: 0.4, rampur: 0.77, hirapur: 1.18, madhavgarh: 2.2, anandpur: 20.5, lakshmipura: 21.3, gopalpura: 23.9,
  devgarh: 26.4, tulsipur: 44.1, kesarpura: 46.8, kamalpur: 50.2, chandanpura: 69.4, sundarpur: 72.6, bhimpura: 221, narayanpur: 268,
  "warehouse-sehore": 3, "dh-sehore": 18, "chc-ashta": 27, "chc-ichhawar": 30, "chc-nasrullaganj": 41, "chc-budhni": 52, "chc-shyampur": 75,
};

export function buildStock(rand: () => number, now: string = SEED_NOW, overrides: Record<string, Record<string, RecordSpec>> = STORY): StockRecord[] {
  const weeks = historyWeeks(now);
  const nowMs = new Date(now).getTime();
  const records: StockRecord[] = [];
  const sitesExWarehouse = FACILITIES.filter((f) => f.type !== "WAREHOUSE");
  for (const medicine of MEDICINES) {
    sitesExWarehouse.forEach((facility, i) => {
      const thr = medicine.leadTimeDays + medicine.safetyBufferDays;
      const spec: RecordSpec = overrides[facility.id]?.[medicine.id]
        ?? (medicine.id === "amlodipine-5" ? { days: AMLODIPINE_DAYS[i % AMLODIPINE_DAYS.length] } : { days: thr + 2.5 + rand() * 4 });
      const reportAt = iso(nowMs - (REPORT_HOURS_AGO[facility.id] ?? 30) * HOUR);
      records.push(buildRecord(facility, medicine, spec, rand, weeks, reportAt, facility.type === "PHC" ? "voice" : "manual"));
    });
    const warehouse = FACILITIES.find((f) => f.type === "WAREHOUSE")!;
    const districtUse = round1(records.filter((r) => r.medicineId === medicine.id).reduce((s, r) => s + r.dailyUse, 0));
    const wh = buildRecord(warehouse, medicine, { dailyUse: districtUse, stock: Math.round(WAREHOUSE_DAYS[medicine.id] * districtUse), deliveries: medicine.id === "amlodipine-5" ? { 7: Math.round(districtUse * 21) } : { 2: Math.round(districtUse * 30), 6: Math.round(districtUse * 30), 10: Math.round(districtUse * 30) } }, rand, weeks, iso(nowMs - 3 * HOUR), "system");
    records.push(wh);
  }
  return records;
}

const at = (hoursAgo: number) => iso(new Date(SEED_NOW).getTime() - hoursAgo * HOUR);

function seedTransfers(): Transfer[] {
  return [
    { id: "tr-seed-01", medicineId: "glimepiride-2", fromId: "chc-budhni", toId: "sundarpur", quantity: 40, status: "delivered", distanceKm: 13.8, etaHours: 2.6, createdAt: at(124), updatedAt: at(117), approvedAt: at(122), dispatchedAt: at(119.6), deliveredAt: at(117), reason: "Sundarpur below threshold; Budhni holds 40+ days." },
    { id: "tr-seed-02", medicineId: "paracetamol-500", fromId: "chc-ashta", toId: "chandanpura", quantity: 150, status: "delivered", distanceKm: 10.9, etaHours: 2.5, createdAt: at(56), updatedAt: at(49), approvedAt: at(54), dispatchedAt: at(51.5), deliveredAt: at(49), reason: "Monsoon fever demand; Ashta surplus hub." },
    { id: "tr-seed-03", medicineId: "ors-sachet", fromId: "chc-nasrullaganj", toId: "madhavgarh", quantity: 300, status: "in_transit", distanceKm: 14.8, etaHours: 2.6, createdAt: at(4.5), updatedAt: at(1.2), approvedAt: at(3.4), dispatchedAt: at(1.2), reason: "Madhavgarh under 2 days of ORS." },
    { id: "tr-seed-04", medicineId: "atenolol-50", fromId: "dh-sehore", toId: "devgarh", quantity: 60, status: "approved", distanceKm: 14.5, etaHours: 2.6, createdAt: at(1.9), updatedAt: at(1.6), approvedAt: at(1.6), decisionId: "dec-seed-01", reason: "Devgarh 4 days of atenolol; DH holds 30 days." },
    { id: "tr-seed-05", medicineId: "salbutamol-inhaler", fromId: "chc-nasrullaganj", toId: "tulsipur", quantity: 6, status: "proposed", distanceKm: 23.4, etaHours: 3.0, createdAt: at(0.3), updatedAt: at(0.3), reason: "Tulsipur stocked out of salbutamol inhalers." },
  ];
}

function seedDecisions(): DecisionRecord[] {
  return [
    {
      id: "dec-seed-01", facilityId: "devgarh", medicineId: "atenolol-50", action: "transfer_surplus", confidence: 0.79,
      probabilities: { verify_count: 0.06, transfer_surplus: 0.79, draft_indent: 0.12, escalate_supply_gap: 0.03 },
      source: "live", urgency: 0.64, rationale: "Seeded synthetic history: DH Sehore holds 30 days of atenolol 14.5 km away; Devgarh has 4 days against a 10-day threshold.",
      snapshot: { note: "seeded synthetic decision" }, status: "approved", createdAt: at(1.9), decidedAt: at(1.6), transferId: "tr-seed-04",
    },
    {
      id: "dec-seed-02", facilityId: "chandanpura", medicineId: "ifa-tablets", action: "draft_indent", confidence: 0.71,
      probabilities: { verify_count: 0.08, transfer_surplus: 0.11, draft_indent: 0.71, escalate_supply_gap: 0.1 },
      source: "demo_fallback", fallbackReason: "upstream_unavailable", urgency: 0.42, rationale: "Seeded synthetic history: no IFA surplus nearby; warehouse holds 60 days.",
      snapshot: { note: "seeded synthetic decision" }, status: "acknowledged", createdAt: at(98), decidedAt: at(96.5),
    },
  ];
}

function seedTimeline(): TimelineEvent[] {
  const DHO = "Dr. Ananya Rao (DHO)";
  const events: TimelineEvent[] = [
    { id: "ev-seed-22", at: at(0), kind: "voice_report", facilityId: "saraswati", medicineId: "metformin-500", title: "Saraswati PHC reported 16 strips of Metformin 500", detail: "\"Metformin ki solah strip bachi hain.\" Count matches last week's ledger.", actor: "R. Mishra (pharmacist)" },
    { id: "ev-seed-21", at: at(0.3), kind: "transfer_update", facilityId: "tulsipur", medicineId: "salbutamol-inhaler", title: "Transfer proposed: 6 salbutamol inhalers CHC Nasrullaganj → Tulsipur PHC", detail: "Planner proposal; awaiting officer review.", actor: "Stock planner" },
    { id: "ev-seed-20", at: at(0.4), kind: "voice_report", facilityId: "kalyanpur", medicineId: "metformin-500", title: "Kalyanpur PHC reported 80 strips of Metformin 500", detail: "45 strips transferable after a 7-day reserve.", actor: "S. Verma (pharmacist)" },
    { id: "ev-seed-19", at: at(0.77), kind: "voice_report", facilityId: "rampur", medicineId: "metformin-500", title: "Rampur PHC reported 9 strips of Metformin 500", detail: "1.5 days of stock; below the 8-day threshold.", actor: "K. Yadav (pharmacist)" },
    { id: "ev-seed-18", at: at(1.18), kind: "alert", facilityId: "hirapur", medicineId: "telmisartan-40", title: "Hirapur PHC telmisartan count inconsistent with history", detail: "Reported 168 strips; ledger expects about 30 (45 last week, no delivery since).", actor: "Count check" },
    { id: "ev-seed-17", at: at(1.2), kind: "transfer_update", facilityId: "madhavgarh", medicineId: "ors-sachet", title: "In transit: 300 ORS sachets CHC Nasrullaganj → Madhavgarh PHC", detail: "Vehicle dispatched; ETA 2.6 h.", actor: "CHC Nasrullaganj store" },
    { id: "ev-seed-16", at: at(1.6), kind: "approval", facilityId: "devgarh", medicineId: "atenolol-50", title: "Approved: 60 strips atenolol DH Sehore → Devgarh PHC", actor: DHO },
    { id: "ev-seed-15", at: at(1.9), kind: "decision", facilityId: "devgarh", medicineId: "atenolol-50", title: "Decisions API: transfer_surplus (0.79)", detail: "DH Sehore holds 30 days of atenolol 14.5 km away.", actor: "Decisions API" },
    { id: "ev-seed-14", at: at(2.2), kind: "voice_report", facilityId: "madhavgarh", medicineId: "ors-sachet", title: "Madhavgarh PHC reported ORS under 2 days", actor: "F. Qureshi (pharmacist)" },
    { id: "ev-seed-13", at: at(3.4), kind: "approval", facilityId: "madhavgarh", medicineId: "ors-sachet", title: "Approved: 300 ORS sachets CHC Nasrullaganj → Madhavgarh PHC", actor: DHO },
    { id: "ev-seed-12", at: at(20.5), kind: "voice_report", facilityId: "anandpur", medicineId: "amoxicillin-500", title: "Anandpur PHC reported amoxicillin with 150 strips expiring 28 Oct", detail: "At current use, part of the near-expiry stock will expire on the shelf unless it moves.", actor: "H. Parmar (pharmacist)" },
    { id: "ev-seed-11", at: at(21.3), kind: "voice_report", facilityId: "lakshmipura", medicineId: "amoxicillin-500", title: "Lakshmipura PHC reported amoxicillin at about 3 days", actor: "U. Kushwaha (pharmacist)" },
    { id: "ev-seed-10", at: at(24), kind: "alert", medicineId: "amlodipine-5", title: "District amlodipine coverage below lead time", detail: "Warehouse empty; state consignment delayed with no confirmed date. No facility holds transferable surplus.", actor: "Stock planner" },
    { id: "ev-seed-09", at: at(44.1), kind: "alert", facilityId: "tulsipur", medicineId: "salbutamol-inhaler", title: "Stockout: Tulsipur PHC has no salbutamol inhalers", actor: "C. Kirar (pharmacist)" },
    { id: "ev-seed-08", at: at(46.8), kind: "voice_report", facilityId: "kesarpura", medicineId: "ifa-tablets", title: "Kesarpura PHC reported IFA at 5.5 days", actor: "E. Jatav (pharmacist)" },
    { id: "ev-seed-07", at: at(49), kind: "transfer_update", facilityId: "chandanpura", medicineId: "paracetamol-500", title: "Delivered: 150 strips paracetamol CHC Ashta → Chandanpura PHC", actor: "J. Dangi (pharmacist)" },
    { id: "ev-seed-06", at: at(54), kind: "approval", facilityId: "chandanpura", medicineId: "paracetamol-500", title: "Approved: 150 strips paracetamol CHC Ashta → Chandanpura PHC", actor: DHO },
    { id: "ev-seed-05", at: at(96.5), kind: "indent", facilityId: "chandanpura", medicineId: "ifa-tablets", title: "Indent drafted: IFA for Chandanpura PHC", detail: "Consumption-based indent sent to district warehouse.", actor: DHO },
    { id: "ev-seed-04", at: at(98), kind: "decision", facilityId: "chandanpura", medicineId: "ifa-tablets", title: "Decision (demo fallback): draft_indent (0.71)", actor: "Decisions API" },
    { id: "ev-seed-03", at: at(117), kind: "transfer_update", facilityId: "sundarpur", medicineId: "glimepiride-2", title: "Delivered: 40 strips glimepiride CHC Budhni → Sundarpur PHC", actor: "I. Bhilala (pharmacist)" },
    { id: "ev-seed-02", at: at(120), kind: "count_verified", facilityId: "kalyanpur", medicineId: "metformin-500", title: "Kalyanpur PHC recount verified", detail: "Second count matched first within 2 strips.", actor: "S. Verma (pharmacist)" },
    { id: "ev-seed-01", at: at(129.7), kind: "briefing", title: "Weekly district briefing generated", detail: "Voice check-ins scheduled for 16 PHCs across 5 blocks.", actor: "Dawai Dost" },
  ];
  return events;
}

export function createInitialState(): DistrictState {
  return {
    district: DISTRICT,
    medicines: MEDICINES,
    facilities: FACILITIES,
    stock: buildStock(mulberry32(20261010)),
    transfers: seedTransfers(),
    decisions: seedDecisions(),
    timeline: seedTimeline(),
    selectedFacilityId: "saraswati",
    selectedMedicineId: "metformin-500",
    now: SEED_NOW,
  };
}

export type { RecordSpec };
