"use client";
// OWNER: analytics agent. Positioned tooltip used by every analytics chart. Values lead, labels follow.
import type { ReactNode } from "react";
import s from "./bits.module.css";

export type TipRow = { label: ReactNode; value: ReactNode; color?: string; kind?: "line" | "dot" | "blank" };

export type ChartTooltipProps = {
  /** Anchor point in the container's coordinate space (px). */
  x: number;
  y: number;
  containerWidth: number;
  title?: ReactNode;
  rows: TipRow[];
  note?: ReactNode;
  width?: number;
};

export function ChartTooltip({ x, y, containerWidth, title, rows, note, width = 190 }: ChartTooltipProps) {
  const gap = 14;
  const flip = x + gap + width > containerWidth;
  const left = flip ? Math.max(0, x - gap - width) : x + gap;
  return (
    <div className={s.tip} style={{ left, top: Math.max(0, y), width }} role="presentation">
      {title && <p className={s.tipTitle}>{title}</p>}
      {rows.map((r, i) => (
        <div key={i} className={s.tipRow}>
          <i
            className={[s.tipKey, r.kind === "dot" && s.dot, (r.kind === "blank" || !r.color) && s.blank].filter(Boolean).join(" ")}
            style={r.color ? { background: r.color } : undefined}
          />
          <span>{r.label}</span>
          <strong>{r.value}</strong>
        </div>
      ))}
      {note && <p className={s.tipNote}>{note}</p>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.empty} role="status">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}
