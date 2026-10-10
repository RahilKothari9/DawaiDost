// OWNER: evals agent. Labeled, synthetic decision cases for evaluating the Decisions API.
// Every case is a facts-only snapshot in the exact shape the product sends (lib/ai/facts.ts DecisionFacts),
// with an expected action justified by EVAL_POLICY. All facilities and numbers are fictional.
import type { DecisionAction } from "../district/types";
import type { DecisionFacts, FactsDonor } from "../ai/facts";

export const EVAL_AS_OF = "2026-10-10T09:42:00+05:30";
const FACTS_KIND = "dawai-dost/decision-snapshot@2" as const;
const DECISION_POLICY =
  "Recommend one next action for the target facility. Donors must keep their own reserve. A district officer approves every recount, transfer, indent, or escalation.";

/**
 * The operating policy the labels follow. Rules are applied in order; the first that fires sets the label.
 * Written from district practice (verify before moving stock, local transfer before ordering, escalate only
 * when the district itself cannot supply). The model never sees this text: it is the answer key.
 */
export const EVAL_POLICY = `Labeling policy (applied in order):
P1 Data first. If the target's count is unverified, flagged (reportFlag), stale (>10 days), already under recount,
   or contradicts its own dispensing trend (recorded daily use far from the weekly trend), the next step is
   verify_count. Moving or ordering stock on a bad count wastes scarce stock.
P2 Transfer. If a verified donor's transferable surplus (already net of its 7-day reserve and open outbound
   transfers) covers the target's gap (coversGapPct >= 100), choose transfer_surplus. Near-expiry donor stock
   is preferred because it would otherwise be wasted.
P3 Unverified donors do not count as surplus.
P4 Escalate. If verified local surplus cannot cover the gap and upstream supply is delayed or unavailable, or the
   district store holds less than one lead time of district demand, choose escalate_supply_gap.
P5 Indent. If verified local surplus cannot cover the gap and upstream supply is normal, choose draft_indent.
Ambiguous. Cases where two rules reasonably compete (partial cover 60-99%, combined cover from two donors,
   a full transfer while upstream is indefinitely delayed, an unverified zero count with patients waiting,
   zero recorded use) are tagged ambiguous with the acceptable alternatives listed.`;

export const EVAL_POLICY_VERSION = "2026-10-10.1";

export type EvalCategory =
  | "clear_transfer"
  | "reserve_blocked"
  | "small_surplus"
  | "suspicious_count"
  | "district_shortage"
  | "near_expiry"
  | "zero_consumption"
  | "unverified_donor"
  | "partial_cover";

export const CATEGORY_LABELS: Record<EvalCategory, string> = {
  clear_transfer: "Clear transfer",
  reserve_blocked: "Blocked by donor reserve",
  small_surplus: "Surplus too small",
  suspicious_count: "Suspicious count",
  district_shortage: "District-wide shortage",
  near_expiry: "Near-expiry donor",
  zero_consumption: "Zero consumption",
  unverified_donor: "Unverified donor",
  partial_cover: "Partial cover",
};

export type EvalCase = {
  id: string;
  title: string;
  category: EvalCategory;
  expected: DecisionAction;
  /** Other actions a reasonable officer would accept. Non-empty only for ambiguous cases. */
  acceptable: DecisionAction[];
  ambiguous: boolean;
  /** Policy rule(s) that set the label, e.g. "P2". */
  rule: string;
  reason: string;
  snapshot: DecisionFacts;
};

// ---------- builder ----------

type MedKey = keyof typeof MEDS;
const MEDS = {
  metformin: { id: "metformin-500", name: "Metformin", strength: "500 mg", unit: "strip of 10 tablets", leadTimeDays: 5, safetyBufferDays: 3, reserveDays: 7 },
  glimepiride: { id: "glimepiride-2", name: "Glimepiride", strength: "2 mg", unit: "strip of 10 tablets", leadTimeDays: 7, safetyBufferDays: 3, reserveDays: 7 },
  amlodipine: { id: "amlodipine-5", name: "Amlodipine", strength: "5 mg", unit: "strip of 10 tablets", leadTimeDays: 10, safetyBufferDays: 4, reserveDays: 7 },
  telmisartan: { id: "telmisartan-40", name: "Telmisartan", strength: "40 mg", unit: "strip of 10 tablets", leadTimeDays: 7, safetyBufferDays: 3, reserveDays: 7 },
  atenolol: { id: "atenolol-50", name: "Atenolol", strength: "50 mg", unit: "strip of 14 tablets", leadTimeDays: 7, safetyBufferDays: 3, reserveDays: 7 },
  ifa: { id: "ifa-tablets", name: "IFA", strength: "60 mg Fe + 500 mcg FA", unit: "strip of 10 tablets", leadTimeDays: 6, safetyBufferDays: 4, reserveDays: 7 },
  amoxicillin: { id: "amoxicillin-500", name: "Amoxicillin", strength: "500 mg", unit: "strip of 10 capsules", leadTimeDays: 5, safetyBufferDays: 3, reserveDays: 7 },
  paracetamol: { id: "paracetamol-500", name: "Paracetamol", strength: "500 mg", unit: "strip of 10 tablets", leadTimeDays: 4, safetyBufferDays: 3, reserveDays: 7 },
  ors: { id: "ors-sachet", name: "ORS", strength: "20.5 g WHO-ORS", unit: "sachet", leadTimeDays: 4, safetyBufferDays: 3, reserveDays: 7 },
  salbutamol: { id: "salbutamol-inhaler", name: "Salbutamol", strength: "100 mcg, 200 doses", unit: "inhaler", leadTimeDays: 10, safetyBufferDays: 5, reserveDays: 7 },
} as const;

const UPSTREAM = {
  normal: { status: "available", note: "Rate-contract supply normal.", expectedOn: "2026-10-16" },
  delayed: { status: "delayed", note: "State rate-contract supplier missed the September consignment; no revised dispatch date is confirmed.", expectedOn: null },
  delayed3w: { status: "delayed", note: "State consignment delayed by about 3 weeks.", expectedOn: "2026-10-31" },
  unavailable: { status: "unavailable", note: "Supplier contract lapsed; no state supply line for this item.", expectedOn: null },
} as const;

type FacilityRef = { id: string; name: string; type: "DH" | "CHC" | "PHC"; block: string };
const F: Record<string, FacilityRef> = {
  saraswati: { id: "saraswati", name: "Saraswati PHC", type: "PHC", block: "Sehore" },
  kalyanpur: { id: "kalyanpur", name: "Kalyanpur PHC", type: "PHC", block: "Sehore" },
  devgarh: { id: "devgarh", name: "Devgarh PHC", type: "PHC", block: "Sehore" },
  rampur: { id: "rampur", name: "Rampur PHC", type: "PHC", block: "Ichhawar" },
  hirapur: { id: "hirapur", name: "Hirapur PHC", type: "PHC", block: "Ichhawar" },
  gopalpura: { id: "gopalpura", name: "Gopalpura PHC", type: "PHC", block: "Ichhawar" },
  anandpur: { id: "anandpur", name: "Anandpur PHC", type: "PHC", block: "Ashta" },
  chandanpura: { id: "chandanpura", name: "Chandanpura PHC", type: "PHC", block: "Ashta" },
  lakshmipura: { id: "lakshmipura", name: "Lakshmipura PHC", type: "PHC", block: "Ashta" },
  madhavgarh: { id: "madhavgarh", name: "Madhavgarh PHC", type: "PHC", block: "Nasrullaganj" },
  kamalpur: { id: "kamalpur", name: "Kamalpur PHC", type: "PHC", block: "Nasrullaganj" },
  tulsipur: { id: "tulsipur", name: "Tulsipur PHC", type: "PHC", block: "Nasrullaganj" },
  sundarpur: { id: "sundarpur", name: "Sundarpur PHC", type: "PHC", block: "Budhni" },
  narayanpur: { id: "narayanpur", name: "Narayanpur PHC", type: "PHC", block: "Budhni" },
  bhimpura: { id: "bhimpura", name: "Bhimpura PHC", type: "PHC", block: "Shyampur" },
  kesarpura: { id: "kesarpura", name: "Kesarpura PHC", type: "PHC", block: "Shyampur" },
  dh: { id: "dh-sehore", name: "District Hospital Sehore", type: "DH", block: "Sehore" },
  ashta: { id: "chc-ashta", name: "CHC Ashta", type: "CHC", block: "Ashta" },
  ichhawar: { id: "chc-ichhawar", name: "CHC Ichhawar", type: "CHC", block: "Ichhawar" },
  nasrullaganj: { id: "chc-nasrullaganj", name: "CHC Nasrullaganj", type: "CHC", block: "Nasrullaganj" },
  budhni: { id: "chc-budhni", name: "CHC Budhni", type: "CHC", block: "Budhni" },
  shyampur: { id: "chc-shyampur", name: "CHC Shyampur", type: "CHC", block: "Shyampur" },
};

type DonorSpec = { at: keyof typeof F; km: number; stock: number; use: number; verified?: boolean; nearExpiry?: number; outbound?: number };
type TargetSpec = {
  at: keyof typeof F;
  stock: number;
  use: number;
  verified?: boolean;
  source?: "voice" | "manual" | "system";
  ageHours?: number;
  recount?: string;
  flag?: string;
  inbound?: number;
  nearExpiry?: number;
  trend?: number[];
};
type Spec = {
  id: string;
  title: string;
  category: EvalCategory;
  expected: DecisionAction;
  acceptable?: DecisionAction[];
  rule: string;
  reason: string;
  med: MedKey;
  target: TargetSpec;
  donors?: DonorSpec[];
  upstream?: keyof typeof UPSTREAM;
  /** District warehouse: days of district demand it holds (null = no store record). */
  storeDays?: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const daysOf = (stock: number, use: number) => (use > 0 ? round1(stock / use) : null);

export function buildCaseSnapshot(spec: Spec): DecisionFacts {
  const med = MEDS[spec.med];
  const t = spec.target;
  const fac = F[t.at];
  const threshold = med.leadTimeDays + med.safetyBufferDays;
  const exactDays = t.use > 0 ? t.stock / t.use : Infinity;
  const risk = t.stock <= 0 ? "stockout" : exactDays < med.leadTimeDays ? "critical" : exactDays < threshold ? "low" : exactDays > threshold * 2 ? "surplus" : "ok";
  const gap = Math.max(0, Math.ceil(threshold * t.use - t.stock));
  const ageHours = t.ageHours ?? 3;
  const flag = t.flag ?? (t.recount ? `recount already requested: ${t.recount}` : t.verified === false ? "latest count not verified" : ageHours > 240 ? "report is more than 10 days old" : null);
  const projected = Number.isFinite(exactDays) ? new Date(new Date(EVAL_AS_OF).getTime() + exactDays * 864e5).toISOString().slice(0, 10) : null;
  const trend = t.trend ?? Array.from({ length: 6 }, (_, i) => Math.round(t.use * 7 * (1 + ((i % 3) - 1) * 0.04)));

  const donors: FactsDonor[] = (spec.donors ?? [])
    .map((d) => {
      const df = F[d.at];
      const transferable = Math.max(0, Math.floor(d.stock - d.use * med.reserveDays) - (d.outbound ?? 0));
      return {
        facilityId: df.id,
        name: df.name,
        type: df.type,
        block: df.block,
        distanceKm: d.km,
        stock: d.stock,
        dailyUse: d.use,
        daysOfStock: daysOf(d.stock, d.use),
        transferable,
        coversGapPct: gap > 0 ? Math.min(100, Math.round((transferable / gap) * 100)) : 100,
        verified: d.verified ?? true,
        nearExpiryUnits: d.nearExpiry ?? 0,
      };
    })
    // Same filter and ordering as lib/ai/facts.ts rankDonors.
    .filter((d) => d.transferable > 0)
    .sort((a, b) => Number(b.verified) - Number(a.verified) || b.coversGapPct / (a.distanceKm + 5) - a.coversGapPct / (b.distanceKm + 5) || a.distanceKm - b.distanceKm)
    .slice(0, 5);

  const up = UPSTREAM[spec.upstream ?? "normal"];
  const storeDays = spec.storeDays === undefined ? (up.status === "available" ? 18 : 0) : spec.storeDays;
  const districtDemand = 260;

  return {
    kind: FACTS_KIND,
    asOf: EVAL_AS_OF,
    district: "Sehore, Madhya Pradesh",
    medicine: { ...med },
    target: {
      facilityId: fac.id,
      name: fac.name,
      type: fac.type,
      block: fac.block,
      stock: t.stock,
      dailyUse: t.use,
      daysOfStock: daysOf(t.stock, t.use),
      thresholdDays: threshold,
      risk,
      gapUnits: gap,
      projectedStockoutDate: projected,
      reportSource: t.source ?? "manual",
      reportAgeHours: ageHours,
      verified: t.verified ?? !t.recount,
      recountRequested: !!t.recount,
      reportFlag: flag,
      inboundUnits: t.inbound ?? 0,
      nearExpiryUnits: t.nearExpiry ?? 0,
      weeklyDispensedTrend: trend,
    },
    donors,
    donorTotals: {
      eligible: donors.filter((d) => d.verified).length,
      totalTransferable: donors.reduce((s, d) => s + d.transferable, 0),
      bestSingleCoverPct: donors.reduce((m, d) => Math.max(m, d.coversGapPct), 0),
    },
    upstream: { ...up },
    districtStore: storeDays === null ? null : { facilityId: "warehouse-sehore", name: "District Drug Warehouse", stock: Math.round(storeDays * districtDemand), daysOfDistrictDemand: storeDays },
    policy: DECISION_POLICY,
  };
}

// ---------- the labeled set ----------

const SPECS: Spec[] = [
  // Clear transfers: a verified donor alone covers the whole gap after its reserve.
  { id: "T01", title: "Metformin at Saraswati, Kalyanpur has surplus", category: "clear_transfer", expected: "transfer_surplus", rule: "P2", reason: "Kalyanpur can send 75 strips after its reserve; the gap is 48.", med: "metformin", target: { at: "saraswati", stock: 16, use: 8 }, donors: [{ at: "kalyanpur", km: 12.4, stock: 110, use: 5 }, { at: "rampur", km: 15.8, stock: 9, use: 6 }] },
  { id: "T02", title: "Amoxicillin at Hirapur, CHC Ichhawar nearby", category: "clear_transfer", expected: "transfer_surplus", rule: "P2", reason: "CHC Ichhawar holds 76 transferable capsule strips against a gap of 36.", med: "amoxicillin", target: { at: "hirapur", stock: 12, use: 6 }, donors: [{ at: "ichhawar", km: 9.6, stock: 160, use: 12 }] },
  { id: "T03", title: "Paracetamol at Gopalpura, two strong donors", category: "clear_transfer", expected: "transfer_surplus", rule: "P2", reason: "Both donors individually cover the 50-strip gap; transfer from the nearest.", med: "paracetamol", target: { at: "gopalpura", stock: 20, use: 10 }, donors: [{ at: "dh", km: 31.5, stock: 400, use: 30 }, { at: "rampur", km: 15.9, stock: 110, use: 6 }] },
  { id: "T04", title: "Glimepiride at Devgarh", category: "clear_transfer", expected: "transfer_surplus", rule: "P2", reason: "Kesarpura has 69 strips after reserve; the gap is 32.", med: "glimepiride", target: { at: "devgarh", stock: 8, use: 4 }, donors: [{ at: "kesarpura", km: 8.9, stock: 90, use: 3 }] },
  { id: "T05", title: "IFA at Chandanpura, CHC Ashta well stocked", category: "clear_transfer", expected: "transfer_surplus", rule: "P2", reason: "CHC Ashta can release 160 strips; the gap is 60.", med: "ifa", target: { at: "chandanpura", stock: 30, use: 9 }, donors: [{ at: "ashta", km: 13.7, stock: 300, use: 20 }] },
  { id: "T06", title: "ORS stockout at Kamalpur, confirmed zero", category: "clear_transfer", expected: "transfer_surplus", rule: "P2", reason: "Verified stockout; CHC Nasrullaganj has 325 sachets after reserve against a 105 gap.", med: "ors", target: { at: "kamalpur", stock: 0, use: 15, trend: [98, 105, 110, 102, 64, 21] }, donors: [{ at: "nasrullaganj", km: 10.8, stock: 500, use: 25 }] },
  { id: "T07", title: "Telmisartan at Bhimpura, one donor unverified", category: "clear_transfer", expected: "transfer_surplus", rule: "P2, P3", reason: "CHC Shyampur is verified and covers the 36-strip gap; the unverified donor is not needed.", med: "telmisartan", target: { at: "bhimpura", stock: 14, use: 5 }, donors: [{ at: "kesarpura", km: 26, stock: 75, use: 5, verified: false }, { at: "shyampur", km: 12.2, stock: 120, use: 6 }] },
  { id: "T08", title: "Atenolol at Sundarpur", category: "clear_transfer", expected: "transfer_surplus", rule: "P2", reason: "Narayanpur can send 36 strips; the gap is 24.", med: "atenolol", target: { at: "sundarpur", stock: 6, use: 3 }, donors: [{ at: "narayanpur", km: 16.4, stock: 50, use: 2 }] },

  // Large raw stock at donors, but their own reserve leaves little to move. Upstream normal → indent.
  { id: "R01", title: "Metformin at Rampur, CHC holds stock but needs it", category: "reserve_blocked", expected: "draft_indent", rule: "P5", reason: "CHC Ichhawar has 120 strips but only 15 above its reserve; donors together cover 19 of 39.", med: "metformin", target: { at: "rampur", stock: 9, use: 6 }, donors: [{ at: "ichhawar", km: 6.1, stock: 120, use: 15 }, { at: "hirapur", km: 20, stock: 60, use: 8 }] },
  { id: "R02", title: "Amoxicillin at Tulsipur, District Hospital busy", category: "reserve_blocked", expected: "draft_indent", rule: "P5", reason: "The District Hospital's 300 strips leave 20 after its reserve; the gap is 46.", med: "amoxicillin", target: { at: "tulsipur", stock: 10, use: 7 }, donors: [{ at: "dh", km: 59, stock: 300, use: 40 }] },
  { id: "R03", title: "Paracetamol at Anandpur", category: "reserve_blocked", expected: "draft_indent", rule: "P5", reason: "CHC Ashta's reserve leaves 14 strips against a 48 gap.", med: "paracetamol", target: { at: "anandpur", stock: 15, use: 9 }, donors: [{ at: "ashta", km: 9.2, stock: 210, use: 28 }] },
  { id: "R04", title: "IFA at Madhavgarh, neighbours near reserve", category: "reserve_blocked", expected: "draft_indent", rule: "P5", reason: "Two donors can spare 8 strips in total against a 60 gap.", med: "ifa", target: { at: "madhavgarh", stock: 20, use: 8 }, donors: [{ at: "tulsipur", km: 11.6, stock: 75, use: 10 }, { at: "kamalpur", km: 23.4, stock: 66, use: 9 }] },
  { id: "R05", title: "Glimepiride at Lakshmipura, no donor clears reserve", category: "reserve_blocked", expected: "draft_indent", rule: "P5", reason: "No facility holds surplus above its reserve; upstream supply is normal.", med: "glimepiride", target: { at: "lakshmipura", stock: 5, use: 3 }, donors: [{ at: "anandpur", km: 16.2, stock: 40, use: 6 }, { at: "ashta", km: 22, stock: 90, use: 13 }] },

  // Real surplus exists but it is too small to bridge the gap. Upstream normal → indent.
  { id: "S01", title: "Telmisartan at Hirapur, small surplus at Gopalpura", category: "small_surplus", expected: "draft_indent", rule: "P5", reason: "Gopalpura's 18 strips cover 38% of the 48 gap.", med: "telmisartan", target: { at: "hirapur", stock: 12, use: 6 }, donors: [{ at: "gopalpura", km: 15.7, stock: 60, use: 6 }] },
  { id: "S02", title: "Metformin at Devgarh, Kesarpura can spare 22", category: "small_surplus", expected: "draft_indent", rule: "P5", reason: "22 strips cover 48% of the 46 gap; an indent is still needed.", med: "metformin", target: { at: "devgarh", stock: 10, use: 7 }, donors: [{ at: "kesarpura", km: 8.9, stock: 50, use: 4 }] },
  { id: "S03", title: "Amoxicillin at Narayanpur", category: "small_surplus", expected: "draft_indent", rule: "P5", reason: "Sundarpur can spare 10 strips against a 35 gap.", med: "amoxicillin", target: { at: "narayanpur", stock: 5, use: 5 }, donors: [{ at: "sundarpur", km: 18, stock: 45, use: 5 }] },
  { id: "S04", title: "ORS at Bhimpura, 40 sachets nearby", category: "small_surplus", expected: "draft_indent", rule: "P5", reason: "40 transferable sachets cover 40% of the 100 gap.", med: "ors", target: { at: "bhimpura", stock: 40, use: 20 }, donors: [{ at: "kesarpura", km: 26.4, stock: 180, use: 20 }] },
  { id: "S05", title: "Atenolol at Kalyanpur, Saraswati can spare 6", category: "small_surplus", expected: "draft_indent", rule: "P5", reason: "6 strips cover 38% of the 16 gap.", med: "atenolol", target: { at: "kalyanpur", stock: 4, use: 2 }, donors: [{ at: "saraswati", km: 12.4, stock: 20, use: 2 }] },
  { id: "S06", title: "Paracetamol at Chandanpura, two small donors", category: "small_surplus", expected: "draft_indent", rule: "P5", reason: "Best donor covers 47% and both together 63% of the 32 gap.", med: "paracetamol", target: { at: "chandanpura", stock: 10, use: 6 }, donors: [{ at: "lakshmipura", km: 19.5, stock: 50, use: 5 }, { at: "anandpur", km: 18.4, stock: 40, use: 5 }] },

  // Data quality: the count cannot be trusted yet.
  { id: "V01", title: "Metformin at Saraswati, voice count unconfirmed", category: "suspicious_count", expected: "verify_count", rule: "P1", reason: "The voice report is not verified; confirm before moving 48 strips.", med: "metformin", target: { at: "saraswati", stock: 16, use: 8, verified: false, source: "voice" }, donors: [{ at: "kalyanpur", km: 12.4, stock: 110, use: 5 }] },
  { id: "V02", title: "Amoxicillin at Rampur, count jumped without receipt", category: "suspicious_count", expected: "verify_count", rule: "P1", reason: "The count is far above last week's closing stock and no receipt is recorded.", med: "amoxicillin", target: { at: "rampur", stock: 30, use: 6, flag: "count is far above last week's closing stock with no receipt recorded" }, donors: [{ at: "ichhawar", km: 6.1, stock: 160, use: 12 }] },
  { id: "V03", title: "Metformin at Kamalpur, report 12 days old", category: "suspicious_count", expected: "verify_count", rule: "P1", reason: "A 12-day-old count cannot size a transfer or indent.", med: "metformin", target: { at: "kamalpur", stock: 12, use: 6, ageHours: 290 }, donors: [{ at: "nasrullaganj", km: 10.8, stock: 200, use: 15 }] },
  { id: "V04", title: "Paracetamol at Hirapur, recount already pending", category: "suspicious_count", expected: "verify_count", rule: "P1", reason: "A recount is already requested; finish it before acting.", med: "paracetamol", target: { at: "hirapur", stock: 8, use: 7, recount: "voice count was unclear", source: "voice" }, donors: [{ at: "ichhawar", km: 15.2, stock: 260, use: 20 }] },
  { id: "V05", title: "Metformin at Gopalpura, daily use contradicts trend", category: "suspicious_count", expected: "verify_count", rule: "P1", reason: "Recorded use is 12 a day but the last six weeks show about 3 a day; the risk is an artefact.", med: "metformin", target: { at: "gopalpura", stock: 20, use: 12, trend: [21, 20, 22, 19, 21, 20] }, donors: [{ at: "rampur", km: 15.9, stock: 110, use: 6 }] },
  { id: "V06", title: "Amlodipine at Devgarh, unverified during a state shortage", category: "suspicious_count", expected: "verify_count", rule: "P1", reason: "Escalating a state-level gap on an unverified count risks a false alarm; verify first.", med: "amlodipine", target: { at: "devgarh", stock: 6, use: 4, verified: false, source: "voice" }, upstream: "delayed" },
  { id: "V07", title: "Telmisartan at Anandpur, manual count not confirmed", category: "suspicious_count", expected: "verify_count", rule: "P1", reason: "Count not verified; with normal supply there is time to confirm before ordering.", med: "telmisartan", target: { at: "anandpur", stock: 14, use: 4, verified: false } },

  // District-wide shortage: no local cover and upstream delayed / unavailable.
  { id: "E01", title: "Amlodipine at Saraswati, warehouse empty", category: "district_shortage", expected: "escalate_supply_gap", rule: "P4", reason: "No donor surplus, the warehouse is empty and the state consignment has no date.", med: "amlodipine", target: { at: "saraswati", stock: 20, use: 5 }, upstream: "delayed" },
  { id: "E02", title: "Amlodipine at Kalyanpur, small donor", category: "district_shortage", expected: "escalate_supply_gap", rule: "P4", reason: "Devgarh can spare 8 strips against a 48 gap and upstream is delayed.", med: "amlodipine", target: { at: "kalyanpur", stock: 8, use: 4 }, donors: [{ at: "devgarh", km: 18, stock: 36, use: 4 }], upstream: "delayed" },
  { id: "E03", title: "Salbutamol at CHC Budhni, supply line lapsed", category: "district_shortage", expected: "escalate_supply_gap", rule: "P4", reason: "Upstream is unavailable and no facility holds surplus inhalers.", med: "salbutamol", target: { at: "budhni", stock: 3, use: 1 }, upstream: "unavailable" },
  { id: "E04", title: "Metformin at Tulsipur, warehouse nearly empty", category: "district_shortage", expected: "escalate_supply_gap", rule: "P4", reason: "Supply is nominally normal but the warehouse holds 2 days of district demand against a 5-day lead time.", med: "metformin", target: { at: "tulsipur", stock: 10, use: 6 }, storeDays: 2 },
  { id: "E05", title: "IFA at Sundarpur, consignment three weeks late", category: "district_shortage", expected: "escalate_supply_gap", rule: "P4", reason: "Local surplus covers 15% of the gap and the consignment is three weeks late.", med: "ifa", target: { at: "sundarpur", stock: 18, use: 8 }, donors: [{ at: "narayanpur", km: 16.4, stock: 65, use: 8 }], upstream: "delayed3w" },
  { id: "E06", title: "Amoxicillin stockout at Madhavgarh, no supplier", category: "district_shortage", expected: "escalate_supply_gap", rule: "P4", reason: "Verified stockout, donors cover 31% and there is no upstream supply line.", med: "amoxicillin", target: { at: "madhavgarh", stock: 0, use: 8, trend: [56, 58, 54, 57, 30, 0] }, donors: [{ at: "tulsipur", km: 11.6, stock: 76, use: 8 }], upstream: "unavailable" },
  { id: "E07", title: "Telmisartan at Chandanpura, two thin donors, delayed", category: "district_shortage", expected: "escalate_supply_gap", rule: "P4", reason: "Donors together cover 30% of the 60 gap and upstream is delayed.", med: "telmisartan", target: { at: "chandanpura", stock: 10, use: 7 }, donors: [{ at: "lakshmipura", km: 19.5, stock: 59, use: 7 }, { at: "anandpur", km: 18.4, stock: 50, use: 6 }], upstream: "delayed" },

  // Near-expiry donor stock.
  { id: "N01", title: "Metformin at Rampur, Hirapur stock expiring", category: "near_expiry", expected: "transfer_surplus", rule: "P2", reason: "Hirapur covers the gap and 40 of its strips expire soon; moving them avoids waste.", med: "metformin", target: { at: "rampur", stock: 9, use: 6 }, donors: [{ at: "hirapur", km: 20, stock: 80, use: 4, nearExpiry: 40 }] },
  { id: "N02", title: "IFA at Gopalpura, Lakshmipura batch expiring", category: "near_expiry", expected: "transfer_surplus", rule: "P2", reason: "Lakshmipura covers the 68 gap with 76 strips, 60 near expiry.", med: "ifa", target: { at: "gopalpura", stock: 12, use: 8 }, donors: [{ at: "lakshmipura", km: 33, stock: 90, use: 2, nearExpiry: 60 }] },
  { id: "N03", title: "ORS at Narayanpur, unused CHC stock expiring", category: "near_expiry", expected: "transfer_surplus", rule: "P2", reason: "CHC Budhni dispenses none and its 150 sachets expire soon; they cover the 60 gap.", med: "ors", target: { at: "narayanpur", stock: 10, use: 10 }, donors: [{ at: "budhni", km: 9.5, stock: 150, use: 0, nearExpiry: 150 }] },

  // Zero consumption edge case with a clear label.
  { id: "Z01", title: "Metformin at Kesarpura, only donor unverified with no use", category: "zero_consumption", expected: "draft_indent", rule: "P3, P5", reason: "The only surplus is an unverified zero-use record; it does not count, so indent.", med: "metformin", target: { at: "kesarpura", stock: 10, use: 5 }, donors: [{ at: "bhimpura", km: 25.5, stock: 100, use: 0, verified: false }] },

  // Unverified donors do not count as surplus.
  { id: "U01", title: "Metformin at Saraswati, only donor unverified", category: "unverified_donor", expected: "draft_indent", rule: "P3, P5", reason: "Devgarh's surplus is unverified; supply is normal, so indent.", med: "metformin", target: { at: "saraswati", stock: 16, use: 8 }, donors: [{ at: "devgarh", km: 22.5, stock: 95, use: 5, verified: false }] },
  { id: "U02", title: "Amlodipine at Hirapur, unverified donor, delayed", category: "unverified_donor", expected: "escalate_supply_gap", rule: "P3, P4", reason: "Without verified surplus and with upstream delayed, escalate.", med: "amlodipine", target: { at: "hirapur", stock: 10, use: 4 }, donors: [{ at: "gopalpura", km: 15.7, stock: 100, use: 4, verified: false }], upstream: "delayed" },
  { id: "U03", title: "Amoxicillin at Bhimpura, verified donor small", category: "unverified_donor", expected: "draft_indent", rule: "P3, P5", reason: "The unverified donor would cover it, but the verified one covers 25%.", med: "amoxicillin", target: { at: "bhimpura", stock: 8, use: 7 }, donors: [{ at: "shyampur", km: 12.2, stock: 125, use: 7, verified: false }, { at: "kesarpura", km: 26.4, stock: 61, use: 7 }] },

  // Ambiguous: two rules reasonably compete.
  { id: "A01", title: "Metformin at Anandpur, donor covers 75%", category: "partial_cover", expected: "transfer_surplus", acceptable: ["draft_indent"], rule: "P2 vs P5", reason: "A 75% transfer buys most of the lead time; indenting the rest is also defensible.", med: "metformin", target: { at: "anandpur", stock: 12, use: 6 }, donors: [{ at: "ashta", km: 9.2, stock: 97, use: 10 }] },
  { id: "A02", title: "Paracetamol at Kamalpur, two donors at 55% each", category: "partial_cover", expected: "transfer_surplus", acceptable: ["draft_indent"], rule: "P2 vs P5", reason: "Two transfers together cover the gap, but each alone does not.", med: "paracetamol", target: { at: "kamalpur", stock: 15, use: 8 }, donors: [{ at: "tulsipur", km: 30, stock: 65, use: 6 }, { at: "madhavgarh", km: 27.1, stock: 64, use: 6 }] },
  { id: "A03", title: "Amlodipine at Lakshmipura, full transfer while state supply stalled", category: "district_shortage", expected: "transfer_surplus", acceptable: ["escalate_supply_gap"], rule: "P2 vs P4", reason: "A verified donor covers the gap now, but the state supply has no date.", med: "amlodipine", target: { at: "lakshmipura", stock: 10, use: 3 }, donors: [{ at: "ashta", km: 13.4, stock: 120, use: 6 }], upstream: "delayed" },
  { id: "A04", title: "IFA stockout at Anandpur, zero count unverified", category: "suspicious_count", expected: "verify_count", acceptable: ["transfer_surplus"], rule: "P1 vs P2", reason: "The zero is unverified, but a stockout with a ready donor argues for moving stock now.", med: "ifa", target: { at: "anandpur", stock: 0, use: 9, verified: false, source: "voice" }, donors: [{ at: "ashta", km: 9.2, stock: 300, use: 20 }] },
  { id: "A05", title: "Metformin at Narayanpur, warehouse just under lead time", category: "district_shortage", expected: "escalate_supply_gap", acceptable: ["draft_indent"], rule: "P4 vs P5", reason: "The warehouse holds 4 days of demand against a 5-day lead time; supply status is normal.", med: "metformin", target: { at: "narayanpur", stock: 8, use: 5 }, storeDays: 4 },
  { id: "A06", title: "Glimepiride stockout at Kesarpura with zero recorded use", category: "zero_consumption", expected: "verify_count", acceptable: ["transfer_surplus"], rule: "P1 vs P2", reason: "Daily use reads 0 only because nothing was left to dispense; the gap figure is wrong until use is confirmed.", med: "glimepiride", target: { at: "kesarpura", stock: 0, use: 0, trend: [30, 28, 31, 0, 0, 0] }, donors: [{ at: "devgarh", km: 8.9, stock: 90, use: 3 }] },
  { id: "A07", title: "ORS at Devgarh, zero stock and zero use for six weeks", category: "zero_consumption", expected: "verify_count", acceptable: ["draft_indent"], rule: "P1", reason: "No use and no stock for six weeks: confirm whether the item is needed before ordering.", med: "ors", target: { at: "devgarh", stock: 0, use: 0, trend: [0, 0, 0, 0, 0, 0] } },
  { id: "A08", title: "Amoxicillin at Lakshmipura, near-expiry donor covers 69%", category: "near_expiry", expected: "transfer_surplus", acceptable: ["draft_indent"], rule: "P2 vs P5", reason: "Near-expiry stock should move even though it covers 69% of the gap.", med: "amoxicillin", target: { at: "lakshmipura", stock: 12, use: 6 }, donors: [{ at: "chandanpura", km: 20.3, stock: 74, use: 7, nearExpiry: 25 }] },
  { id: "A09", title: "Metformin at Hirapur, inbound transfer already covers most", category: "partial_cover", expected: "transfer_surplus", acceptable: ["draft_indent"], rule: "P2 vs P5", reason: "30 strips are already inbound; the remaining 8 can come from a donor or an indent.", med: "metformin", target: { at: "hirapur", stock: 10, use: 6, inbound: 30 }, donors: [{ at: "ichhawar", km: 15.2, stock: 160, use: 12 }] },
  { id: "A10", title: "Paracetamol at Sundarpur, just under threshold", category: "partial_cover", expected: "transfer_surplus", acceptable: ["draft_indent"], rule: "P2 vs P5", reason: "The gap is 4 strips; a donor covers it, though a routine indent would too.", med: "paracetamol", target: { at: "sundarpur", stock: 52, use: 8 }, donors: [{ at: "budhni", km: 13.8, stock: 220, use: 25 }] },
];

export const EVAL_CASES: EvalCase[] = SPECS.map((s) => ({
  id: s.id,
  title: s.title,
  category: s.category,
  expected: s.expected,
  acceptable: s.acceptable ?? [],
  ambiguous: (s.acceptable?.length ?? 0) > 0,
  rule: s.rule,
  reason: s.reason,
  snapshot: buildCaseSnapshot(s),
}));

/** A small, balanced subset for the live demo run on /evals (one or two per action, includes ambiguous). */
export const LIVE_SUBSET_IDS = ["T01", "N01", "R01", "S02", "V01", "V05", "E01", "E04", "U01", "A01"];

/** Whether a chosen action counts as correct: the expected label, or an accepted alternative for ambiguous cases. */
export function isAcceptable(c: Pick<EvalCase, "expected" | "acceptable">, choice: DecisionAction): boolean {
  return choice === c.expected || c.acceptable.includes(choice);
}
