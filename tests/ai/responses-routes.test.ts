import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as EXPLAIN } from "../../app/api/explain/route";
import { POST as BRIEFING } from "../../app/api/briefing/route";
import { POST as SPEECH } from "../../app/api/briefing/speech/route";
import { POST as INDENT } from "../../app/api/indent/route";
import { POST as ASK } from "../../app/api/ask/route";
import { compactState } from "../../lib/ai/compact";
import { buildDecisionFacts } from "../../lib/ai/facts";
import { computeIndentLines } from "../../lib/ai/indent";
import { buildBriefingSummary } from "../../lib/ai/summary";
import { runTool } from "../../lib/ai/tools";
import type { AskEvent, Briefing, ExplainResult, IndentDocument } from "../../lib/ai/types";
import { assessDistrict } from "../../lib/district/engine";
import { fixtureState, jsonResponse, post, responsesPayload, sse } from "./fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const decision = { action: "transfer_surplus", confidence: 0.91, probabilities: { verify_count: 0.01, transfer_surplus: 0.93, draft_indent: 0.03, escalate_supply_gap: 0.03 }, source: "live", donorId: "kalyanpur", donorName: "Kalyanpur PHC" };
const snapshot = () => buildDecisionFacts(fixtureState(), "saraswati", "metformin-500");

describe("POST /api/explain", () => {
  it("validates input", async () => {
    expect((await EXPLAIN(post("/api/explain", { decision: { action: "nope" }, snapshot: {} }))).status).toBe(400);
  });

  it("returns a bilingual template without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const r = (await (await EXPLAIN(post("/api/explain", { decision, snapshot: snapshot() }))).json()) as ExplainResult;
    expect(r.source).toBe("demo_fallback");
    expect(r.fallbackReason).toBe("missing_api_key");
    expect(r.en).toContain("Saraswati PHC");
    expect(r.en).toContain("Kalyanpur PHC");
    expect(r.hi).toMatch(/[ऀ-ॿ]/);
  });

  it("maps structured Responses output and sends the decision as context", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsesPayload(JSON.stringify({ en: "Saraswati has 2 days left.", hi: "सरस्वती में 2 दिन बचे हैं।", keyFacts: ["2 days", "45 transferable", "x", "y", "z"] }))));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await (await EXPLAIN(post("/api/explain", { decision, snapshot: snapshot() }))).json()) as ExplainResult;
    expect(r.source).toBe("live");
    expect(r.en).toBe("Saraswati has 2 days left.");
    expect(r.keyFacts).toHaveLength(4);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/responses");
    expect(sent.text.format.type).toBe("json_schema");
    expect(sent.text.format.strict).toBe(true);
    expect(JSON.parse(sent.input).decision.donorName).toBe("Kalyanpur PHC");
  });

  it("falls back on malformed model output", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(responsesPayload(JSON.stringify({ en: "only english" })))));
    const r = (await (await EXPLAIN(post("/api/explain", { decision, snapshot: snapshot() }))).json()) as ExplainResult;
    expect(r.source).toBe("demo_fallback");
  });
});

describe("POST /api/briefing", () => {
  const summary = () => {
    const s = fixtureState();
    return buildBriefingSummary(s, assessDistrict(s));
  };

  it("requires a summary", async () => {
    expect((await BRIEFING(post("/api/briefing", { summary: { nope: 1 } }))).status).toBe(400);
  });

  it("builds a template brief from the summary without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const b = (await (await BRIEFING(post("/api/briefing", { summary: summary() }))).json()) as Briefing;
    expect(b.source).toBe("demo_fallback");
    expect(b.bullets.length).toBeGreaterThanOrEqual(3);
    expect(b.headline.hi).toMatch(/[ऀ-ॿ]/);
  });

  it("returns the live structured brief, capped at 5 bullets", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const bullets = Array.from({ length: 7 }, (_, i) => ({ en: `b${i}`, hi: `ब${i}`, tone: "risk" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(responsesPayload(JSON.stringify({ headline: { en: "Two stockouts", hi: "दो" }, bullets, actions: [{ en: "a", hi: "अ" }] }), "gpt-6-sol"))));
    const b = (await (await BRIEFING(post("/api/briefing", { summary: summary() }))).json()) as Briefing;
    expect(b.source).toBe("live");
    expect(b.model).toBe("gpt-6-sol");
    expect(b.bullets).toHaveLength(5);
  });

  it("falls back when the API errors", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "quota" } }, 429)));
    const b = (await (await BRIEFING(post("/api/briefing", { summary: summary() }))).json()) as Briefing;
    expect(b.source).toBe("demo_fallback");
    expect(b.fallbackReason).toBe("upstream_unavailable");
  });
});

describe("POST /api/briefing/speech", () => {
  it("tells the client to use browser speech without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await SPEECH(post("/api/briefing/speech", { text: "Hello", language: "en" }));
    expect(res.status).toBe(503);
    expect((await res.json()).fallback).toBe("browser_speech");
  });

  it("streams audio from the TTS model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await SPEECH(post("/api/briefing/speech", { text: "नमस्ते", language: "hi" }));
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect((await res.arrayBuffer()).byteLength).toBe(3);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe("gpt-4o-mini-tts");
    expect(sent.instructions).toMatch(/Hindi/);
  });
});

describe("POST /api/indent", () => {
  it("computes consumption-based quantities in code", () => {
    const lines = computeIndentLines(fixtureState(), "saraswati");
    const met = lines.find((l) => l.medicineId === "metformin-500")!;
    // ledger: 56 strips/week = 8/day; cover 5 + 3 + 30 = 38 days; 8*38 - 16 - 0 = 288
    expect(met.basis).toBe("ledger");
    expect(met.avgDailyUse).toBe(8);
    expect(met.required).toBe(288);
    const aml = lines.find((l) => l.medicineId === "amlodipine-5")!;
    expect(aml.basis).toBe("reported");
    expect(aml.required).toBe(4 * (6 + 3 + 30) - 3);
  });

  it("nets off inbound transfers", () => {
    const s = fixtureState();
    s.transfers.push({ id: "t1", medicineId: "metformin-500", fromId: "kalyanpur", toId: "saraswati", quantity: 40, status: "in_transit", distanceKm: 20, etaHours: 3, createdAt: s.now, updatedAt: s.now });
    expect(computeIndentLines(s, "saraswati").find((l) => l.medicineId === "metformin-500")!.required).toBe(248);
  });

  it("validates input and unknown facilities", async () => {
    expect((await INDENT(post("/api/indent", { facilityId: "saraswati", state: { bad: true } }))).status).toBe(400);
    expect((await INDENT(post("/api/indent", { facilityId: "nowhere", state: compactState(fixtureState()) }))).status).toBe(404);
  });

  it("keeps code quantities and only takes justification text from the model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(responsesPayload(JSON.stringify({ coveringNote: "Please supply.", lines: [{ medicineId: "metformin-500", justification: "8/day for 38 days." }, { medicineId: "made-up", justification: "x" }] })))));
    const doc = (await (await INDENT(post("/api/indent", { facilityId: "saraswati", state: compactState(fixtureState()) }))).json()) as IndentDocument;
    expect(doc.source).toBe("live");
    expect(doc.coveringNote).toBe("Please supply.");
    expect(doc.lines.find((l) => l.medicineId === "metformin-500")!.justification).toBe("8/day for 38 days.");
    expect(doc.lines.find((l) => l.medicineId === "metformin-500")!.required).toBe(288);
    expect(doc.lines.some((l) => l.medicineId === "made-up")).toBe(false);
    expect(doc.lines.find((l) => l.medicineId === "amlodipine-5")!.justification).toMatch(/× 39 days/);
  });

  it("returns a template indent without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const doc = (await (await INDENT(post("/api/indent", { facilityId: "saraswati", state: compactState(fixtureState()) }))).json()) as IndentDocument;
    expect(doc.source).toBe("demo_fallback");
    expect(doc.fallbackReason).toBe("missing_api_key");
    expect(doc.lines.length).toBe(2);
  });
});

describe("Ask the district", () => {
  const events = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as AskEvent);

  it("tools answer from state only", () => {
    const s = fixtureState();
    const donors = runTool(s, "find_donors", { facility: "Saraswati", medicine: "metformin", limit: null }) as { donors: { facility: string; transferableAfterReserve: number }[] };
    expect(donors.donors[0]).toMatchObject({ facility: "Kalyanpur PHC", transferableAfterReserve: 45 });
    const risk = runTool(s, "list_at_risk", { medicine: "amlodipine", within_days: 7, block: null }) as { records: { facility: string }[] };
    expect(risk.records.map((r) => r.facility)).toEqual(["Saraswati PHC", "Kalyanpur PHC"]);
    const draft = runTool(s, "draft_transfer_proposal", { to_facility: "Rampur PHC", medicine: "Metformin", from_facility: null }) as { from: string; quantity: number; draft: boolean };
    expect(draft).toMatchObject({ from: "Kalyanpur PHC", draft: true });
    expect(draft.quantity).toBeLessThanOrEqual(45);
    expect(runTool(s, "get_stock", { facility: "Atlantis", medicine: null })).toHaveProperty("error");
    expect(runTool(s, "nope", {})).toHaveProperty("error");
  });

  it("validates the conversation", async () => {
    expect((await ASK(post("/api/ask", { messages: [], state: compactState(fixtureState()) }))).status).toBe(400);
    expect((await ASK(post("/api/ask", { messages: [{ role: "user", content: "hi" }], state: { x: 1 } }))).status).toBe(400);
  });

  it("streams a labeled deterministic answer without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const ev = await events(await ASK(post("/api/ask", { messages: [{ role: "user", content: "Where can Rampur get metformin?" }], state: compactState(fixtureState()) })));
    expect(ev[0]).toMatchObject({ type: "meta", source: "demo_fallback" });
    expect(ev.find((e) => e.type === "tool_call")).toMatchObject({ name: "find_donors" });
    const text = ev.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("Kalyanpur PHC");
    expect(ev.at(-1)).toMatchObject({ type: "done", source: "demo_fallback" });
  });

  it("runs the live tool loop: function call -> server tool -> streamed answer", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fnItem = { type: "function_call", id: "fc_1", call_id: "call_1", name: "find_donors", arguments: JSON.stringify({ facility: "Rampur PHC", medicine: "metformin", limit: 2 }), status: "completed" };
    const round1 = sse([
      { type: "response.created", sequence_number: 0, response: { id: "resp_1" } },
      { type: "response.output_item.done", sequence_number: 1, output_index: 0, item: fnItem },
      { type: "response.completed", sequence_number: 2, response: { id: "resp_1", output: [fnItem] } },
    ]);
    const round2 = sse([
      { type: "response.output_text.delta", sequence_number: 0, item_id: "m", output_index: 0, content_index: 0, delta: "Kalyanpur PHC can send " },
      { type: "response.output_text.delta", sequence_number: 1, item_id: "m", output_index: 0, content_index: 0, delta: "45 strips." },
      { type: "response.completed", sequence_number: 2, response: { id: "resp_2", output: [] } },
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce(round1).mockResolvedValueOnce(round2);
    vi.stubGlobal("fetch", fetchMock);
    const ev = await events(await ASK(post("/api/ask", { messages: [{ role: "user", content: "Where can Rampur get metformin?" }], state: compactState(fixtureState()) })));
    expect(ev[0]).toMatchObject({ type: "meta", source: "live" });
    expect(ev.find((e) => e.type === "tool_result")).toMatchObject({ name: "find_donors", summary: "1 donor" });
    expect(ev.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("Kalyanpur PHC can send 45 strips.");
    expect(ev.at(-1)).toMatchObject({ type: "done", source: "live" });
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.previous_response_id).toBe("resp_1");
    expect(second.input[0]).toMatchObject({ type: "function_call_output", call_id: "call_1" });
    expect(JSON.parse(second.input[0].output).donors[0].facility).toBe("Kalyanpur PHC");
    expect(second.tools.map((t: { name: string }) => t.name)).toContain("draft_transfer_proposal");
  });

  it("falls back when the live call fails before any text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "quota" } }, 429)));
    const ev = await events(await ASK(post("/api/ask", { messages: [{ role: "user", content: "Which PHCs run out of amlodipine this week?" }], state: compactState(fixtureState()) })));
    expect(ev.at(-1)).toMatchObject({ type: "done", source: "demo_fallback" });
    expect(ev.find((e) => e.type === "tool_call")).toMatchObject({ name: "list_at_risk", args: { within_days: 7 } });
  });
});
