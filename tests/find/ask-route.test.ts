import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/find/ask/route";
import { createInitialState } from "../../lib/district/data";
import { assessDistrict } from "../../lib/district/engine";
import { buildFindSnapshot } from "../../lib/find/answer";

const state = createInitialState();
const snapshot = buildFindSnapshot(state, assessDistrict(state));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const post = (body: unknown) => POST(new Request("http://localhost/api/find/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/find/ask", () => {
  it("answers a typed Hindi question without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await post({ text: "सरस्वती में मेटफॉर्मिन है क्या", lang: "hi", snapshot });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ medicineIds: ["metformin-500"], place: { kind: "facility", id: "saraswati" }, needs: null, source: { transcribe: "typed", parse: "fallback" }, fallbackReason: "missing_api_key" });
    expect(json.answerText).toContain("सरस्वती PHC पर मिलेगी");
  });

  it("asks for a place when none is given or known", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const json = await (await post({ text: "paracetamol", lang: "en", snapshot })).json();
    expect(json.needs).toBe("place");
    expect(json.answerText).toBeNull();
  });

  it("uses the place the page already knows", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const origin = { kind: "facility", id: "tulsipur", homeFacilityId: "tulsipur", lat: 22.7, lng: 77.05 };
    const json = await (await post({ text: "asthalin inhaler", lang: "en", snapshot, origin })).json();
    expect(json.answerText).toMatch(/^Salbutamol .*Not at your PHC\. Nearest with stock: /);
  });

  it("returns a text fallback for audio when voice is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const form = new FormData();
    form.set("audio", new File([new Uint8Array([1, 2, 3])], "q.webm", { type: "audio/webm" }));
    form.set("lang", "hi");
    form.set("snapshot", JSON.stringify(snapshot));
    const res = await POST(new Request("http://localhost/api/find/ask", { method: "POST", body: form }));
    expect(res.status).toBe(503);
    expect((await res.json()).fallback).toBe("text");
  });

  it("falls back to the deterministic parser when the Responses API fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "nope" } }), { status: 500 })));
    const json = await (await post({ text: "rampur me bp ki goli", lang: "hi", snapshot })).json();
    expect(json.source.parse).toBe("fallback");
    expect(json.fallbackReason).toBeTruthy();
    expect(json.medicineIds).toEqual(["amlodipine-5", "telmisartan-40", "atenolol-50"]);
    expect(json.place).toEqual({ kind: "facility", id: "rampur" });
  });

  it("rejects a malformed snapshot", async () => {
    const res = await post({ text: "metformin", snapshot: { now: "x" } });
    expect(res.status).toBe(400);
  });
});
