import { describe, expect, it } from "vitest";
import type { DecisionRecord, TimelineEvent } from "../../lib/district/types";
import { activeEscalation, deriveEscalations, nextStage, parseEscalationEventId, stageEvent, type EscalationStage } from "../../lib/escalations/lifecycle";

const ev = (stage: EscalationStage, at: string, detail?: string): TimelineEvent =>
  stageEvent({ escalationId: "esc-amlo-1", medicineId: "amlo", stage, at, actor: "DHO", title: stage, detail, nonce: at });

const decision = (id: string, createdAt: string, action: DecisionRecord["action"] = "escalate_supply_gap"): DecisionRecord => ({
  id, facilityId: "a", medicineId: "amlo", action, confidence: 0.8,
  probabilities: { verify_count: 0, transfer_surplus: 0, draft_indent: 0.2, escalate_supply_gap: 0.8 },
  source: "live", snapshot: {}, status: "pending", createdAt,
});

describe("escalation lifecycle", () => {
  it("round-trips event ids", () => {
    const e = ev("sent", "2026-10-10T10:00:00Z");
    expect(parseEscalationEventId(e.id)).toEqual({ escalationId: "esc-amlo-1", stage: "sent" });
    expect(parseEscalationEventId("ev-seed-01")).toBeNull();
  });

  it("replays a newest-first timeline into stage history", () => {
    const timeline = [ev("sent", "2026-10-10T11:00:00Z", "ref: DHO/SEH/ESC/1"), ev("draft", "2026-10-10T10:00:00Z", "decisions: d1")];
    const [esc] = deriveEscalations(timeline);
    expect(esc.stage).toBe("sent");
    expect(esc.history.map((h) => h.stage)).toEqual(["draft", "sent"]);
    expect(esc.decisionIds).toEqual(["d1"]);
    expect(esc.memoRef).toBe("DHO/SEH/ESC/1");
    expect(activeEscalation([esc], "amlo")?.id).toBe("esc-amlo-1");
  });

  it("links escalate_supply_gap decisions for the medicine only", () => {
    const [esc] = deriveEscalations([ev("draft", "2026-10-10T10:00:00Z")], [decision("d2", "2026-10-10T09:00:00Z"), decision("d3", "2026-10-10T09:00:00Z", "transfer_surplus")]);
    expect(esc.decisionIds).toEqual(["d2"]);
  });

  it("stops linking new decisions once resolved and frees the medicine", () => {
    const timeline = [ev("resolved", "2026-10-11T10:00:00Z"), ev("draft", "2026-10-10T10:00:00Z")];
    const list = deriveEscalations(timeline, [decision("late", "2026-10-12T00:00:00Z")]);
    expect(list[0].decisionIds).toEqual([]);
    expect(activeEscalation(list, "amlo")).toBeUndefined();
    expect(nextStage("resolved")).toBeNull();
    expect(nextStage("draft")).toBe("sent");
  });
});
