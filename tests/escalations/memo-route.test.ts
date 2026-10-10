import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/escalations/memo/route";
import { computeLeadTimeWatch } from "../../lib/escalations/leadtime";
import { computeSupplyGap } from "../../lib/escalations/gap";
import { buildMemoFacts, fallbackMemo, unverifiedNumbers, type MemoFacts } from "../../lib/escalations/memo";
import { MED, makeState, rec } from "./fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function facts(): MemoFacts {
  const s = makeState([rec("a", 20, 10), rec("b", 50, 10), rec("c", 120, 10), rec("wh", 40, 30)]);
  return buildMemoFacts(s, computeSupplyGap(s, MED.id)!, computeLeadTimeWatch(s, MED.id), "DHO/SEH/ESC/TEST");
}

const call = (body: unknown) =>
  POST(new Request("http://localhost/api/escalations/memo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

function responsesPayload(output: unknown) {
  return new Response(JSON.stringify({
    id: "resp_1", object: "response", created_at: 0, model: "gpt-5.5", status: "completed",
    output: [{ id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

const good = {
  subject: "Urgent supply of Amlodipine 5 mg for Sehore district",
  summary: "Facilities hold 6.3 days against a required 11 days. Redistribution cannot close the need of 150 strip; 110 strip remain short.",
  hindiSummary: "सेहोर ज़िले में 110 strip की कमी है।",
  evidence: [{ key: "gapUnits", remark: "Left after all local options." }, { key: "siteCoverage", remark: "" }],
  asks: ["Dispatch 110 strip to the district warehouse on or before 17 October 2026."],
};

describe("POST /api/escalations/memo", () => {
  it("returns a labeled template memo without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await call({ facts: facts() });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.source).toBe("fallback");
    expect(json.fallbackReason).toBe("missing_api_key");
    expect(json.memo.subject).toContain("110");
    expect(json.memo.requestedDeliveryDate).toBe("2026-10-17");
    expect(json.memo.hindiSummary).toMatch(/[ऀ-ॿ]/);
  });

  it("uses live prose but takes evidence values from code", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(responsesPayload(good));
    vi.stubGlobal("fetch", fetchMock);
    const json = await (await call({ facts: facts() })).json();
    expect(json.source).toBe("live");
    expect(json.memo.evidence[0]).toMatchObject({ key: "gapUnits", value: "110 strip" });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.text.format.type).toBe("json_schema");
    expect(sent.model).toBe("gpt-5.5");
  });

  it("rejects live output that cites a number not in the facts", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responsesPayload({ ...good, summary: "About 4,200 people are affected." })));
    const json = await (await call({ facts: facts() })).json();
    expect(json.source).toBe("fallback");
    expect(json.fallbackReason).toBe("unverified_number");
  });

  it("falls back when the upstream call fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "nope" } }), { status: 503, headers: { "Content-Type": "application/json" } })));
    const json = await (await call({ facts: facts() })).json();
    expect(json.source).toBe("fallback");
    expect(json.fallbackReason).toBe("upstream_unavailable");
  });

  it("rejects malformed bodies", async () => {
    expect((await call("not-json")).status).toBe(400);
    expect((await call({ facts: { ref: 1 } })).status).toBe(400);
  });

  it("template memo passes its own number guard", () => {
    const f = facts();
    const m = fallbackMemo(f);
    expect(unverifiedNumbers(f, { subject: m.subject, summary: m.summary, hindiSummary: m.hindiSummary, asks: m.asks, evidence: [] })).toEqual([]);
  });
});
