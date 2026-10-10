// OWNER: evals agent.
import type { DecisionAction } from "@/lib/district/types";

export const ACTION_SHORT: Record<DecisionAction, string> = {
  verify_count: "Verify",
  transfer_surplus: "Transfer",
  draft_indent: "Indent",
  escalate_supply_gap: "Escalate",
};

export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(digits)}%`);
export const num = (x: number | null | undefined, digits = 3) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : x.toFixed(digits));
export const ms = (x: number | null | undefined) => (x === null || x === undefined ? "–" : x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);
export const int = (x: number | null | undefined) => (x === null || x === undefined ? "–" : Math.round(x).toLocaleString("en-IN"));
