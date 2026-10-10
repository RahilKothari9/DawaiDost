"use client";
// OWNER: analytics agent. Tiny trend line: de-emphasised line, current point carries the status color.
import { useId } from "react";
import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { area, line, curveMonotoneX } from "d3-shape";
import type { RiskLevel } from "@/lib/district/types";
import { RISK_VAR } from "@/lib/analytics/metrics";
import s from "./bits.module.css";

export type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  /** Values below this get a faint warning band. */
  threshold?: number;
  /** Colors the end dot. */
  risk?: RiskLevel;
  /** Explicit end-dot color (overrides risk). */
  color?: string;
  /** Draw a 10% wash under the line. */
  fill?: boolean;
  /** Force y-domain to start at zero (default true). */
  zero?: boolean;
  ariaLabel?: string;
  className?: string;
};

export function Sparkline({ values, width = 84, height = 24, threshold, risk, color, fill = false, zero = true, ariaLabel, className }: SparklineProps) {
  const clipId = useId();
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) {
    return (
      <svg className={[s.spark, className].filter(Boolean).join(" ")} width={width} height={height} role="img" aria-label={ariaLabel ?? "Not enough history"}>
        <line x1={0} x2={width} y1={height - 1.5} y2={height - 1.5} stroke="var(--line)" strokeWidth={1} />
      </svg>
    );
  }
  const pad = 3;
  const [lo, hi] = extent(threshold !== undefined ? [...vals, threshold] : vals) as [number, number];
  const y = scaleLinear().domain([zero ? Math.min(0, lo) : lo, hi === lo ? hi + 1 : hi]).range([height - pad, pad]);
  const x = scaleLinear().domain([0, vals.length - 1]).range([pad, width - pad]);
  const pts = vals.map((v, i) => [x(i), y(v)] as [number, number]);
  const path = line().curve(curveMonotoneX)(pts) ?? "";
  const wash = fill ? area().curve(curveMonotoneX).y0(height - pad)(pts) ?? "" : "";
  const end = pts[pts.length - 1]!;
  const dot = color ?? (risk ? RISK_VAR[risk] : "var(--ink)");
  return (
    <svg
      className={[s.spark, className].filter(Boolean).join(" ")}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `Trend over ${vals.length} points, latest ${Math.round(vals[vals.length - 1]!)}`}
    >
      {threshold !== undefined && y(threshold) < height - pad && (
        <>
          <clipPath id={clipId}><rect x={0} y={y(threshold)} width={width} height={height} /></clipPath>
          <rect x={0} y={y(threshold)} width={width} height={Math.max(0, height - pad - y(threshold))} fill="var(--risk-low)" opacity={0.12} />
          <line x1={0} x2={width} y1={y(threshold)} y2={y(threshold)} stroke="var(--risk-low)" strokeWidth={1} strokeDasharray="2 2" opacity={0.8} />
        </>
      )}
      {wash && <path d={wash} fill="var(--ink)" opacity={0.08} />}
      <path d={path} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {threshold !== undefined && (
        <path d={path} fill="none" stroke="var(--risk-critical)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipId})`} />
      )}
      <circle cx={end[0]} cy={end[1]} r={3.5} fill={dot} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
