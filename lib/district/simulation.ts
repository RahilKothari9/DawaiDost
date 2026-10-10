// OWNER: data agent. Time-lapse ("play the week") and seeded scenario generation. Pure functions over districtReducer.
import { FACILITIES, MEDICINES, SEED_NOW, buildStock, createInitialState, mulberry32, type RecordSpec } from "./data";
import { assessDistrict, districtKpis, planAllTransfers } from "./engine";
import { districtReducer } from "./store";
import type { DistrictAction, DistrictKpis, DistrictState, TimelineEvent } from "./types";

const HOUR = 36e5;
const DAY = 864e5;
const IST = 5.5 * HOUR;

export type PlaybackPolicy = "observe" | "autopilot";

export type PlaybackOptions = {
  hours?: number; // total simulated hours (default 168 = one week)
  stepHours?: number; // hours per frame (default 6)
  policy?: PlaybackPolicy; // autopilot proposes + approves planner transfers each step
  voiceReports?: boolean; // PHCs call in their counts on a weekly rota at 09:00 IST
};

export type PlaybackFrame = {
  index: number;
  at: string;
  state: DistrictState;
  kpis: DistrictKpis;
  newEvents: TimelineEvent[];
  stockoutRecords: number;
};

const ms = (iso: string) => new Date(iso).getTime();

function apply(state: DistrictState, actions: DistrictAction[]): DistrictState {
  return actions.reduce(districtReducer, state);
}

/** Planner proposals → proposed + approved transfers (simulation actor). */
export function autopilotActions(state: DistrictState): DistrictAction[] {
  return planAllTransfers(state).flatMap((t) => [
    { type: "PROPOSE_TRANSFER", transfer: t } as DistrictAction,
    { type: "SET_TRANSFER_STATUS", transferId: t.id, status: "approved" } as DistrictAction,
  ]);
}

/** Voice reports due between t0 (exclusive) and t1 (inclusive): each PHC reports on its rota day at 09:00 IST. */
export function dueVoiceReports(state: DistrictState, t0: number, t1: number): DistrictAction[] {
  const phcs = state.facilities.filter((f) => f.type === "PHC");
  const out: DistrictAction[] = [];
  for (let day = Math.floor((t0 + IST) / DAY); day <= Math.floor((t1 + IST) / DAY); day++) {
    const at = day * DAY - IST + 9 * HOUR;
    if (at <= t0 || at > t1) continue;
    const dow = new Date(day * DAY).getUTCDay();
    phcs.forEach((f, i) => {
      if (i % 6 !== dow % 6 || dow === 0) return;
      for (const r of state.stock.filter((x) => x.facilityId === f.id)) {
        out.push({ type: "RECORD_VOICE_REPORT", report: { facilityId: f.id, medicineId: r.medicineId, count: r.stock, unit: "units", confidence: 0.94, transcript: "", language: "hi", needsRecount: false }, actor: `${f.pharmacist.name} (pharmacist, simulated)` });
      }
    });
  }
  return out;
}

/** One frame forward: advance the clock (with voice reports interleaved) and apply the policy. */
export function stepSimulation(state: DistrictState, opts: PlaybackOptions = {}): DistrictState {
  const step = opts.stepHours ?? 6;
  const t0 = ms(state.now);
  let next = districtReducer(state, { type: "ADVANCE_CLOCK", hours: step });
  if (opts.voiceReports) next = apply(next, dueVoiceReports(next, t0, ms(next.now)));
  if (opts.policy === "autopilot") next = apply(next, autopilotActions(next));
  return next;
}

const stockoutCount = (s: DistrictState) => {
  const wh = new Set(s.facilities.filter((f) => f.type === "WAREHOUSE").map((f) => f.id));
  return assessDistrict(s).filter((a) => a.risk === "stockout" && !wh.has(a.facilityId)).length;
};

/** Eager list of frames for a time-lapse; frame 0 is the starting state. */
export function buildPlayback(start: DistrictState, opts: PlaybackOptions = {}): PlaybackFrame[] {
  const hours = opts.hours ?? 168, step = opts.stepHours ?? 6;
  let state = opts.policy === "autopilot" ? apply(start, autopilotActions(start)) : start;
  const frames: PlaybackFrame[] = [{ index: 0, at: state.now, state, kpis: districtKpis(state), newEvents: [], stockoutRecords: stockoutCount(state) }];
  for (let i = 1; i * step <= hours; i++) {
    const prevIds = new Set(state.timeline.map((e) => e.id));
    state = stepSimulation(state, { ...opts, stepHours: step });
    frames.push({ index: i, at: state.now, state, kpis: districtKpis(state), newEvents: state.timeline.filter((e) => !prevIds.has(e.id)), stockoutRecords: stockoutCount(state) });
  }
  return frames;
}

/** Lazy stepper for a play/pause control: call next() on a timer. */
export function createPlayback(start: DistrictState, opts: PlaybackOptions = {}) {
  const hours = opts.hours ?? 168, step = opts.stepHours ?? 6;
  const end = ms(start.now) + hours * HOUR;
  let state = opts.policy === "autopilot" ? apply(start, autopilotActions(start)) : start;
  return {
    get state() { return state; },
    get done() { return ms(state.now) >= end; },
    progress: () => Math.min(1, (ms(state.now) - ms(start.now)) / (hours * HOUR)),
    next(): DistrictState {
      if (ms(state.now) < end) state = stepSimulation(state, { ...opts, stepHours: Math.min(step, (end - ms(state.now)) / HOUR) });
      return state;
    },
  };
}

/** Facility-days of stockout over a horizon, sampled at each step (warehouse excluded). */
export function stockoutDays(start: DistrictState, opts: PlaybackOptions = {}): number {
  const step = opts.stepHours ?? 6;
  return buildPlayback(start, opts).slice(1).reduce((s, f) => s + (f.stockoutRecords * step) / 24, 0);
}

/** Counterfactual for the pitch: stockout facility-days in the coming week with and without acting on planner transfers. */
export function compareWeek(start: DistrictState, hours = 168, stepHours = 6) {
  const without = stockoutDays(start, { hours, stepHours, policy: "observe" });
  const withAction = stockoutDays(start, { hours, stepHours, policy: "autopilot" });
  return { hours, withoutAction: Math.round(without * 10) / 10, withTransfers: Math.round(withAction * 10) / 10, averted: Math.round((without - withAction) * 10) / 10 };
}

export type ScenarioOptions = { keepHero?: boolean; shortages?: number; surplusHubs?: number; now?: string };

/** Fresh random-but-seeded scenario on the same synthetic network. Same seed → identical state. */
export function generateScenario(seed: number, opts: ScenarioOptions = {}): DistrictState {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const now = opts.now ?? SEED_NOW;
  const phcs = FACILITIES.filter((f) => f.type === "PHC");
  const chcs = FACILITIES.filter((f) => f.type === "CHC" || f.type === "DH");
  const overrides: Record<string, Record<string, RecordSpec>> = {};
  const set = (f: string, m: string, spec: RecordSpec) => { (overrides[f] ??= {})[m] = spec; };
  if (opts.keepHero ?? true) {
    set("saraswati", "metformin-500", { stock: 16, dailyUse: 8, deliveries: { 4: 230, 8: 220 } });
    set("kalyanpur", "metformin-500", { stock: 80, dailyUse: 5, deliveries: { 1: 90, 5: 140, 9: 140 } });
    set("rampur", "metformin-500", { stock: 9, dailyUse: 6, deliveries: { 4: 170, 8: 170 } });
  }
  const meds = MEDICINES.map((m) => m.id);
  for (let i = 0; i < (opts.shortages ?? 8); i++) {
    const f = pick(phcs).id, m = pick(meds);
    if (!overrides[f]?.[m]) set(f, m, { days: 0.5 + rand() * 6 });
  }
  for (let i = 0; i < (opts.surplusHubs ?? 4); i++) {
    const f = pick(chcs).id, m = pick(meds);
    if (!overrides[f]?.[m]) set(f, m, { days: 30 + rand() * 20 });
  }
  const odd = pick(phcs.filter((f) => !overrides[f.id])), oddMed = pick(meds);
  set(odd.id, oddMed, { days: 8 + rand() * 4, deliveries: { 4: 120, 8: 120 }, overrideLastClosing: 150 + Math.floor(rand() * 80), verified: false });
  const out = pick(phcs.filter((f) => !overrides[f.id]));
  set(out.id, pick(meds), { stock: 0, deliveries: { 5: 60, 9: 60 } });
  const nearExp = pick(phcs.filter((f) => !overrides[f.id]));
  const nearMed = pick(meds);
  set(nearExp.id, nearMed, { days: 40, nearExpiry: { quantity: 120, expiresOn: new Date(ms(now) + 18 * DAY).toISOString().slice(0, 10) } });
  const base = createInitialState();
  return {
    ...base,
    stock: buildStock(rand, now, overrides),
    transfers: [],
    decisions: [],
    timeline: [{ id: `ev-scenario-${seed}`, at: now, kind: "system", title: `Synthetic scenario #${seed} generated`, detail: "Randomised stock across the fictional Sehore network.", actor: "Simulation" }],
    now,
  };
}
