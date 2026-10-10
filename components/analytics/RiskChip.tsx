"use client";
// OWNER: analytics agent. Risk status chip: shape icon + label (never color alone).
import { ArrowDownRight, Check, Layers, OctagonX, TriangleAlert, type LucideIcon } from "lucide-react";
import type { RiskLevel } from "@/lib/district/types";
import { fmtDays } from "@/lib/analytics/format";
import { RISK_LABEL, RISK_SHORT, RISK_VAR } from "@/lib/analytics/metrics";
import s from "./bits.module.css";

export const RISK_ICON: Record<RiskLevel, LucideIcon> = {
  stockout: OctagonX,
  critical: TriangleAlert,
  low: ArrowDownRight,
  ok: Check,
  surplus: Layers,
};

export type RiskChipProps = {
  risk: RiskLevel;
  /** Optional days of stock shown in mono after the label. */
  days?: number;
  size?: "sm" | "md";
  /** "short" = Out / Critical / Low / OK / Surplus; "none" = icon only (label kept for screen readers). */
  label?: "long" | "short" | "none";
  className?: string;
};

export function RiskChip({ risk, days, size = "md", label = "short", className }: RiskChipProps) {
  const Icon = RISK_ICON[risk];
  const text = label === "long" ? RISK_LABEL[risk] : RISK_SHORT[risk];
  const cls = [s.chip, size === "sm" && s.chipSm, label === "none" && days === undefined && s.iconOnly, className].filter(Boolean).join(" ");
  return (
    <span className={cls} data-risk={risk} title={RISK_LABEL[risk]}>
      <Icon aria-hidden style={{ color: RISK_VAR[risk] }} strokeWidth={2.4} />
      {label === "none" ? <span className={s.srOnly}>{RISK_LABEL[risk]}</span> : <span>{text}</span>}
      {days !== undefined && <span className={s.chipDays}>{fmtDays(days)}d</span>}
    </span>
  );
}
