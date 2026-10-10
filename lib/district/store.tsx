"use client";
// OWNER: data agent. React context store for the whole dashboard. Public API: DistrictProvider, useDistrict, districtReducer.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useSyncExternalStore, type ReactNode } from "react";
import { SEED_VERSION, createInitialState } from "./data";
import {
  AT_RISK, DISPATCH_DELAY_HOURS, assessDistrict, assessStock, detectAnomaly, districtKpis, districtTotals, inboundUnits, indentQuantity, medicineLabel, weekStart,
} from "./engine";
import type {
  DecisionRecord, DecisionStatus, DistrictAction, DistrictKpis, DistrictState, Facility, Medicine, StockAssessment, StockRecord, TimelineEvent, TimelineKind, Transfer, TransferStatus, VoiceReport,
} from "./types";

const HOUR = 36e5;
const DAY = 864e5;
const TIMELINE_CAP = 500;
export const STORAGE_KEY = `dawai-dost:district:v${SEED_VERSION}`;

const ms = (iso: string) => new Date(iso).getTime();
const isoAt = (t: number) => new Date(t).toISOString();

type Draft = Omit<TimelineEvent, "id">;

function withEvents(state: DistrictState, drafts: Draft[]): DistrictState {
  if (!drafts.length) return state;
  let n = state.timeline.length;
  const events = drafts.map((d) => ({ ...d, id: `ev-${++n}-${d.kind}-${ms(d.at).toString(36)}` })).sort((a, b) => ms(b.at) - ms(a.at));
  return { ...state, timeline: [...events, ...state.timeline].slice(0, TIMELINE_CAP) };
}

const fName = (s: DistrictState, id: string) => s.facilities.find((f) => f.id === id)?.name ?? id;
const med = (s: DistrictState, id: string) => s.medicines.find((m) => m.id === id);
const mName = (s: DistrictState, id: string) => { const m = med(s, id); return m ? medicineLabel(m) : id; };
const unitWord = (m: Medicine | undefined, q: number) => {
  const u = m?.unit.split(" ")[0] ?? "units";
  return `${q} ${u}${q === 1 || u.endsWith("s") ? "" : u === "strip" || u === "inhaler" || u === "sachet" ? "s" : ""}`;
};
const officer = (s: DistrictState) => `${s.district.officer.name} (DHO)`;
const pharmacist = (s: DistrictState, id: string) => { const f = s.facilities.find((x) => x.id === id); return f ? `${f.pharmacist.name} (pharmacist)` : "Pharmacist"; };

function updateRecord(state: DistrictState, facilityId: string, medicineId: string, fn: (r: StockRecord) => StockRecord): DistrictState {
  return { ...state, stock: state.stock.map((r) => (r.facilityId === facilityId && r.medicineId === medicineId ? fn(r) : r)) };
}

/** Rolls history forward so its last point is the week containing `at`; closes elapsed weeks at the current stock. */
function rollWeeks(r: StockRecord, at: string): StockRecord {
  const target = weekStart(at);
  const h = [...r.history];
  if (!h.length) return { ...r, history: [{ weekOf: target, closingStock: r.stock, dispensed: 0, received: 0 }] };
  let changed = false;
  while (h[h.length - 1].weekOf < target) {
    const last = h[h.length - 1];
    h[h.length - 1] = { ...last, closingStock: r.stock };
    const next = new Date(Date.parse(last.weekOf) + 7 * DAY).toISOString().slice(0, 10);
    h.push({ weekOf: next, closingStock: r.stock, dispensed: 0, received: 0 });
    changed = true;
  }
  return changed ? { ...r, history: h.slice(-12) } : r;
}

function addToCurrentWeek(r: StockRecord, field: "dispensed" | "received", qty: number): StockRecord {
  if (!r.history.length || !qty) return r;
  const h = [...r.history];
  const last = h[h.length - 1];
  h[h.length - 1] = { ...last, [field]: (last[field] ?? 0) + qty };
  return { ...r, history: h };
}

function recordVoiceReport(state: DistrictState, report: VoiceReport, actor?: string): DistrictState {
  const existing = state.stock.find((r) => r.facilityId === report.facilityId && r.medicineId === report.medicineId);
  if (!existing) return state;
  const count = Math.max(0, Math.round(report.count));
  let r = rollWeeks(existing, state.now);
  const h = [...r.history];
  const last = h[h.length - 1], prev = h[h.length - 2];
  h[h.length - 1] = { ...last, closingStock: count, dispensed: prev ? Math.max(0, prev.closingStock + (last.received ?? 0) - count) : last.dispensed };
  r = { ...r, stock: count, history: h, lastReportAt: state.now, reportSource: "voice" };
  const check = detectAnomaly(r);
  const lowConfidence = report.confidence < 0.6;
  const needsRecount = check.flagged || report.needsRecount || lowConfidence;
  const reason = check.flagged ? check.reason : report.needsRecount ? report.reason ?? "Pharmacist was unsure of the count." : lowConfidence ? `Low extraction confidence (${Math.round(report.confidence * 100)}%).` : "";
  r = { ...r, verified: !needsRecount, recountRequested: needsRecount ? { reason, at: state.now } : null };
  const m = med(state, r.medicineId);
  const by = actor ?? pharmacist(state, r.facilityId);
  const next = updateRecord(state, r.facilityId, r.medicineId, () => r);
  const events: Draft[] = [{
    at: state.now, kind: "voice_report", facilityId: r.facilityId, medicineId: r.medicineId, actor: by,
    title: `${fName(state, r.facilityId)} reported ${unitWord(m, count)} of ${mName(state, r.medicineId)}`,
    detail: report.transcript ? `"${report.transcript}"` : undefined,
  }];
  if (needsRecount) {
    events.push({ at: state.now, kind: "recount_requested", facilityId: r.facilityId, medicineId: r.medicineId, actor: "Count check", title: `Recount requested at ${fName(state, r.facilityId)}`, detail: reason });
  } else if (existing.recountRequested || !existing.verified) {
    events.push({ at: state.now, kind: "count_verified", facilityId: r.facilityId, medicineId: r.medicineId, actor: "Count check", title: `${fName(state, r.facilityId)} count verified`, detail: check.reason });
  }
  if (m && !needsRecount) {
    const a = assessStock(r, m, state.now);
    if (a.risk === "stockout" || a.risk === "critical") {
      events.push({ at: state.now, kind: "alert", facilityId: r.facilityId, medicineId: r.medicineId, actor: "Stock forecast", title: `${a.risk === "stockout" ? "Stockout" : "Critical"}: ${fName(state, r.facilityId)} ${mName(state, r.medicineId)}`, detail: `${Number.isFinite(a.daysOfStock) ? a.daysOfStock.toFixed(1) : "∞"} days of stock against a ${a.thresholdDays}-day threshold.` });
    }
  }
  return withEvents(next, events);
}

/** Moves delivered stock from donor to recipient and updates both ledgers. */
function deliver(state: DistrictState, t: Transfer, at: string): DistrictState {
  const donor = state.stock.find((r) => r.facilityId === t.fromId && r.medicineId === t.medicineId);
  const moved = Math.min(t.quantity, donor ? donor.stock : t.quantity);
  let next = state;
  if (donor) next = updateRecord(next, t.fromId, t.medicineId, (r) => addToCurrentWeek(rollWeeks({ ...r, stock: r.stock - moved }, at), "received", -moved));
  next = updateRecord(next, t.toId, t.medicineId, (r) => addToCurrentWeek(rollWeeks({ ...r, stock: r.stock + moved }, at), "received", moved));
  return next;
}

function transferTitle(s: DistrictState, t: Transfer, verb: string) {
  return `${verb}: ${unitWord(med(s, t.medicineId), t.quantity)} ${med(s, t.medicineId)?.name ?? t.medicineId} ${fName(s, t.fromId)} → ${fName(s, t.toId)}`;
}

const TERMINAL: TransferStatus[] = ["delivered", "rejected"];

function setTransferStatus(state: DistrictState, transferId: string, status: TransferStatus, at = state.now, actor?: string): DistrictState {
  const t = state.transfers.find((x) => x.id === transferId);
  if (!t || t.status === status || TERMINAL.includes(t.status)) return state;
  const upd: Transfer = {
    ...t, status, updatedAt: at,
    ...(status === "approved" ? { approvedAt: at } : {}),
    ...(status === "in_transit" ? { dispatchedAt: at, approvedAt: t.approvedAt ?? at } : {}),
    ...(status === "delivered" ? { deliveredAt: at, dispatchedAt: t.dispatchedAt ?? at, approvedAt: t.approvedAt ?? at } : {}),
  };
  let next: DistrictState = { ...state, transfers: state.transfers.map((x) => (x.id === transferId ? upd : x)) };
  if (status === "delivered") next = deliver(next, upd, at);
  const verb = { proposed: "Proposed", approved: "Approved", in_transit: "In transit", delivered: "Delivered", rejected: "Rejected" }[status];
  const kind: TimelineKind = status === "approved" ? "approval" : status === "rejected" ? "rejection" : "transfer_update";
  const by = actor ?? (status === "approved" || status === "rejected" ? officer(state) : status === "delivered" ? pharmacist(state, t.toId) : `${fName(state, t.fromId)} store`);
  const detail = status === "in_transit" ? `Vehicle dispatched; ETA ${t.etaHours} h over ${t.distanceKm} km.` : status === "delivered" ? `${fName(state, t.toId)} stock updated; ${fName(state, t.fromId)} keeps its reserve.` : undefined;
  return withEvents(next, [{ at, kind, facilityId: t.toId, medicineId: t.medicineId, actor: by, title: transferTitle(state, t, verb), detail }]);
}

function setDecisionStatus(state: DistrictState, decisionId: string, status: DecisionStatus, actor?: string): DistrictState {
  const d = state.decisions.find((x) => x.id === decisionId);
  if (!d || d.status === status) return state;
  let next: DistrictState = { ...state, decisions: state.decisions.map((x) => (x.id === decisionId ? { ...x, status, decidedAt: state.now } : x)) };
  const by = actor ?? officer(state);
  const f = fName(state, d.facilityId), m = mName(state, d.medicineId);
  const linked = next.transfers.filter((t) => t.status === "proposed" && (t.id === d.transferId || t.decisionId === d.id));
  const events: Draft[] = [];
  if (status === "approved") {
    events.push({ at: state.now, kind: "approval", facilityId: d.facilityId, medicineId: d.medicineId, actor: by, title: `Approved ${d.action.replace(/_/g, " ")} for ${f}`, detail: m });
    for (const t of linked) next = setTransferStatus(next, t.id, "approved", state.now, by);
    const rec = next.stock.find((r) => r.facilityId === d.facilityId && r.medicineId === d.medicineId);
    const medicine = med(state, d.medicineId);
    if (d.action === "verify_count" && rec) {
      next = updateRecord(next, d.facilityId, d.medicineId, (r) => ({ ...r, verified: false, recountRequested: { reason: "Officer approved a recount.", at: state.now } }));
      events.push({ at: state.now, kind: "recount_requested", facilityId: d.facilityId, medicineId: d.medicineId, actor: by, title: `Recount requested at ${f}`, detail: `${m}: pharmacist will be called back for a second count.` });
    }
    if (d.action === "draft_indent" && rec && medicine) {
      const qty = indentQuantity(rec, medicine, inboundUnits(next, d.facilityId, d.medicineId));
      events.push({ at: state.now, kind: "indent", facilityId: d.facilityId, medicineId: d.medicineId, actor: by, title: `Indent drafted: ${unitWord(medicine, qty)} ${medicine.name} for ${f}`, detail: `Consumption-based: 30 days + ${medicine.leadTimeDays}-day lead time + ${medicine.safetyBufferDays}-day buffer, minus stock and inbound.` });
    }
    if (d.action === "escalate_supply_gap" && medicine) {
      const tot = districtTotals(next, d.medicineId);
      events.push({ at: state.now, kind: "escalation", facilityId: d.facilityId, medicineId: d.medicineId, actor: by, title: `Supply gap escalated: ${m}`, detail: `District cover ${tot.coverageDays ?? "—"} days, warehouse ${tot.warehouseStock} units, ${tot.facilitiesAtRisk} facilities at risk. ${medicine.upstream?.note ?? ""}`.trim() });
    }
  } else if (status === "rejected") {
    events.push({ at: state.now, kind: "rejection", facilityId: d.facilityId, medicineId: d.medicineId, actor: by, title: `Rejected ${d.action.replace(/_/g, " ")} for ${f}`, detail: m });
    for (const t of linked) next = setTransferStatus(next, t.id, "rejected", state.now, by);
  } else if (status === "acknowledged") {
    events.push({ at: state.now, kind: "system", facilityId: d.facilityId, medicineId: d.medicineId, actor: by, title: `Acknowledged ${d.action.replace(/_/g, " ")} for ${f}`, detail: m });
  }
  return withEvents(next, events);
}

/** Consumes stock, rolls weekly history, progresses approved → in_transit → delivered by ETA, and raises new alerts. */
function advanceClock(state: DistrictState, hours: number): DistrictState {
  if (!(hours > 0)) return state;
  const t0 = ms(state.now), t1 = t0 + hours * HOUR;
  const nowIso = isoAt(t1);
  const before = new Map(assessDistrict(state).map((a) => [`${a.facilityId}|${a.medicineId}`, a.risk]));
  // Integer consumption anchored to the epoch so repeated small steps never drift.
  let next: DistrictState = {
    ...state,
    stock: state.stock.map((r) => {
      const used = Math.floor((r.dailyUse * t1) / DAY) - Math.floor((r.dailyUse * t0) / DAY);
      const consumed = Math.min(r.stock, Math.max(0, used));
      const rolled = rollWeeks(r, nowIso);
      return addToCurrentWeek({ ...rolled, stock: r.stock - consumed }, "dispensed", consumed);
    }),
  };
  // Transfer progression in chronological order.
  type Step = { at: number; id: string; status: TransferStatus };
  const steps: Step[] = [];
  for (const t of next.transfers) {
    if (t.status === "approved") {
      const dispatch = ms(t.approvedAt ?? t.updatedAt) + DISPATCH_DELAY_HOURS * HOUR;
      if (dispatch <= t1) steps.push({ at: Math.max(dispatch, t0), id: t.id, status: "in_transit" });
      const arrive = Math.max(dispatch, t0) + t.etaHours * HOUR;
      if (arrive <= t1) steps.push({ at: arrive, id: t.id, status: "delivered" });
    } else if (t.status === "in_transit") {
      const arrive = ms(t.dispatchedAt ?? t.updatedAt) + t.etaHours * HOUR;
      if (arrive <= t1) steps.push({ at: Math.max(arrive, t0), id: t.id, status: "delivered" });
    }
  }
  steps.sort((a, b) => a.at - b.at);
  next = { ...next, now: nowIso };
  for (const s of steps) next = setTransferStatus(next, s.id, s.status, isoAt(s.at));
  // New alerts for records that crossed into stockout/critical.
  const types = new Map(next.facilities.map((f: Facility) => [f.id, f.type]));
  const alerts: Draft[] = [];
  for (const a of assessDistrict(next)) {
    if (types.get(a.facilityId) === "WAREHOUSE") continue;
    const was = before.get(`${a.facilityId}|${a.medicineId}`);
    if ((a.risk === "stockout" && was !== "stockout") || (a.risk === "critical" && was && !AT_RISK.slice(0, 2).includes(was))) {
      alerts.push({ at: nowIso, kind: "alert", facilityId: a.facilityId, medicineId: a.medicineId, actor: "Stock forecast", title: `${a.risk === "stockout" ? "Stockout" : "Critical"}: ${fName(next, a.facilityId)} ${mName(next, a.medicineId)}`, detail: a.risk === "stockout" ? "Shelf empty at current consumption." : `${a.daysOfStock.toFixed(1)} days of stock left.` });
    }
  }
  return withEvents(next, alerts);
}

export function districtReducer(state: DistrictState, action: DistrictAction): DistrictState {
  switch (action.type) {
    case "SELECT_FACILITY": return { ...state, selectedFacilityId: action.facilityId };
    case "SELECT_MEDICINE": return { ...state, selectedMedicineId: action.medicineId };
    case "RECORD_VOICE_REPORT": return recordVoiceReport(state, action.report, action.actor);
    case "REQUEST_RECOUNT": {
      if (!state.stock.some((r) => r.facilityId === action.facilityId && r.medicineId === action.medicineId)) return state;
      const next = updateRecord(state, action.facilityId, action.medicineId, (r) => ({ ...r, verified: false, recountRequested: { reason: action.reason, at: state.now } }));
      return withEvents(next, [{ at: state.now, kind: "recount_requested", facilityId: action.facilityId, medicineId: action.medicineId, actor: officer(state), title: `Recount requested at ${fName(state, action.facilityId)}`, detail: `${mName(state, action.medicineId)}: ${action.reason}` }]);
    }
    case "ADD_DECISION": {
      const d = action.decision;
      const exists = state.decisions.some((x) => x.id === d.id);
      const next = { ...state, decisions: exists ? state.decisions.map((x) => (x.id === d.id ? d : x)) : [d, ...state.decisions] };
      if (exists) return next;
      const label = d.source === "live" ? "Decisions API" : "Decision (demo fallback)";
      return withEvents(next, [{ at: d.createdAt || state.now, kind: "decision", facilityId: d.facilityId, medicineId: d.medicineId, actor: "Decisions API", title: `${label}: ${d.action} (${d.confidence.toFixed(2)})`, detail: d.rationale ?? `${fName(state, d.facilityId)} · ${mName(state, d.medicineId)}` }]);
    }
    case "SET_DECISION_STATUS": return setDecisionStatus(state, action.decisionId, action.status, action.actor);
    case "PROPOSE_TRANSFER": {
      const t = action.transfer;
      if (state.transfers.some((x) => x.id === t.id)) return state;
      const decisions = t.decisionId ? state.decisions.map((d: DecisionRecord) => (d.id === t.decisionId && !d.transferId ? { ...d, transferId: t.id } : d)) : state.decisions;
      const next = { ...state, transfers: [...state.transfers, { ...t, status: "proposed" as const, createdAt: t.createdAt || state.now, updatedAt: t.updatedAt || state.now }], decisions };
      return withEvents(next, [{ at: state.now, kind: "transfer_update", facilityId: t.toId, medicineId: t.medicineId, actor: "Stock planner", title: transferTitle(state, t, "Transfer proposed"), detail: t.reason ?? `${t.distanceKm} km, ETA ${t.etaHours} h.` }]);
    }
    case "SET_TRANSFER_STATUS": return setTransferStatus(state, action.transferId, action.status);
    case "ADD_TIMELINE": return { ...state, timeline: [action.event, ...state.timeline].slice(0, TIMELINE_CAP) };
    case "ADVANCE_CLOCK": return advanceClock(state, action.hours);
    case "RESET": return createInitialState();
    default: return state;
  }
}

type InternalAction = DistrictAction | { type: "__HYDRATE"; state: DistrictState };

function internalReducer(state: DistrictState, action: InternalAction): DistrictState {
  return action.type === "__HYDRATE" ? action.state : districtReducer(state, action);
}

export type DistrictActions = {
  selectFacility: (facilityId: string | null) => void;
  selectMedicine: (medicineId: string) => void;
  recordVoiceReport: (report: VoiceReport, actor?: string) => void;
  requestRecount: (facilityId: string, medicineId: string, reason: string) => void;
  addDecision: (decision: DecisionRecord) => void;
  setDecisionStatus: (decisionId: string, status: DecisionStatus, actor?: string) => void;
  proposeTransfer: (transfer: Transfer) => void;
  setTransferStatus: (transferId: string, status: TransferStatus) => void;
  addTimeline: (event: TimelineEvent) => void;
  advanceClock: (hours: number) => void;
  reset: () => void;
};

type DistrictContextValue = {
  state: DistrictState;
  dispatch: (action: DistrictAction) => void;
  assessments: StockAssessment[];
  getAssessment: (facilityId: string, medicineId: string) => StockAssessment | undefined;
  getRecord: (facilityId: string, medicineId: string) => StockRecord | undefined;
  kpis: DistrictKpis;
  actions: DistrictActions;
  selectedFacility: Facility | null;
  selectedMedicine: Medicine;
  hydrated: boolean; // true once client-side persistence (if any) has been applied
};

const DistrictContext = createContext<DistrictContextValue | null>(null);

const noopSubscribe = () => () => {};

function loadPersisted(): DistrictState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DistrictState;
    return Array.isArray(parsed?.stock) && Array.isArray(parsed?.facilities) ? parsed : null;
  } catch {
    return null;
  }
}

/** `persist` stores state in localStorage (versioned key); RESET clears it. Off by default so every load starts at the seed. */
export function DistrictProvider({ children, persist = false, initialState }: { children: ReactNode; persist?: boolean; initialState?: DistrictState }) {
  const [state, rawDispatch] = useReducer(internalReducer, initialState, (s) => s ?? createInitialState());
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const skipSave = useRef(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!persist || loaded.current) return;
    loaded.current = true;
    const saved = loadPersisted();
    if (saved) {
      skipSave.current = true;
      rawDispatch({ type: "__HYDRATE", state: saved });
    }
  }, [persist]);

  useEffect(() => {
    if (!persist || !loaded.current) return;
    if (skipSave.current) { skipSave.current = false; return; }
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }, [state, persist, hydrated]);

  const dispatch = useCallback((action: DistrictAction) => {
    if (action.type === "RESET") {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
      skipSave.current = true;
    }
    rawDispatch(action);
  }, []);

  const actions = useMemo<DistrictActions>(() => ({
    selectFacility: (facilityId) => dispatch({ type: "SELECT_FACILITY", facilityId }),
    selectMedicine: (medicineId) => dispatch({ type: "SELECT_MEDICINE", medicineId }),
    recordVoiceReport: (report, actor) => dispatch({ type: "RECORD_VOICE_REPORT", report, actor }),
    requestRecount: (facilityId, medicineId, reason) => dispatch({ type: "REQUEST_RECOUNT", facilityId, medicineId, reason }),
    addDecision: (decision) => dispatch({ type: "ADD_DECISION", decision }),
    setDecisionStatus: (decisionId, status, actor) => dispatch({ type: "SET_DECISION_STATUS", decisionId, status, actor }),
    proposeTransfer: (transfer) => dispatch({ type: "PROPOSE_TRANSFER", transfer }),
    setTransferStatus: (transferId, status) => dispatch({ type: "SET_TRANSFER_STATUS", transferId, status }),
    addTimeline: (event) => dispatch({ type: "ADD_TIMELINE", event }),
    advanceClock: (hours) => dispatch({ type: "ADVANCE_CLOCK", hours }),
    reset: () => dispatch({ type: "RESET" }),
  }), [dispatch]);

  const value = useMemo<DistrictContextValue>(() => {
    const assessments = assessDistrict(state);
    const byKey = new Map(assessments.map((a) => [`${a.facilityId}|${a.medicineId}`, a]));
    const recByKey = new Map(state.stock.map((r) => [`${r.facilityId}|${r.medicineId}`, r]));
    return {
      state, dispatch, assessments, actions, hydrated,
      getAssessment: (f, m) => byKey.get(`${f}|${m}`),
      getRecord: (f, m) => recByKey.get(`${f}|${m}`),
      kpis: districtKpis(state),
      selectedFacility: state.facilities.find((f) => f.id === state.selectedFacilityId) ?? null,
      selectedMedicine: state.medicines.find((m) => m.id === state.selectedMedicineId) ?? state.medicines[0],
    };
  }, [state, dispatch, actions, hydrated]);

  return <DistrictContext.Provider value={value}>{children}</DistrictContext.Provider>;
}

export function useDistrict(): DistrictContextValue {
  const ctx = useContext(DistrictContext);
  if (!ctx) throw new Error("useDistrict must be used inside <DistrictProvider>");
  return ctx;
}
