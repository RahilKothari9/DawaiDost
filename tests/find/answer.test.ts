import { describe, expect, it } from "vitest";
import { createInitialState } from "../../lib/district/data";
import { assessDistrict } from "../../lib/district/engine";
import { districtReducer } from "../../lib/district/store";
import {
  answerFor, answerMany, buildFindSnapshot, freshnessOf, originForFacility, originForPoint, originForVillage, PATIENT_REPORT_ACTOR, type FindSnapshot,
} from "../../lib/find/answer";
import { answerCopy, freshnessText, smsSummary, speakText } from "../../lib/find/copy";

const state = createInitialState();
const snap = buildFindSnapshot(state, assessDistrict(state));
const at = (id: string) => originForFacility(snap.facilities, id)!;

describe("public snapshot", () => {
  it("never carries shelf counts", () => {
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/"stock"|"dailyUse"|"quantity"|"history"/);
    for (const r of snap.rows) expect(Object.keys(r).sort()).toEqual(["at", "band", "f", "m", "verified"]);
  });
  it("leaves the warehouse out", () => {
    expect(snap.facilities.some((f) => f.type === "WAREHOUSE")).toBe(false);
    expect(snap.rows.some((r) => r.f === "warehouse-sehore")).toBe(false);
  });
  it("bands stock as available / low / out", () => {
    const band = (f: string, m: string) => snap.rows.find((r) => r.f === f && r.m === m)?.band;
    expect(band("tulsipur", "salbutamol-inhaler")).toBe("out");
    expect(band("saraswati", "metformin-500")).toBe("low");
    expect(band("kalyanpur", "metformin-500")).toBe("available");
  });
});

describe("freshness", () => {
  it("grades report age", () => {
    expect(freshnessOf("2026-10-10T09:00:00+05:30", "2026-10-10T09:42:00+05:30")).toBe("today");
    expect(freshnessOf("2026-10-08T09:00:00+05:30", "2026-10-10T09:42:00+05:30")).toBe("recent");
    expect(freshnessOf("2026-10-05T09:00:00+05:30", "2026-10-10T09:42:00+05:30")).toBe("old");
    expect(freshnessOf("2026-09-30T09:00:00+05:30", "2026-10-10T09:42:00+05:30")).toBe("stale");
  });
  it("says when it was verified", () => {
    const o = { reportedAt: "2026-10-10T04:12:00.000Z", verified: true, freshness: "today" as const };
    expect(freshnessText(o, state.now, "en")).toBe("verified today 09:42");
    expect(freshnessText(o, state.now, "hi")).toBe("आज 09:42 जाँचा गया");
  });
});

describe("answers", () => {
  it("answers 'here, but low' for metformin at Saraswati", () => {
    const a = answerFor(snap, at("saraswati"), "metformin-500");
    expect(a.kind).toBe("here_low");
    expect(a.go?.facilityId).toBe("saraswati");
    expect(answerCopy(a, "en").headline).toBe("Available at Saraswati PHC");
  });

  it("sends someone elsewhere when the home PHC is out", () => {
    const a = answerFor(snap, at("tulsipur"), "salbutamol-inhaler");
    expect(a.kind).toBe("elsewhere");
    expect(a.homeIssue).toBe("out");
    expect(a.go).not.toBeNull();
    expect(a.go!.facilityId).not.toBe("tulsipur");
    expect(a.go!.band).not.toBe("out");
    expect(answerCopy(a, "en").headline).toMatch(/^Not at your PHC\. Nearest with stock: .+, \d+ km$/);
    expect(a.others.map((o) => o.distanceKm)).toEqual([...a.others.map((o) => o.distanceKm)].sort((x, y) => x - y));
  });

  it("mentions a transfer already on the way", () => {
    const a = answerFor(snap, at("madhavgarh"), "ors-sachet");
    expect(a.home?.arrivingInHours).not.toBeNull();
    expect(answerCopy(a, "en").arriving).toMatch(/^Stock arriving at your PHC in about \d+ hours?$/);
  });

  it("does not trust a stale or unverified home report", () => {
    expect(answerFor(snap, at("bhimpura"), "paracetamol-500").homeIssue).toBe("stale");
    expect(answerFor(snap, at("hirapur"), "telmisartan-40").homeIssue).toBe("unverified");
  });

  it("says nowhere, with the supply note, when no centre has it", () => {
    const empty: FindSnapshot = { ...snap, rows: snap.rows.map((r) => (r.m === "amlodipine-5" ? { ...r, band: "out" as const } : r)) };
    const a = answerFor(empty, at("saraswati"), "amlodipine-5");
    expect(a.kind).toBe("nowhere");
    expect(a.go).toBeNull();
    expect(answerCopy(a, "en").supply).toMatch(/delayed/);
    expect(answerCopy(a, "hi").headline).toContain("अभी नहीं है");
  });

  it("treats a patient stockout report as a reason not to send people there", () => {
    const next = districtReducer(state, {
      type: "ADD_TIMELINE",
      event: { id: "pr-1", at: state.now, kind: "alert", title: "Patient report", facilityId: "kalyanpur", medicineId: "metformin-500", actor: PATIENT_REPORT_ACTOR },
    });
    const s2 = buildFindSnapshot(next, assessDistrict(next));
    const a = answerFor(s2, at("kalyanpur"), "metformin-500");
    expect(a.home?.patientReports).toBe(1);
    expect(a.homeIssue).toBe("reported_out");
  });

  it("measures distance from a village", () => {
    const o = originForVillage(snap.facilities, "v-khajuria")!;
    expect(o.homeFacilityId).toBe("saraswati");
    expect(answerFor(snap, o, "metformin-500").home!.distanceKm).toBeGreaterThan(0);
  });

  it("finds the nearest PHC to a GPS fix, or none outside the district", () => {
    expect(originForPoint(snap.facilities, 23.26, 76.97)?.homeFacilityId).toBe("saraswati");
    expect(originForPoint(snap.facilities, 28.61, 77.21)).toBeNull(); // Delhi
  });
});

describe("speech and SMS", () => {
  it("speaks distances as words", () => {
    const a = answerFor(snap, at("tulsipur"), "salbutamol-inhaler");
    expect(speakText(a, "hi")).toContain("किलोमीटर");
    expect(speakText(a, "hi")).not.toContain("km");
  });
  it("summarises several medicines for an ASHA worker", () => {
    const answers = answerMany(snap, at("saraswati"), ["metformin-500", "amlodipine-5", "paracetamol-500"]);
    const sms = smsSummary(answers, at("saraswati"), state.now, "hi");
    const lines = sms.split("\n");
    expect(lines[0]).toBe("दवा दोस्त: सरस्वती PHC - 10/10 09:42");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toMatch(/^1\. मेटफॉर्मिन: /);
    expect(sms).not.toMatch(/\bstrips?\b|\d+ स्ट्रिप/);
  });
});
