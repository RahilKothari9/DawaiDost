import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/decisions/district/route";
import { POST as BATCH } from "../../app/api/decisions/batch/route";
import { buildQuestions, extractDonors, fallbackDecision } from "../../lib/ai/decide";
import { applyCounterfactual, buildDecisionFacts } from "../../lib/ai/facts";
import type { AiDecisionRecord, BatchEvent } from "../../lib/ai/types";
import { fixtureState, jsonResponse, post } from "./fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const facts = () => buildDecisionFacts(fixtureState(), "saraswati", "metformin-500") as Record<string, unknown>;

const liveAnswers = {
  model: "gpt-6-luna",
  answers: [
    { type: "choice", name: "next_action", choice: "transfer_surplus", confidence: 0.91, probabilities: [
      { value: "verify_count", probability: 0.01 }, { value: "transfer_surplus", probability: 0.93 }, { value: "draft_indent", probability: 0.03 }, { value: "escalate_supply_gap", probability: 0.03 }, { value: "bogus", probability: 0.5 },
    ] },
    { type: "score", name: "urgency", score: 1.99, confidence: 0.99, probabilities: [{ value: 0, label: "monitor", probability: 0 }, { value: 1, label: "this_week", probability: 0.01 }, { value: 2, label: "today", probability: 0.99 }] },
    { type: "predicate", name: "recount_needed", probability: 0.05 },
    { type: "predicate", name: "indent_arrives_in_time", probability: 0.0 },
    { type: "choice", name: "donor", choice: "kalyanpur", confidence: 1, probabilities: [{ value: "kalyanpur", probability: 1 }, { value: false, probability: 0 }] },
    { type: "refusal", name: "transfer_bridges_gap" },
  ],
  usage: { input_tokens: 1512, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1512 },
};

describe("POST /api/decisions/district", () => {
  it("rejects malformed and incomplete requests", async () => {
    expect((await POST(post("/api/decisions/district", "nope"))).status).toBe(400);
    expect((await POST(post("/api/decisions/district", { facilityId: "saraswati", snapshot: {} }))).status).toBe(400);
    expect((await POST(post("/api/decisions/district", { facilityId: "a b/c", medicineId: "m", snapshot: {} }))).status).toBe(400);
    expect((await POST(post("/api/decisions/district", { facilityId: "a", medicineId: "m", snapshot: [] }))).status).toBe(400);
  });

  it("returns a labeled rules fallback without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const res = await POST(post("/api/decisions/district", { facilityId: "saraswati", medicineId: "metformin-500", snapshot: facts() }));
    const d = (await res.json()) as AiDecisionRecord;
    expect(d.source).toBe("demo_fallback");
    expect(d.fallbackReason).toBe("missing_api_key");
    expect(d.action).toBe("transfer_surplus");
    expect(d.ai.engine).toBe("rules");
    expect(d.ai.donor?.facilityId).toBe("kalyanpur");
    expect(d.ai.urgencyLevel).toBe("today");
    expect(d.status).toBe("pending");
    expect(d.snapshot).toMatchObject({ kind: "dawai-dost/decision-snapshot@2" });
  });

  it("sends one multi-question call and maps every answer", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(liveAnswers));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(post("/api/decisions/district", { facilityId: "saraswati", medicineId: "metformin-500", snapshot: facts() }));
    const d = (await res.json()) as AiDecisionRecord;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe("gpt-6-luna");
    expect(sent.questions.map((q: { name: string }) => q.name)).toEqual(["next_action", "urgency", "recount_needed", "indent_arrives_in_time", "donor", "transfer_bridges_gap"]);
    expect(sent.questions[1].type).toBe("score");
    expect(sent.questions[1].levels.map((l: { label: string }) => l.label)).toEqual(["monitor", "this_week", "today"]);
    expect(sent.questions[4].choices.at(-1).value).toBe(false);
    expect(JSON.parse(sent.input).target.name).toBe("Saraswati PHC");

    expect(d.source).toBe("live");
    expect(d.action).toBe("transfer_surplus");
    expect(d.confidence).toBe(0.91);
    expect(d.probabilities).toEqual({ verify_count: 0.01, transfer_surplus: 0.93, draft_indent: 0.03, escalate_supply_gap: 0.03 });
    expect(d.ai.urgencyLevel).toBe("today");
    expect(d.urgency).toBeCloseTo(0.995);
    expect(d.ai.recountProbability).toBe(0.05);
    expect(d.ai.indentInTime).toBe(0);
    expect(d.ai.donor?.facilityId).toBe("kalyanpur");
    expect(d.ai.transferBridgesGap).toBeNull();
    expect(d.ai.refusals).toEqual(["transfer_bridges_gap"]);
    expect(d.ai.usage?.totalTokens).toBe(1512);
    expect(d.model).toBe("gpt-6-luna");
  });

  it("ignores a donor the snapshot never offered", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const payload = structuredClone(liveAnswers);
    (payload.answers[4] as { choice: string }).choice = "evil-facility";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    const d = (await (await POST(post("/api/decisions/district", { facilityId: "saraswati", medicineId: "metformin-500", snapshot: facts() }))).json()) as AiDecisionRecord;
    expect(d.source).toBe("live");
    expect(d.ai.donor?.facilityId).toBe("kalyanpur"); // falls back to the top-ranked donor for a transfer
    expect(d.ai.donor?.confidence).toBe(0);
  });

  it("falls back when next_action is refused or invalid", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ answers: [{ type: "refusal", name: "next_action" }], model: "gpt-6-luna", usage: null })));
    let d = (await (await POST(post("/api/decisions/district", { facilityId: "saraswati", medicineId: "metformin-500", snapshot: facts() }))).json()) as AiDecisionRecord;
    expect(d.source).toBe("demo_fallback");
    expect(d.fallbackReason).toBe("unexpected_response");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ answers: [{ type: "choice", name: "next_action", choice: "launch_drones", probabilities: [], confidence: 1 }] })));
    d = (await (await POST(post("/api/decisions/district", { facilityId: "saraswati", medicineId: "metformin-500", snapshot: facts() }))).json()) as AiDecisionRecord;
    expect(d.fallbackReason).toBe("unexpected_response");
  });

  it("falls back on upstream errors and network failures", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "No credits remaining." } }, 429)));
    let d = (await (await POST(post("/api/decisions/district", { facilityId: "saraswati", medicineId: "metformin-500", snapshot: facts() }))).json()) as AiDecisionRecord;
    expect(d.fallbackReason).toBe("upstream_unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    d = (await (await POST(post("/api/decisions/district", { facilityId: "saraswati", medicineId: "metformin-500", snapshot: facts() }))).json()) as AiDecisionRecord;
    expect(d.fallbackReason).toBe("request_failed");
    expect(d.action).toBe("transfer_surplus");
  });
});

describe("deterministic fallback rules", () => {
  const s = fixtureState();
  it("verifies an unverified count first", () => {
    const f = applyCounterfactual(buildDecisionFacts(s, "saraswati", "metformin-500"), "unverified");
    expect(fallbackDecision(f, extractDonors(f)).action).toBe("verify_count");
  });
  it("escalates when no donor can help and upstream is delayed", () => {
    const f = applyCounterfactual(buildDecisionFacts(s, "saraswati", "amlodipine-5"), "remove_all_donors");
    expect(f.upstream?.status).toBe("delayed");
    expect(fallbackDecision(f, extractDonors(f)).action).toBe("escalate_supply_gap");
  });
  it("drafts an indent when no donor and upstream is fine", () => {
    const f = applyCounterfactual(buildDecisionFacts(s, "rampur", "metformin-500"), "remove_all_donors");
    const fb = fallbackDecision(f, extractDonors(f));
    expect(fb.action).toBe("draft_indent");
    expect(fb.meta.ruleTrace?.length).toBeGreaterThan(0);
  });
  it("only offers donors with safe surplus, capped at three", () => {
    const f = buildDecisionFacts(s, "saraswati", "metformin-500");
    const donors = extractDonors(f);
    expect(donors.map((d) => d.facilityId)).toEqual(["kalyanpur"]);
    expect(buildQuestions(donors).some((q) => q.name === "donor")).toBe(true);
    expect(buildQuestions([]).some((q) => q.name === "donor")).toBe(false);
  });
  it("counterfactual edits recompute derived facts", () => {
    const base = buildDecisionFacts(s, "saraswati", "metformin-500");
    const doubled = applyCounterfactual(base, "count_double");
    expect(doubled.target.stock).toBe(32);
    expect(doubled.target.daysOfStock).toBe(4);
    expect(doubled.target.gapUnits).toBe(32);
    expect(doubled.counterfactual).toMatch(/What-if/);
    expect(base.target.stock).toBe(16);
  });
});

describe("POST /api/decisions/batch", () => {
  it("validates the item list", async () => {
    expect((await BATCH(post("/api/decisions/batch", { items: [] }))).status).toBe(400);
  });

  it("streams NDJSON progress, decisions and a summary", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => jsonResponse(liveAnswers)));
    const s = fixtureState();
    const items = [["saraswati", "metformin-500"], ["rampur", "metformin-500"], ["saraswati", "amlodipine-5"]].map(([f, m]) => ({ facilityId: f, medicineId: m, snapshot: buildDecisionFacts(s, f, m) }));
    const res = await BATCH(post("/api/decisions/batch", { items, concurrency: 2 }));
    expect(res.headers.get("content-type")).toContain("ndjson");
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as BatchEvent);
    expect(events[0]).toMatchObject({ type: "start", total: 3, concurrency: 2 });
    expect(events.filter((e) => e.type === "progress")).toHaveLength(3);
    const decisions = events.filter((e): e is Extract<BatchEvent, { type: "decision" }> => e.type === "decision");
    expect(decisions.map((e) => e.index).sort()).toEqual([0, 1, 2]);
    expect(events.at(-1)).toMatchObject({ type: "done", total: 3, live: 3, fallback: 0, failed: 0, totalTokens: 1512 * 3 });
  });

  it("streams labeled fallbacks when the key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const s = fixtureState();
    const res = await BATCH(post("/api/decisions/batch", { items: [{ facilityId: "saraswati", medicineId: "metformin-500", snapshot: buildDecisionFacts(s, "saraswati", "metformin-500") }] }));
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as BatchEvent);
    expect(events[0]).toMatchObject({ type: "start", live: false });
    expect(events.at(-1)).toMatchObject({ type: "done", live: 0, fallback: 1 });
  });
});

describe("donor eligibility (unverified / anomalous donors never count)", () => {
  const base = () => buildDecisionFacts(fixtureState(), "saraswati", "metformin-500");
  const withDonors = (donors: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ ...base(), donors, ...extra }) as Record<string, unknown>;
  const donor = (id: string, transferable: number, more: Record<string, unknown> = {}) => ({ facilityId: id, name: id, distanceKm: 10, transferable, coversGapPct: Math.min(100, Math.round((transferable / 48) * 100)), verified: true, ...more });

  it("excludes unverified, anomalous, recount and ineligible donors", () => {
    const snap = withDonors([donor("a", 60, { verified: false }), donor("b", 60, { anomaly: true }), donor("c", 60, { recountRequested: { reason: "x", at: "" } }), donor("d", 60, { eligible: false }), donor("e", 0), donor("ok", 20)]);
    expect(extractDonors(snap).map((d) => d.facilityId)).toEqual(["ok"]);
  });

  it("drafts an indent when the only surplus is unverified and supply is normal", () => {
    const snap = withDonors([donor("devgarh", 60, { verified: false })]);
    const fb = fallbackDecision(snap, extractDonors(snap));
    expect(fb.action).toBe("draft_indent");
    expect(fb.meta.donor).toBeNull();
    expect(buildQuestions(extractDonors(snap)).some((q) => q.name === "donor")).toBe(false);
  });

  it("escalates when the only surplus is unverified and upstream is delayed", () => {
    const snap = withDonors([donor("gopalpura", 90, { verified: false })], { upstream: { status: "delayed", note: "late", expectedOn: null } });
    expect(fallbackDecision(snap, extractDonors(snap)).action).toBe("escalate_supply_gap");
  });

  it("ignores a large unverified donor when the verified one covers too little", () => {
    const snap = withDonors([donor("shyampur", 76, { verified: false }), donor("kesarpura", 12)]);
    expect(fallbackDecision(snap, extractDonors(snap)).action).toBe("draft_indent");
  });

  it("verifies the target first when its own count is suspect", () => {
    const f = base();
    const snap = { ...f, target: { ...f.target, verified: false, reportFlag: "latest count not verified" }, donors: [donor("x", 60, { verified: false })] } as Record<string, unknown>;
    expect(fallbackDecision(snap, extractDonors(snap)).action).toBe("verify_count");
  });
});

describe("daily use contradicting the dispensing trend", () => {
  it("asks for verification instead of moving stock", () => {
    const f = buildDecisionFacts(fixtureState(), "saraswati", "metformin-500");
    const snap = { ...f, target: { ...f.target, dailyUse: 12, weeklyDispensedTrend: [21, 20, 22, 19, 21, 20] } } as Record<string, unknown>;
    const fb = fallbackDecision(snap, extractDonors(snap));
    expect(fb.action).toBe("verify_count");
    expect(fb.meta.ruleTrace?.[0]).toMatch(/contradicts trend/);
  });
});

describe("next_action prompt", () => {
  it("states the criteria in priority order and conditions transfer on coverage", () => {
    const q = buildQuestions([]).find((x) => x.name === "next_action") as { instructions: string; choices: { value: string; description?: string }[] };
    const order = ["verify_count", "transfer_surplus", "escalate_supply_gap", "draft_indent"].map((a) => q.instructions.indexOf(`choose ${a}`));
    expect(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(q.instructions).toMatch(/counterfactual/);
    expect(q.instructions).toMatch(/officer must approve/);
    expect(q.choices.find((c) => c.value === "transfer_surplus")?.description).toMatch(/only when/);
  });
});
