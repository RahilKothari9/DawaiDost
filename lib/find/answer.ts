// OWNER: find agent. Turns district state into a privacy-safe public snapshot (bands, never counts)
// and answers "where can I get this medicine today?". Pure and deterministic; runs on client and server.
import { haversineKm, ROAD_FACTOR, transferArrivalAt } from "../district/engine";
import type { DistrictState, StockAssessment, StockRecord } from "../district/types";
import type { PlaceFacility } from "./match";
import { VILLAGES } from "./lexicon";

export type Band = "available" | "low" | "out";
export type Freshness = "today" | "recent" | "old" | "stale";

export type SnapshotRow = { f: string; m: string; band: Band; at: string; verified: boolean };
export type SnapshotInbound = { f: string; m: string; arrivesAt: string; status: "approved" | "in_transit" };
export type SnapshotReport = { f: string; m: string; at: string };

/** Everything the public page knows. Contains availability bands only, never shelf counts. */
export type FindSnapshot = {
  now: string;
  facilities: PlaceFacility[];
  rows: SnapshotRow[];
  inbound: SnapshotInbound[];
  reports: SnapshotReport[];
  upstream: Record<string, "available" | "delayed" | "unavailable">;
};

export const PATIENT_REPORT_ACTOR = "Patient report";

const HOUR = 36e5;
const ms = (iso: string) => new Date(iso).getTime();

export function bandOf(record: Pick<StockRecord, "stock" | "dailyUse">, risk: StockAssessment["risk"] | undefined): Band {
  if (record.stock <= 0 || risk === "stockout") return "out";
  if (risk === "critical" || risk === "low") return "low";
  return "available";
}

export function buildFindSnapshot(state: DistrictState, assessments: StockAssessment[]): FindSnapshot {
  const facilities = state.facilities
    .filter((f) => f.type !== "WAREHOUSE")
    .map(({ id, name, type, block, lat, lng }) => ({ id, name, type, block, lat, lng }));
  const publicIds = new Set(facilities.map((f) => f.id));
  const risk = new Map(assessments.map((a) => [`${a.facilityId}|${a.medicineId}`, a.risk]));
  const rows: SnapshotRow[] = state.stock
    .filter((r) => publicIds.has(r.facilityId))
    .map((r) => ({ f: r.facilityId, m: r.medicineId, band: bandOf(r, risk.get(`${r.facilityId}|${r.medicineId}`)), at: r.lastReportAt, verified: r.verified }));
  const inbound: SnapshotInbound[] = state.transfers
    .filter((t): t is typeof t & { status: "approved" | "in_transit" } => t.status === "approved" || t.status === "in_transit")
    .map((t) => ({ f: t.toId, m: t.medicineId, arrivesAt: transferArrivalAt(t), status: t.status }));
  const reports: SnapshotReport[] = state.timeline
    .filter((e) => e.actor === PATIENT_REPORT_ACTOR && e.kind === "alert" && e.facilityId && e.medicineId)
    .map((e) => ({ f: e.facilityId!, m: e.medicineId!, at: e.at }));
  const upstream = Object.fromEntries(state.medicines.map((m) => [m.id, m.upstream?.status ?? "available"]));
  return { now: state.now, facilities, rows, inbound, reports, upstream };
}

// ---------- time ----------

const IST = 5.5 * HOUR;
const istDay = (iso: string) => new Date(ms(iso) + IST).toISOString().slice(0, 10);

export function freshnessOf(at: string, now: string): Freshness {
  const h = (ms(now) - ms(at)) / HOUR;
  if (istDay(at) === istDay(now) && h < 24) return "today";
  if (h <= 72) return "recent";
  if (h <= 7 * 24) return "old";
  return "stale";
}

/** "09:42" in IST. */
export function istTime(iso: string): string {
  return new Date(ms(iso) + IST).toISOString().slice(11, 16);
}

/** Whole days between the two IST calendar dates (0 = same day). */
export function istDaysAgo(at: string, now: string): number {
  return Math.round((Date.parse(istDay(now)) - Date.parse(istDay(at))) / (24 * HOUR));
}

// ---------- origin ----------

export type Origin = {
  kind: "facility" | "village" | "gps";
  id: string; // facility id, village id, or "gps"
  homeFacilityId: string; // the patient's own PHC
  lat: number;
  lng: number;
};

export function originForFacility(facilities: PlaceFacility[], facilityId: string): Origin | null {
  const f = facilities.find((x) => x.id === facilityId);
  return f ? { kind: "facility", id: f.id, homeFacilityId: f.id, lat: f.lat, lng: f.lng } : null;
}

export function originForVillage(facilities: PlaceFacility[], villageId: string): Origin | null {
  const v = VILLAGES.find((x) => x.id === villageId);
  const f = v && facilities.find((x) => x.id === v.phcId);
  return v && f ? { kind: "village", id: v.id, homeFacilityId: f.id, lat: f.lat + v.dLat, lng: f.lng + v.dLng } : null;
}

/** Nearest PHC to a GPS fix. Null when the person is clearly outside the district (fall back to picking a block). */
export function originForPoint(facilities: PlaceFacility[], lat: number, lng: number, maxKm = 35): Origin | null {
  let best: { f: PlaceFacility; d: number } | null = null;
  for (const f of facilities) {
    if (f.type !== "PHC") continue;
    const d = haversineKm({ lat, lng }, f);
    if (!best || d < best.d) best = { f, d };
  }
  if (!best || best.d > maxKm) return null;
  return { kind: "gps", id: "gps", homeFacilityId: best.f.id, lat, lng };
}

/** Road distance estimate in whole km (straight line × road factor). */
export function roadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.max(1, Math.round(haversineKm(a, b) * ROAD_FACTOR));
}

// ---------- answer ----------

export type FacilityOption = {
  facilityId: string;
  band: Band;
  distanceKm: number;
  reportedAt: string;
  freshness: Freshness;
  verified: boolean;
  /** Patient reports of "not available" since the last verified count. */
  patientReports: number;
  /** Earliest approved / in-transit transfer for this medicine into this facility. */
  arrivingAt: string | null;
  arrivingInHours: number | null;
};

export type AnswerKind = "here" | "here_low" | "elsewhere" | "nowhere";

export type FindAnswer = {
  medicineId: string;
  kind: AnswerKind;
  home: FacilityOption | null;
  /** Why the home PHC is not the answer. */
  homeIssue: "out" | "stale" | "unverified" | "reported_out" | null;
  /** Where to go: the home PHC for "here", the nearest stocked place for "elsewhere". */
  go: FacilityOption | null;
  /** Other places, nearest first (excludes home). */
  others: FacilityOption[];
  upstream: "available" | "delayed" | "unavailable";
};

function option(snapshot: FindSnapshot, origin: Origin, row: SnapshotRow): FacilityOption | null {
  const f = snapshot.facilities.find((x) => x.id === row.f);
  if (!f) return null;
  const arrivals = snapshot.inbound.filter((t) => t.f === row.f && t.m === row.m && ms(t.arrivesAt) >= ms(snapshot.now) - HOUR).sort((a, b) => ms(a.arrivesAt) - ms(b.arrivesAt));
  const arrivingAt = arrivals[0]?.arrivesAt ?? null;
  return {
    facilityId: f.id,
    band: row.band,
    distanceKm: f.id === origin.homeFacilityId && origin.kind === "facility" ? 0 : roadKm(origin, f),
    reportedAt: row.at,
    freshness: freshnessOf(row.at, snapshot.now),
    verified: row.verified,
    patientReports: snapshot.reports.filter((r) => r.f === row.f && r.m === row.m && ms(r.at) >= ms(row.at)).length,
    arrivingAt,
    arrivingInHours: arrivingAt ? Math.max(0, Math.round((ms(arrivingAt) - ms(snapshot.now)) / HOUR)) : null,
  };
}

/** Unverified patient reports needed before we stop sending people to a place. One report is shown, not acted on. */
export const PATIENT_REPORTS_TO_DOUBT = 2;

/** A place we can confidently send someone to. */
export function isUsable(o: FacilityOption): boolean {
  return o.band !== "out" && o.freshness !== "stale" && o.verified && o.patientReports < PATIENT_REPORTS_TO_DOUBT;
}

const LOW_PENALTY_KM = 6; // prefer a well-stocked place unless the low one is much closer

export function answerFor(snapshot: FindSnapshot, origin: Origin, medicineId: string): FindAnswer {
  const opts = snapshot.rows.filter((r) => r.m === medicineId).map((r) => option(snapshot, origin, r)).filter((o): o is FacilityOption => !!o);
  const home = opts.find((o) => o.facilityId === origin.homeFacilityId) ?? null;
  const others = opts.filter((o) => o.facilityId !== origin.homeFacilityId).sort((a, b) => a.distanceKm - b.distanceKm);
  const upstream = snapshot.upstream[medicineId] ?? "available";

  if (home && isUsable(home)) {
    return { medicineId, kind: home.band === "low" ? "here_low" : "here", home, homeIssue: null, go: home, others, upstream };
  }
  const homeIssue: FindAnswer["homeIssue"] = !home ? null
    : home.band === "out" ? "out"
    : home.freshness === "stale" ? "stale"
    : !home.verified ? "unverified"
    : "reported_out";
  const candidates = others.filter(isUsable).sort((a, b) => a.distanceKm + (a.band === "low" ? LOW_PENALTY_KM : 0) - (b.distanceKm + (b.band === "low" ? LOW_PENALTY_KM : 0)));
  const go = candidates[0] ?? null;
  return { medicineId, kind: go ? "elsewhere" : "nowhere", home, homeIssue, go, others, upstream };
}

/** ASHA mode: one answer per medicine for the same patient. */
export function answerMany(snapshot: FindSnapshot, origin: Origin, medicineIds: string[]): FindAnswer[] {
  return medicineIds.map((m) => answerFor(snapshot, origin, m));
}
