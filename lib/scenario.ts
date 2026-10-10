export type Clinic = {
  id: string;
  name: string;
  district: string;
  stock: number;
  dailyUse: number;
  report: string;
  status: "critical" | "surplus";
  updated: string;
};

export type DecisionAction = "verify_count" | "transfer_surplus" | "draft_indent" | "escalate_supply_gap";

export const initialClinics: Clinic[] = [
  {
    id: "saraswati",
    name: "Saraswati PHC",
    district: "Sehore district",
    stock: 16,
    dailyUse: 8,
    report: "Count confirmed by pharmacist",
    status: "critical",
    updated: "Today, 09:42",
  },
  {
    id: "kalyanpur",
    name: "Kalyanpur PHC",
    district: "Sehore district",
    stock: 80,
    dailyUse: 5,
    report: "Surplus confirmed · 45 strips available",
    status: "surplus",
    updated: "Today, 09:18",
  },
  {
    id: "rampur",
    name: "Rampur PHC",
    district: "Sehore district",
    stock: 9,
    dailyUse: 6,
    report: "Low stock · no transferable surplus",
    status: "critical",
    updated: "Today, 08:56",
  },
];

export const actionChoices: { value: DecisionAction; description: string }[] = [
  { value: "verify_count", description: "Request a recount when the latest stock report is uncertain or inconsistent." },
  { value: "transfer_surplus", description: "Move available surplus from a nearby clinic while preserving its safety reserve." },
  { value: "draft_indent", description: "Prepare a consumption-based indent when local transfer cannot cover the risk." },
  { value: "escalate_supply_gap", description: "Escalate when inventory is insufficient and upstream supply is delayed or unavailable." },
];

export const actionLabels: Record<DecisionAction, string> = {
  verify_count: "Verify stock count",
  transfer_surplus: "Transfer nearby surplus",
  draft_indent: "Draft district indent",
  escalate_supply_gap: "Escalate supply gap",
};

export function daysOfStock(stock: number, dailyUse: number): number {
  if (dailyUse <= 0) return Number.POSITIVE_INFINITY;
  return stock / dailyUse;
}

export function transferableSurplus(stock: number, dailyUse: number, reserveDays = 7): number {
  return Math.max(0, Math.floor(stock - dailyUse * reserveDays));
}

export function buildDecisionSnapshot(clinics: Clinic[]) {
  const target = clinics.find((clinic) => clinic.id === "saraswati") ?? clinics[0];
  const donors = clinics
    .filter((clinic) => clinic.id !== target.id)
    .map((clinic) => ({
      clinic: clinic.name,
      stock: clinic.stock,
      dailyUse: clinic.dailyUse,
      daysOfStock: Number(daysOfStock(clinic.stock, clinic.dailyUse).toFixed(1)),
      transferableStrips: transferableSurplus(clinic.stock, clinic.dailyUse),
    }));
  return {
    medicine: "Metformin 500 mg",
    unit: "strip of 10 tablets",
    targetClinic: target.name,
    targetStockStrips: target.stock,
    targetDailyUseStrips: target.dailyUse,
    targetDaysOfStock: Number(daysOfStock(target.stock, target.dailyUse).toFixed(1)),
    resupplyLeadTimeDays: 5,
    safetyBufferDays: 3,
    reportStatus: target.report,
    nearbyClinics: donors,
    decisionPolicy: "Recommend one next action. A district officer approves every transfer, indent, or escalation.",
  };
}

export function getFallbackDecision(clinics: Clinic[]) {
  const donors = clinics
    .filter((clinic) => clinic.id !== "saraswati")
    .map((clinic) => ({
      clinic: clinic.name,
      transferableStrips: transferableSurplus(clinic.stock, clinic.dailyUse),
    }))
    .filter((clinic) => clinic.transferableStrips > 0);
  const action: DecisionAction = donors.length ? "transfer_surplus" : "draft_indent";
  const probabilities: Record<DecisionAction, number> = action === "transfer_surplus"
    ? { verify_count: 0.05, transfer_surplus: 0.82, draft_indent: 0.09, escalate_supply_gap: 0.04 }
    : { verify_count: 0.06, transfer_surplus: 0.08, draft_indent: 0.64, escalate_supply_gap: 0.22 };
  return {
    action,
    confidence: probabilities[action],
    probabilities,
    source: "demo_fallback" as const,
  };
}
