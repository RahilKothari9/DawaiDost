// Shared domain contract for the district network. Every feature module codes against these types.
// Changing a type here is a cross-team change: coordinate before editing.

import type { DecisionAction } from "../scenario";

export type { DecisionAction };

export type MedicineCategory = "diabetes" | "hypertension" | "maternal" | "antibiotic" | "analgesic" | "respiratory" | "nutrition";

export type Medicine = {
  id: string;
  name: string; // "Metformin"
  strength: string; // "500 mg"
  unit: string; // "strip of 10 tablets"
  category: MedicineCategory;
  leadTimeDays: number; // district store resupply lead time
  safetyBufferDays: number;
  reserveDays: number; // a donor never goes below this many days of its own use
  shortName?: string; // "Metformin 500"
  upstream?: UpstreamSupply; // state/district supply line status (synthetic)
};

export type UpstreamSupply = {
  status: "available" | "delayed" | "unavailable";
  note: string;
  expectedOn?: string | null; // ISO date of next consignment, null when unknown
};

export type FacilityType = "WAREHOUSE" | "DH" | "CHC" | "PHC";

export type Facility = {
  id: string;
  name: string; // "Saraswati PHC"
  type: FacilityType;
  block: string; // administrative block within the district
  lat: number;
  lng: number;
  pharmacist: { name: string; phone: string; language: "hi" | "en" };
  catchmentPopulation: number;
};

export type WeeklyPoint = { weekOf: string /* ISO date */; closingStock: number; dispensed: number; received?: number };

export type StockRecord = {
  facilityId: string;
  medicineId: string;
  stock: number; // units on shelf (in medicine.unit)
  dailyUse: number; // units per day
  nearExpiry: { quantity: number; expiresOn: string /* ISO date */ } | null;
  lastReportAt: string; // ISO datetime
  reportSource: "voice" | "manual" | "system";
  verified: boolean;
  history: WeeklyPoint[]; // oldest first, 8–12 weeks
  recountRequested?: { reason: string; at: string } | null;
};

export type AnomalyKind = "unexplained_increase" | "unexplained_drop" | "low_confidence" | "stale_report";

export type AnomalyCheck = {
  flagged: boolean;
  kind: AnomalyKind | null;
  expected: number | null; // expected count from last week's ledger
  reported: number;
  deviation: number; // reported - expected
  tolerance: number;
  reason: string;
};

export type RiskLevel = "stockout" | "critical" | "low" | "ok" | "surplus";

export type StockAssessment = {
  facilityId: string;
  medicineId: string;
  daysOfStock: number; // Infinity when dailyUse is 0
  thresholdDays: number; // leadTime + safetyBuffer
  risk: RiskLevel;
  projectedStockoutDate: string | null; // ISO date
  transferable: number; // safe surplus after reserve
  gapUnits: number; // units needed to reach the threshold (0 if none)
};

export type TransferStatus = "proposed" | "approved" | "in_transit" | "delivered" | "rejected";

export type Transfer = {
  id: string;
  medicineId: string;
  fromId: string;
  toId: string;
  quantity: number;
  status: TransferStatus;
  distanceKm: number;
  etaHours: number;
  createdAt: string;
  updatedAt: string;
  decisionId?: string;
  approvedAt?: string;
  dispatchedAt?: string; // in_transit progress = (now - dispatchedAt) / etaHours
  deliveredAt?: string;
  reason?: string; // short planner note, e.g. "near-expiry stock"
};

export type DonorCandidate = {
  facilityId: string;
  name: string;
  distanceKm: number;
  stock: number;
  dailyUse: number;
  daysOfStock: number | null;
  transferable: number; // after reserve and open outbound transfers
  nearExpiry: { quantity: number; expiresOn: string; wouldExpireUnused: number } | null;
  verified: boolean;
  anomaly: boolean;
  eligible: boolean;
};

export type DistrictKpis = {
  facilitiesTotal: number;
  facilitiesReporting: number; // reported in the last 7 days
  atRiskFacilities: number; // >= 1 record stockout/critical/low
  atRiskRecords: number;
  stockouts: number;
  criticalRecords: number;
  unitsInTransit: number;
  transfersOpen: number;
  stockoutDaysAverted: number; // by approved / in_transit / delivered transfers
  decisionsPending: number;
  decisionsTotal: number;
  liveDecisions: number;
  fallbackDecisions: number;
  liveRatio: number | null; // 0..1
  anomalies: number;
};

export type DecisionStatus = "pending" | "approved" | "rejected" | "acknowledged";

export type DecisionRecord = {
  id: string;
  facilityId: string;
  medicineId: string;
  action: DecisionAction;
  confidence: number;
  probabilities: Record<DecisionAction, number>;
  source: "live" | "demo_fallback";
  fallbackReason?: string;
  urgency?: number; // 0..1, optional second Decisions API question
  rationale?: string;
  snapshot: unknown; // exact input sent to the Decisions API, kept for audit
  status: DecisionStatus;
  createdAt: string;
  decidedAt?: string;
  transferId?: string;
};

export type TimelineKind =
  | "voice_report"
  | "count_verified"
  | "recount_requested"
  | "alert"
  | "decision"
  | "approval"
  | "rejection"
  | "transfer_update"
  | "indent"
  | "escalation"
  | "briefing"
  | "system";

export type TimelineEvent = {
  id: string;
  at: string; // ISO datetime
  kind: TimelineKind;
  title: string;
  detail?: string;
  facilityId?: string;
  medicineId?: string;
  actor: string; // "R. Mishra (pharmacist)", "Decisions API", "Dr. Ananya Rao (DHO)"
};

export type VoiceReport = {
  facilityId: string;
  medicineId: string;
  count: number;
  unit: string;
  confidence: number; // 0..1 from extraction
  transcript: string;
  language: string;
  needsRecount: boolean;
  reason?: string;
};

export type DistrictInfo = {
  name: string; // "Sehore"
  state: string; // "Madhya Pradesh"
  center: [number, number]; // [lng, lat]
  zoom: number;
  officer: { name: string; title: string };
};

export type DistrictState = {
  district: DistrictInfo;
  medicines: Medicine[];
  facilities: Facility[];
  stock: StockRecord[];
  transfers: Transfer[];
  decisions: DecisionRecord[];
  timeline: TimelineEvent[]; // newest first
  selectedFacilityId: string | null;
  selectedMedicineId: string;
  now: string; // simulated clock, ISO datetime
};

export type DistrictAction =
  | { type: "SELECT_FACILITY"; facilityId: string | null }
  | { type: "SELECT_MEDICINE"; medicineId: string }
  | { type: "RECORD_VOICE_REPORT"; report: VoiceReport; actor?: string }
  | { type: "REQUEST_RECOUNT"; facilityId: string; medicineId: string; reason: string }
  | { type: "ADD_DECISION"; decision: DecisionRecord }
  | { type: "SET_DECISION_STATUS"; decisionId: string; status: DecisionStatus; actor?: string }
  | { type: "PROPOSE_TRANSFER"; transfer: Transfer }
  | { type: "SET_TRANSFER_STATUS"; transferId: string; status: TransferStatus }
  | { type: "ADD_TIMELINE"; event: TimelineEvent }
  | { type: "ADVANCE_CLOCK"; hours: number } // moves in-transit transfers forward, consumes stock
  | { type: "RESET" };
