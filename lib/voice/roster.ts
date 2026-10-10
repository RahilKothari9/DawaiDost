// Weekly check-in schedule and status for every facility. Pure + deterministic.
import type { DistrictState } from "../district/types";
import { needsRecount, stableHash } from "./facts";

export type RosterStatus = "reported" | "due" | "overdue" | "recount" | "unreachable";

export type RosterEntry = {
  facilityId: string;
  name: string;
  block: string;
  type: string;
  pharmacistName: string;
  phone: string;
  language: "hi" | "en";
  slotLabel: string; // "Tue 10:30"
  prevSlotAt: string; // ISO
  nextSlotAt: string; // ISO
  lastReportAt: string | null;
  status: RosterStatus;
  recountMedicines: string[];
  medicineCount: number;
};

const HOUR = 36e5;
const DAY = 24 * HOUR;
const IST = 5.5 * HOUR;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Each facility gets a fixed weekly call slot (Mon–Sat, 09:00–13:30 IST), derived from its id. */
export function weeklySlot(facilityId: string): { weekday: number; minutes: number } {
  const h = stableHash(`slot:${facilityId}`);
  return { weekday: 1 + (h % 6), minutes: 9 * 60 + ((h >>> 3) % 10) * 30 };
}

function slotTimes(facilityId: string, nowIso: string) {
  const { weekday, minutes } = weeklySlot(facilityId);
  const nowIst = new Date(nowIso).getTime() + IST; // shifted so UTC getters read IST wall time
  const d = new Date(nowIst);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let slot = midnight + ((weekday - d.getUTCDay() + 7) % 7) * DAY + minutes * 60_000;
  if (slot > nowIst) slot -= 7 * DAY;
  const prev = slot - IST;
  return { prev, next: prev + 7 * DAY, label: `${WEEKDAYS[weekday]} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` };
}

export function buildRoster(state: DistrictState, unreachable: ReadonlySet<string> = new Set()): RosterEntry[] {
  const now = new Date(state.now).getTime();
  return state.facilities
    .filter((f) => f.type !== "WAREHOUSE")
    .map((f) => {
      const records = state.stock.filter((s) => s.facilityId === f.id);
      const last = records.reduce<number | null>((m, r) => {
        const t = new Date(r.lastReportAt).getTime();
        return Number.isFinite(t) && (m === null || t > m) ? t : m;
      }, null);
      const { prev, next, label } = slotTimes(f.id, state.now);
      const recountMedicines = records.filter(needsRecount).map((r) => r.medicineId);
      let status: RosterStatus;
      if (unreachable.has(f.id)) status = "unreachable";
      else if (recountMedicines.length) status = "recount";
      else if (last !== null && last >= prev - 12 * HOUR) status = "reported";
      else if (now - prev < DAY) status = "due";
      else status = "overdue";
      return {
        facilityId: f.id,
        name: f.name,
        block: f.block,
        type: f.type,
        pharmacistName: f.pharmacist.name,
        phone: f.pharmacist.phone,
        language: f.pharmacist.language,
        slotLabel: label,
        prevSlotAt: new Date(prev).toISOString(),
        nextSlotAt: new Date(next).toISOString(),
        lastReportAt: last === null ? null : new Date(last).toISOString(),
        status,
        recountMedicines,
        medicineCount: records.length,
      };
    })
    .filter((e) => e.medicineCount > 0);
}

export const STATUS_ORDER: Record<RosterStatus, number> = { recount: 0, overdue: 1, due: 2, unreachable: 3, reported: 4 };

export function needsCall(e: RosterEntry): boolean {
  return e.status === "due" || e.status === "overdue" || e.status === "recount";
}

/** Deterministic: some overdue facilities don't pick up during the simulated run. */
export function simulatedNoAnswer(facilityId: string, status: RosterStatus, weekKey: string): boolean {
  return status === "overdue" && stableHash(`ring:${facilityId}:${weekKey}`) % 3 === 0;
}

export function relativeTime(iso: string | null, nowIso: string): string {
  if (!iso) return "never";
  const diff = new Date(nowIso).getTime() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const h = diff / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(diff / 60_000))} min ago`;
  if (h < 24) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
