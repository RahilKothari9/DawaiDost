import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as sessionPOST } from "../../app/api/realtime/session/route";
import { POST as extractPOST } from "../../app/api/voice/extract/route";
import { POST as glossPOST } from "../../app/api/voice/gloss/route";
import { POST as ttsPOST } from "../../app/api/voice/tts/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const post = (url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const facts = {
  facility: { id: "saraswati", name: "Saraswati PHC", pharmacistName: "R. Mishra" },
  medicines: [
    { id: "metformin-500", name: "Metformin", strength: "500 mg", unit: "strip", hindiName: "मेटफॉर्मिन", lastCount: 16, dailyUse: 8, expected: 16, expectedMin: 0, expectedMax: 40 },
    { id: "amlodipine-5", name: "Amlodipine", strength: "5 mg", unit: "strip", hindiName: "एम्लोडिपिन", lastCount: 40, dailyUse: 3, expected: 40, expectedMin: 26, expectedMax: 54 },
  ],
};
const transcript = [
  { speaker: "agent", text: "मेटफॉर्मिन 500 mg की कितनी स्ट्रिप्स हैं?" },
  { speaker: "pharmacist", text: "सोलह स्ट्रिप्स।" },
  { speaker: "agent", text: "एम्लोडिपिन?" },
  { speaker: "pharmacist", text: "चार सौ।" },
];

function responsesPayload(parsed: unknown) {
  return {
    id: "resp_1", object: "response", created_at: 0, status: "completed", model: "gpt-5.4-mini",
    output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(parsed), annotations: [] }] }],
  };
}

describe("POST /api/realtime/session", () => {
  it("still works with an empty body (legacy demo)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(json({ value: "ek_test" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sessionPOST(new Request("http://localhost/api/realtime/session", { method: "POST" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.clientSecret).toBe("ek_test");
    expect(body.mode).toBe("legacy");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.session.model).toBe("gpt-realtime-2.1");
    expect(sent.session.instructions).toMatch(/16 strips/);
  });

  it("builds role-specific tools and transcription for the check-in agent", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(json({ value: "ek_test" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await sessionPOST(post("/api/realtime/session", { mode: "caller_agent", facilityId: "saraswati", facts }));
    const body = await res.json();
    expect(body.tools).toEqual(["check_count", "confirm_count", "end_call"]);
    expect(body.transcriptionModel).toBe("gpt-transcribe");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.session.audio.input.transcription.languages).toEqual(["hi", "en"]);
    expect(sent.session.tools[0].name).toBe("check_count");
  });

  it("rejects malformed requests and reports missing credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    expect((await sessionPOST(post("/api/realtime/session", { mode: "nope" }))).status).toBe(400);
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await sessionPOST(post("/api/realtime/session", {}))).status).toBe(503);
  });

  it("returns 502 when OpenAI rejects the session", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { message: "bad" } }, 400)));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await sessionPOST(post("/api/realtime/session", { mode: "availability" }))).status).toBe(502);
  });
});

describe("POST /api/voice/extract", () => {
  it("falls back to the labeled offline parser without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const body = await (await extractPOST(post("/api/voice/extract", { facts, transcript }))).json();
    expect(body.source).toBe("fallback");
    expect(body.fallbackReason).toBe("missing_api_key");
    expect(body.reports.map((r: { count: number }) => r.count)).toEqual([16, 400]);
    expect(body.reports[1].needsRecount).toBe(true);
  });

  it("maps structured outputs and validates them deterministically", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(json(responsesPayload({
      reports: [
        { medicine_id: "metformin-500", count: 16, confidence: 0.97, pharmacist_confirmed: true, evidence: "सोलह स्ट्रिप्स।" },
        { medicine_id: "amlodipine-5", count: 400, confidence: 0.9, pharmacist_confirmed: false, evidence: "चार सौ।" },
      ],
      english_summary: "Metformin 16 strips; Amlodipine 400 strips.",
    })));
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await extractPOST(post("/api/voice/extract", { facts, transcript }))).json();
    expect(body.source).toBe("live");
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.reports[0]).toMatchObject({ medicineId: "metformin-500", count: 16, needsRecount: false });
    expect(body.reports[1]).toMatchObject({ medicineId: "amlodipine-5", count: 400, needsRecount: true });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.text.format.type).toBe("json_schema");
    expect(sent.text.format.strict).toBe(true);
  });

  it("falls back when the upstream call fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { message: "no credits" } }, 429)));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = await (await extractPOST(post("/api/voice/extract", { facts, transcript }))).json();
    expect(body.source).toBe("fallback");
    expect(body.reports).toHaveLength(2);
  });

  it("validates the request", async () => {
    expect((await extractPOST(post("/api/voice/extract", { transcript }))).status).toBe(400);
  });
});

describe("gloss and tts routes", () => {
  it("gloss falls back to keyword gloss without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const body = await (await glossPOST(post("/api/voice/gloss", { lines: ["अभी सोलह स्ट्रिप्स हैं।"] }))).json();
    expect(body.source).toBe("fallback");
    expect(body.glosses[0]).toContain("16");
  });

  it("tts streams audio when the API answers and signals browser fallback otherwise", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } })));
    const ok = await ttsPOST(post("/api/voice/tts", { text: "नमस्ते" }));
    expect(ok.headers.get("Content-Type")).toBe("audio/mpeg");
    vi.stubEnv("OPENAI_API_KEY", "");
    const missing = await ttsPOST(post("/api/voice/tts", { text: "नमस्ते" }));
    expect(missing.status).toBe(503);
    expect((await missing.json()).fallback).toBe("browser_tts");
  });
});
