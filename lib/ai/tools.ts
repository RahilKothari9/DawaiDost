// OWNER: ai agent. "Ask the district" function tools, executed server-side over a client-sent state snapshot.
// Every number the model may cite comes from these deterministic results.
import { assessStock, haversineKm } from "../district/engine";
import type { DistrictState, Facility, Medicine } from "../district/types";
import { rankDonors } from "./facts";

const r1 = (x: number) => Math.round(x * 10) / 10;
const norm = (x: string) => x.toLowerCase().replace(/\b(phc|chc|dh|district hospital|primary health centre|community health centre)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function resolveFacility(state: DistrictState, q: string | null | undefined): Facility | undefined {
  if (!q) return undefined;
  const k = norm(q);
  if (!k) return undefined;
  return state.facilities.find((f) => f.id === q || norm(f.id) === k) ?? state.facilities.find((f) => norm(f.name) === k) ?? state.facilities.find((f) => norm(f.name).includes(k) || k.includes(norm(f.name)));
}

export function resolveMedicine(state: DistrictState, q: string | null | undefined): Medicine | undefined {
  if (!q) return undefined;
  const k = norm(q);
  if (!k) return undefined;
  const names = (m: Medicine) => [m.id, m.name, m.shortName ?? "", `${m.name} ${m.strength}`].map(norm).filter(Boolean);
  return state.medicines.find((m) => names(m).includes(k)) ?? state.medicines.find((m) => names(m).some((n) => n.includes(k) || k.includes(n)) || k.includes(norm(m.name)));
}

const medLabel = (m: Medicine) => `${m.name} ${m.strength}`;
const RISK_ORDER: Record<string, number> = { stockout: 0, critical: 1, low: 2, ok: 3, surplus: 4 };

function row(state: DistrictState, facilityId: string, medicineId: string) {
  const rec = state.stock.find((s) => s.facilityId === facilityId && s.medicineId === medicineId);
  const med = state.medicines.find((m) => m.id === medicineId);
  const fac = state.facilities.find((f) => f.id === facilityId);
  if (!rec || !med || !fac) return null;
  const a = assessStock(rec, med, state.now);
  return {
    facility: fac.name, facilityId: fac.id, block: fac.block, medicine: medLabel(med), medicineId: med.id, unit: med.unit,
    stock: rec.stock, dailyUse: rec.dailyUse, daysOfStock: Number.isFinite(a.daysOfStock) ? r1(a.daysOfStock) : null,
    thresholdDays: a.thresholdDays, risk: a.risk, projectedStockoutDate: a.projectedStockoutDate, gapUnits: a.gapUnits,
    verified: rec.verified, lastReportAt: rec.lastReportAt,
  };
}

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const numArg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const toolImpls: Record<string, (state: DistrictState, args: Args) => unknown> = {
  get_stock(state, args) {
    const fac = resolveFacility(state, str(args.facility));
    const med = resolveMedicine(state, str(args.medicine));
    if (str(args.facility) && !fac) return { error: `No facility matches "${args.facility}".`, knownFacilities: state.facilities.slice(0, 30).map((f) => f.name) };
    if (str(args.medicine) && !med) return { error: `No medicine matches "${args.medicine}".`, knownMedicines: state.medicines.map(medLabel) };
    const rows = state.stock.filter((s) => (!fac || s.facilityId === fac.id) && (!med || s.medicineId === med.id)).map((s) => row(state, s.facilityId, s.medicineId)).filter(Boolean);
    return { asOf: state.now, count: rows.length, records: rows.slice(0, 40) };
  },
  list_at_risk(state, args) {
    const med = resolveMedicine(state, str(args.medicine));
    const within = numArg(args.within_days);
    const block = str(args.block)?.toLowerCase();
    const rows = state.stock
      .filter((s) => !med || s.medicineId === med.id)
      .map((s) => row(state, s.facilityId, s.medicineId))
      .filter((x): x is NonNullable<typeof x> => !!x && state.facilities.find((f) => f.id === x.facilityId)?.type !== "WAREHOUSE")
      .filter((x) => (within !== null ? x.daysOfStock !== null && x.daysOfStock <= within : ["stockout", "critical", "low"].includes(x.risk)))
      .filter((x) => !block || x.block.toLowerCase().includes(block))
      .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || (a.daysOfStock ?? 1e9) - (b.daysOfStock ?? 1e9));
    return { asOf: state.now, filter: { medicine: med ? medLabel(med) : "all", withinDays: within, block: block ?? "all" }, count: rows.length, records: rows.slice(0, 25) };
  },
  find_donors(state, args) {
    const fac = resolveFacility(state, str(args.facility));
    const med = resolveMedicine(state, str(args.medicine));
    if (!fac || !med) return { error: "Both a known facility and medicine are required.", facilityMatched: fac?.name ?? null, medicineMatched: med ? medLabel(med) : null };
    const target = row(state, fac.id, med.id);
    const donors = rankDonors(state, fac, med, target?.gapUnits ?? 0).slice(0, numArg(args.limit) ?? 5);
    return { target, medicine: medLabel(med), unit: med.unit, reserveDays: med.reserveDays, donors: donors.map((d) => ({ facility: d.name, facilityId: d.facilityId, distanceKm: d.distanceKm, transferableAfterReserve: d.transferable, coversGapPct: d.coversGapPct, donorDaysOfStock: d.daysOfStock, verified: d.verified })) };
  },
  get_transfers(state, args) {
    const fac = resolveFacility(state, str(args.facility));
    const med = resolveMedicine(state, str(args.medicine));
    const status = str(args.status);
    const name = (id: string) => state.facilities.find((f) => f.id === id)?.name ?? id;
    const list = state.transfers
      .filter((t) => (!fac || t.fromId === fac.id || t.toId === fac.id) && (!med || t.medicineId === med.id) && (!status || t.status === status))
      .map((t) => ({ id: t.id, from: name(t.fromId), to: name(t.toId), medicine: medLabel(state.medicines.find((m) => m.id === t.medicineId) ?? ({ name: t.medicineId, strength: "" } as Medicine)), quantity: t.quantity, status: t.status, distanceKm: r1(t.distanceKm), etaHours: r1(t.etaHours) }));
    return { count: list.length, transfers: list.slice(0, 30) };
  },
  draft_transfer_proposal(state, args) {
    const to = resolveFacility(state, str(args.to_facility));
    const med = resolveMedicine(state, str(args.medicine));
    if (!to || !med) return { error: "A known destination facility and medicine are required." };
    const target = row(state, to.id, med.id);
    const donors = rankDonors(state, to, med, target?.gapUnits ?? 0);
    const from = str(args.from_facility) ? resolveFacility(state, str(args.from_facility)) : undefined;
    const donor = from ? donors.find((d) => d.facilityId === from.id) : donors[0];
    if (!donor) return { error: from ? `${from.name} has no safe surplus of ${medLabel(med)} after its reserve.` : `No facility has safe surplus of ${medLabel(med)}.` };
    const quantity = Math.max(1, Math.min(donor.transferable, target?.gapUnits || donor.transferable));
    const fromFac = state.facilities.find((f) => f.id === donor.facilityId)!;
    const km = r1(haversineKm(fromFac, to));
    return {
      draft: true, note: "Draft only. Approve it from the Decision Queue; nothing has been moved.",
      from: donor.name, to: to.name, medicine: medLabel(med), unit: med.unit, quantity, distanceKm: km, etaHours: r1(km / 30 + 2),
      donorKeepsDays: r1((donor.stock - quantity) / Math.max(donor.dailyUse, 0.0001)),
      targetDaysAfter: target && target.dailyUse > 0 ? r1((target.stock + quantity) / target.dailyUse) : null,
    };
  },
};

const fString = (description: string) => ({ type: ["string", "null"], description });

/** Responses API function tool definitions (strict JSON schema: all keys required, nullable when optional). */
export const toolDefinitions = [
  {
    type: "function" as const, name: "get_stock", strict: true,
    description: "Current stock, daily use, days of stock and risk for a facility and/or medicine. Use null to leave a filter open.",
    parameters: { type: "object", additionalProperties: false, required: ["facility", "medicine"], properties: { facility: fString("Facility name or id, e.g. 'Rampur PHC'"), medicine: fString("Medicine name, e.g. 'metformin'") } },
  },
  {
    type: "function" as const, name: "list_at_risk",
    strict: true,
    description: "Facilities at risk of stockout, most urgent first. within_days filters by days of stock remaining (e.g. 7 for 'this week'); null returns all stockout/critical/low records.",
    parameters: { type: "object", additionalProperties: false, required: ["medicine", "within_days", "block"], properties: { medicine: fString("Medicine name or null for all"), within_days: { type: ["number", "null"], description: "Max days of stock remaining" }, block: fString("Administrative block or null") } },
  },
  {
    type: "function" as const, name: "find_donors", strict: true,
    description: "Nearby facilities that can safely send a medicine to a facility, with transferable units after the donor keeps its reserve.",
    parameters: { type: "object", additionalProperties: false, required: ["facility", "medicine", "limit"], properties: { facility: { type: "string", description: "Facility that needs stock" }, medicine: { type: "string" }, limit: { type: ["number", "null"] } } },
  },
  {
    type: "function" as const, name: "get_transfers", strict: true,
    description: "Transfers in the district, optionally filtered by facility, medicine, or status (proposed, approved, in_transit, delivered, rejected).",
    parameters: { type: "object", additionalProperties: false, required: ["facility", "medicine", "status"], properties: { facility: fString("Facility name or null"), medicine: fString("Medicine or null"), status: { type: ["string", "null"], enum: ["proposed", "approved", "in_transit", "delivered", "rejected", null] } } },
  },
  {
    type: "function" as const, name: "draft_transfer_proposal", strict: true,
    description: "Draft (not execute) a reserve-safe transfer to a facility. The officer approves it separately.",
    parameters: { type: "object", additionalProperties: false, required: ["to_facility", "medicine", "from_facility"], properties: { to_facility: { type: "string" }, medicine: { type: "string" }, from_facility: fString("Preferred donor, or null to pick the best") } },
  },
];

export function runTool(state: DistrictState, name: string, args: Args): unknown {
  const impl = toolImpls[name];
  if (!impl) return { error: `Unknown tool ${name}` };
  try {
    return impl(state, args);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "tool failed" };
  }
}

/** One-line chip summary of a tool result. */
export function summarizeToolResult(name: string, result: unknown): string {
  const r = result as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return "no result";
  if (typeof r.error === "string") return r.error;
  switch (name) {
    case "get_stock": return `${r.count} record${r.count === 1 ? "" : "s"}`;
    case "list_at_risk": return `${r.count} at risk`;
    case "find_donors": return `${(r.donors as unknown[]).length} donor${(r.donors as unknown[]).length === 1 ? "" : "s"}`;
    case "get_transfers": return `${r.count} transfer${r.count === 1 ? "" : "s"}`;
    case "draft_transfer_proposal": return `${r.quantity} ${r.unit} ${r.from} → ${r.to}`;
    default: return "done";
  }
}

// ---------- deterministic fallback answer ----------

export type FallbackPlan = { calls: { name: string; args: Args }[] };

export function planFallback(state: DistrictState, question: string): FallbackPlan {
  const q = question.toLowerCase();
  const med = state.medicines.find((m) => q.includes(m.name.toLowerCase()) || (m.shortName && q.includes(m.shortName.toLowerCase())));
  const fac = state.facilities.find((f) => q.includes(norm(f.name)) && norm(f.name).length > 2);
  const week = /week|7 days|हफ्ते|सप्ताह/.test(q);
  if (fac && med && /where|get|donor|send|transfer|kahan|from/.test(q)) return { calls: [{ name: "find_donors", args: { facility: fac.name, medicine: med.name, limit: 3 } }] };
  if (/transfer|in transit|moving/.test(q)) return { calls: [{ name: "get_transfers", args: { facility: fac?.name ?? null, medicine: med?.name ?? null, status: null } }] };
  if (fac) return { calls: [{ name: "get_stock", args: { facility: fac.name, medicine: med?.name ?? null } }] };
  return { calls: [{ name: "list_at_risk", args: { medicine: med?.name ?? null, within_days: week ? 7 : null, block: null } }] };
}

export function composeFallbackAnswer(name: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (!r || typeof r.error === "string") return `I couldn't answer that from district data: ${r?.error ?? "no result"}.`;
  if (name === "list_at_risk") {
    const recs = r.records as { facility: string; medicine: string; daysOfStock: number | null; risk: string; projectedStockoutDate: string | null }[];
    if (!recs.length) return "No facility matches that risk filter right now.";
    return `${r.count} record${r.count === 1 ? "" : "s"} at risk:\n` + recs.slice(0, 6).map((x) => `• ${x.facility}: ${x.medicine}, ${x.daysOfStock ?? "–"} days left (${x.risk}${x.projectedStockoutDate ? `, out by ${x.projectedStockoutDate}` : ""})`).join("\n");
  }
  if (name === "find_donors") {
    const donors = r.donors as { facility: string; distanceKm: number; transferableAfterReserve: number; coversGapPct: number }[];
    const t = r.target as { facility: string; gapUnits: number } | null;
    if (!donors.length) return `No facility can safely send ${r.medicine} to ${t?.facility ?? "that facility"} after keeping its reserve. Consider a district indent.`;
    return `${t?.facility ?? "The facility"} needs ${t?.gapUnits ?? "?"} ${r.unit} of ${r.medicine}. Best donors:\n` + donors.map((d) => `• ${d.facility}: ${d.transferableAfterReserve} transferable, ${d.distanceKm} km, covers ${d.coversGapPct}% of the gap`).join("\n");
  }
  if (name === "get_transfers") {
    const ts = r.transfers as { from: string; to: string; medicine: string; quantity: number; status: string }[];
    if (!ts.length) return "No transfers match.";
    return ts.slice(0, 8).map((t) => `• ${t.quantity} ${t.medicine}: ${t.from} → ${t.to} (${t.status.replace("_", " ")})`).join("\n");
  }
  if (name === "get_stock") {
    const recs = r.records as { facility: string; medicine: string; stock: number; daysOfStock: number | null; risk: string }[];
    if (!recs.length) return "No stock records match.";
    return recs.slice(0, 8).map((x) => `• ${x.facility}: ${x.medicine}, ${x.stock} on shelf, ${x.daysOfStock ?? "–"} days (${x.risk})`).join("\n");
  }
  return "Done.";
}
