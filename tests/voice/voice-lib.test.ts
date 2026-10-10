import { describe, expect, it } from "vitest";
import { createInitialState } from "../../lib/district/data";
import type { DistrictState } from "../../lib/district/types";
import { checkAvailability } from "../../lib/voice/availability";
import { buildFacilityFacts, expectedRange } from "../../lib/voice/facts";
import { fallbackExtract } from "../../lib/voice/fallbackExtract";
import { buildSessionConfig, LEGACY_INSTRUCTIONS } from "../../lib/voice/instructions";
import { parseNumbers } from "../../lib/voice/numbers";
import { buildRoster } from "../../lib/voice/roster";
import { callerAgentScript, pharmacistSimScript, scriptToTranscript } from "../../lib/voice/scripts";
import type { FacilityRef, MedicineFact } from "../../lib/voice/types";
import { checkCount } from "../../lib/voice/validate";

const values = (t: string) => parseNumbers(t).map((n) => n.value);

const facility: FacilityRef = { id: "saraswati", name: "Saraswati PHC", block: "Sehore", type: "PHC", pharmacistName: "R. Mishra", language: "hi" };
const metformin: MedicineFact = { id: "metformin-500", name: "Metformin", strength: "500 mg", unit: "strip", hindiName: "मेटफॉर्मिन", lastCount: 16, dailyUse: 8, expected: 16, expectedMin: 0, expectedMax: 40 };
const amlodipine: MedicineFact = { id: "amlodipine-5", name: "Amlodipine", strength: "5 mg", unit: "strip", hindiName: "एम्लोडिपिन", lastCount: 40, dailyUse: 3, expected: 40, expectedMin: 26, expectedMax: 54 };

describe("parseNumbers", () => {
  it("reads Hindi number words 1–100", () => {
    expect(values("एक")).toEqual([1]);
    expect(values("सोलह स्ट्रिप्स")).toEqual([16]);
    expect(values("बयालीस")).toEqual([42]);
    expect(values("निन्यानवे")).toEqual([99]);
    expect(values("सौ")).toEqual([100]);
  });
  it("normalises nukta / chandrabindu spelling variants", () => {
    expect(values("पाँच")).toEqual([5]);
    expect(values("पांच")).toEqual([5]);
    expect(values("अड़तीस")).toEqual([38]);
  });
  it("combines hundreds and thousands", () => {
    expect(values("दो सौ पचास")).toEqual([250]);
    expect(values("डेढ़ सौ")).toEqual([150]);
    expect(values("एक हज़ार दो सौ")).toEqual([1200]);
  });
  it("reads English words, ASCII and Devanagari digits", () => {
    expect(values("one hundred twenty three strips")).toEqual([123]);
    expect(values("forty two")).toEqual([42]);
    expect(values("16 strips and 1,200 tablets")).toEqual([16, 1200]);
    expect(values("१६ स्ट्रिप")).toEqual([16]);
  });
  it("keeps adjacent independent numbers separate", () => {
    expect(values("बीस पच्चीस")).toEqual([20, 25]);
  });
});

describe("checkCount", () => {
  it("accepts counts inside the expected range", () => {
    expect(checkCount(metformin, 14).plausible).toBe(true);
  });
  it("flags unexplained increases and drops with a reason", () => {
    const high = checkCount(amlodipine, 400);
    expect(high.plausible).toBe(false);
    expect(high.reason).toMatch(/Unexplained increase/);
    expect(checkCount(amlodipine, 3).reason).toMatch(/Unexplained drop/);
  });
});

describe("fallbackExtract", () => {
  it("attributes pharmacist numbers to the medicine just asked, skipping daily use and strengths", () => {
    const reports = fallbackExtract(facility, [metformin, amlodipine], [
      { speaker: "agent", text: "नमस्ते, मेटफॉर्मिन 500 mg की कितनी स्ट्रिप्स बची हैं?" },
      { speaker: "pharmacist", text: "अभी सोलह स्ट्रिप्स हैं, रोज़ आठ जाती हैं।" },
      { speaker: "agent", text: "एम्लोडिपिन 5 mg?" },
      { speaker: "pharmacist", text: "चार सौ स्ट्रिप्स।" },
    ]);
    expect(reports.map((r) => [r.medicineId, r.count, r.needsRecount])).toEqual([
      ["metformin-500", 16, false],
      ["amlodipine-5", 400, true],
    ]);
    expect(reports[1].reason).toMatch(/expected/);
  });
  it("uses the recounted number when the pharmacist corrects themselves", () => {
    const reports = fallbackExtract(facility, [amlodipine], "Agent: एम्लोडिपिन कितनी है?\nPharmacist: चार सौ\nAgent: दोबारा गिन लीजिए\nPharmacist: माफ़ कीजिए, बयालीस हैं");
    expect(reports[0].count).toBe(42);
    expect(reports[0].needsRecount).toBe(false);
  });
  it("round-trips the scripted sample calls", () => {
    const facts = { facility, medicines: [{ ...metformin, shelfCount: 15 }, { ...amlodipine, shelfCount: 41 }] };
    const sim = fallbackExtract(facility, facts.medicines, scriptToTranscript(pharmacistSimScript(facts)));
    expect(sim.map((r) => r.count)).toEqual([15, 41]);
    const agent = fallbackExtract(facility, facts.medicines, scriptToTranscript(callerAgentScript({ ...facts, medicines: [{ ...amlodipine, shelfCount: 400 }] })));
    expect(agent[0].count).toBe(40); // recount in the script lands on the expected value
  });
});

describe("buildSessionConfig", () => {
  it("keeps the legacy role-play instructions for an empty request", () => {
    const c = buildSessionConfig("legacy");
    expect(c.instructions).toBe(LEGACY_INSTRUCTIONS);
    expect(c.tools).toHaveLength(0);
    expect(c.micInput).toBe(false);
  });
  it("gives the check-in agent count tools and Hindi transcription, never the expected numbers", () => {
    const c = buildSessionConfig("caller_agent", { facility, medicines: [metformin] });
    expect(c.tools.map((t) => t.name)).toEqual(["check_count", "confirm_count", "end_call"]);
    expect(c.micInput).toBe(true);
    expect(JSON.stringify(c.session)).toContain("gpt-transcribe");
    expect(c.instructions).toContain('id="metformin-500"');
    expect(c.instructions).not.toMatch(/\b(16|40)\b/); // no last count or expected bound leaks to the agent
  });
  it("gives the simulated pharmacist only the supplied shelf counts", () => {
    const c = buildSessionConfig("pharmacist_sim", { facility, medicines: [{ ...metformin, shelfCount: 15 }] });
    expect(c.instructions).toContain("15 strip");
    expect(c.instructions).toMatch(/Do not invent/);
    expect(c.micInput).toBe(false);
  });
  it("gives the availability line the check_availability tool", () => {
    const c = buildSessionConfig("availability", { directory: { facilities: [{ id: "a", name: "Saraswati PHC", block: "" }], medicines: [{ id: "m", name: "Metformin", strength: "500 mg" }] } });
    expect(c.tools.map((t) => t.name)).toEqual(["check_availability"]);
    expect(c.instructions).toContain("Saraswati PHC");
  });
});

describe("store-backed helpers", () => {
  const state: DistrictState = createInitialState();

  it("builds facility facts with an expected range", () => {
    const facts = buildFacilityFacts(state, "saraswati");
    expect(facts.facility.name).toBe("Saraswati PHC");
    expect(facts.medicines[0].id).toBe("metformin-500");
    expect(facts.medicines[0].expectedMin).toBeLessThanOrEqual(facts.medicines[0].expected);
  });

  it("projects the expected count forward by daily use", () => {
    const r = expectedRange({ stock: 100, dailyUse: 10, lastReportAt: "2026-10-03T09:00:00+05:30", history: [] }, "2026-10-10T09:00:00+05:30");
    expect(r.expected).toBe(30);
  });

  it("answers availability and suggests the nearest facility with stock", () => {
    const empty: DistrictState = { ...state, stock: state.stock.map((s) => (s.facilityId === "rampur" ? { ...s, stock: 0 } : s)) };
    const a = checkAvailability(empty, "metformin", "Rampur PHC");
    expect(a.found).toBe(true);
    expect(a.available).toBe(false);
    expect(a.alternatives?.[0].name).toBeDefined();
    expect(checkAvailability(state, "मेटफॉर्मिन", "saraswati").available).toBe(true);
    expect(checkAvailability(state, "unobtainium", "Saraswati PHC").found).toBe(false);
  });

  it("computes a roster status for every facility", () => {
    const roster = buildRoster(state);
    expect(roster).toHaveLength(state.facilities.filter((f) => f.type !== "WAREHOUSE").length);
    expect(roster.every((r) => /^(Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/.test(r.slotLabel))).toBe(true);
    const stale: DistrictState = { ...state, stock: state.stock.map((s) => ({ ...s, lastReportAt: "2026-09-20T09:00:00+05:30" })) };
    expect(buildRoster(stale).every((r) => r.status === "overdue" || r.status === "due")).toBe(true);
    expect(buildRoster(state, new Set(["saraswati"])).find((r) => r.facilityId === "saraswati")?.status).toBe("unreachable");
  });
});
