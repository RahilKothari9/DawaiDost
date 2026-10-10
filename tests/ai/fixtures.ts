import type { DistrictState } from "../../lib/district/types";

export const NOW = "2026-10-10T09:42:00+05:30";

const WEEKS = ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"];
/** Ledger consistent with the engine's anomaly check: last week closes at the current count. */
const hist = (prevClosing: number, lastClosing: number, dispensed: number) =>
  WEEKS.map((weekOf, i) => ({ weekOf, closingStock: i === WEEKS.length - 1 ? lastClosing : prevClosing, dispensed }));

export function fixtureState(): DistrictState {
  return {
    district: { name: "Sehore", state: "Madhya Pradesh", center: [77.085, 23.2], zoom: 9, officer: { name: "Dr. Ananya Rao", title: "District Health Officer" } },
    medicines: [
      { id: "metformin-500", name: "Metformin", strength: "500 mg", unit: "strip", category: "diabetes", leadTimeDays: 5, safetyBufferDays: 3, reserveDays: 7 },
      { id: "amlodipine-5", name: "Amlodipine", strength: "5 mg", unit: "strip", category: "hypertension", leadTimeDays: 6, safetyBufferDays: 3, reserveDays: 7, upstream: { status: "delayed", note: "State consignment late", expectedOn: null } },
    ],
    facilities: [
      { id: "store", name: "District Drug Store", type: "WAREHOUSE", block: "Sehore", lat: 23.2, lng: 77.08, pharmacist: { name: "A", phone: "", language: "hi" }, catchmentPopulation: 0 },
      { id: "saraswati", name: "Saraswati PHC", type: "PHC", block: "Sehore", lat: 23.25, lng: 77.0, pharmacist: { name: "R. Mishra", phone: "", language: "hi" }, catchmentPopulation: 30000 },
      { id: "kalyanpur", name: "Kalyanpur PHC", type: "PHC", block: "Ashta", lat: 23.1, lng: 77.2, pharmacist: { name: "S. Verma", phone: "", language: "hi" }, catchmentPopulation: 28000 },
      { id: "rampur", name: "Rampur PHC", type: "PHC", block: "Ichhawar", lat: 23.0, lng: 77.0, pharmacist: { name: "K. Yadav", phone: "", language: "hi" }, catchmentPopulation: 25000 },
    ],
    stock: [
      { facilityId: "store", medicineId: "metformin-500", stock: 2000, dailyUse: 0, nearExpiry: null, lastReportAt: NOW, reportSource: "system", verified: true, history: [] },
      { facilityId: "saraswati", medicineId: "metformin-500", stock: 16, dailyUse: 8, nearExpiry: null, lastReportAt: NOW, reportSource: "voice", verified: true, history: hist(56, 16, 56) },
      { facilityId: "kalyanpur", medicineId: "metformin-500", stock: 80, dailyUse: 5, nearExpiry: null, lastReportAt: NOW, reportSource: "voice", verified: true, history: hist(107, 80, 35) },
      { facilityId: "rampur", medicineId: "metformin-500", stock: 9, dailyUse: 6, nearExpiry: null, lastReportAt: NOW, reportSource: "voice", verified: true, history: [] },
      { facilityId: "saraswati", medicineId: "amlodipine-5", stock: 3, dailyUse: 4, nearExpiry: null, lastReportAt: NOW, reportSource: "voice", verified: true, history: [] },
      { facilityId: "kalyanpur", medicineId: "amlodipine-5", stock: 20, dailyUse: 4, nearExpiry: null, lastReportAt: NOW, reportSource: "voice", verified: true, history: [] },
      { facilityId: "rampur", medicineId: "amlodipine-5", stock: 30, dailyUse: 3, nearExpiry: null, lastReportAt: NOW, reportSource: "manual", verified: false, history: [] },
    ],
    transfers: [],
    decisions: [],
    timeline: [],
    selectedFacilityId: "saraswati",
    selectedMedicineId: "metformin-500",
    now: NOW,
  };
}

export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

/** Minimal Responses API object whose output_text is `text` (for SDK responses.parse). */
export function responsesPayload(text: string, model = "gpt-5.4-mini") {
  return {
    id: "resp_test", object: "response", created_at: 1, status: "completed", model,
    output: [{ type: "message", id: "msg_1", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    parallel_tool_calls: true, tool_choice: "auto", tools: [], text: { format: { type: "text" } },
  };
}

export function sse(events: { type: string; [k: string]: unknown }[]) {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
