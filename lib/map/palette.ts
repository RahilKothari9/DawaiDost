// OWNER: map agent. Resolves shared CSS tokens into concrete colours for WebGL/SVG paint.
import type { RiskLevel, TransferStatus } from "../district/types";

export type MapPalette = {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentSoft: string;
  risk: Record<RiskLevel, string>;
  unknown: string;
  // basemap
  land: string;
  water: string;
  waterLine: string;
  road: string;
  roadMajor: string;
  green: string;
  label: string;
};

export const DEFAULT_PALETTE: MapPalette = {
  bg: "#f2f0e9",
  surface: "#fbfaf6",
  surface2: "#ebe8df",
  ink: "#14130f",
  ink2: "#3b3a35",
  muted: "#77746b",
  line: "#dcd8cc",
  lineStrong: "#b9b4a5",
  accent: "#2f4a78",
  accentSoft: "#e4e8ef",
  risk: { stockout: "#8e2c22", critical: "#b65a32", low: "#a9842f", ok: "#63806a", surplus: "#4a7880" },
  unknown: "#a6a196",
  land: "#efece3",
  water: "#cdd6d3",
  waterLine: "#b8c5c2",
  road: "#e2ddcf",
  roadMajor: "#d6cfbd",
  green: "#e4e5d5",
  label: "#8d897e",
};

export function readPalette(el: Element | null): MapPalette {
  if (!el || typeof window === "undefined") return DEFAULT_PALETTE;
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const d = DEFAULT_PALETTE;
  return {
    ...d,
    bg: v("--bg", d.bg),
    surface: v("--surface", d.surface),
    surface2: v("--surface-2", d.surface2),
    ink: v("--ink", d.ink),
    ink2: v("--ink-2", d.ink2),
    muted: v("--muted", d.muted),
    line: v("--line", d.line),
    lineStrong: v("--line-strong", d.lineStrong),
    accent: v("--accent", d.accent),
    accentSoft: v("--accent-soft", d.accentSoft),
    risk: {
      stockout: v("--risk-stockout", d.risk.stockout),
      critical: v("--risk-critical", d.risk.critical),
      low: v("--risk-low", d.risk.low),
      ok: v("--risk-ok", d.risk.ok),
      surplus: v("--risk-surplus", d.risk.surplus),
    },
  };
}

export const RISK_ORDER: RiskLevel[] = ["stockout", "critical", "low", "ok", "surplus"];

export const RISK_LABEL: Record<RiskLevel, string> = {
  stockout: "Stocked out",
  critical: "Critical",
  low: "Low",
  ok: "Healthy",
  surplus: "Surplus",
};

export const STATUS_LABEL: Record<TransferStatus | "opportunity", string> = {
  opportunity: "Opportunity",
  proposed: "Proposed",
  approved: "Approved",
  in_transit: "In transit",
  delivered: "Delivered",
  rejected: "Rejected",
};

/** Colour stops for the days-of-stock coverage surface (value = days / threshold). */
export function coverageStops(p: MapPalette): [number, string][] {
  return [
    [0, p.risk.stockout],
    [0.35, p.risk.critical],
    [0.75, p.risk.low],
    [1.25, p.risk.ok],
    [2.4, p.risk.surplus],
  ];
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Interpolate the coverage ramp in JS (for the SVG fallback). */
export function coverageColor(p: MapPalette, ratio: number): string {
  const stops = coverageStops(p);
  if (ratio <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (ratio <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (ratio - a) / (b - a);
      const ra = hexToRgb(ca), rb = hexToRgb(cb);
      if (!ra || !rb) return cb;
      const c = ra.map((x, k) => Math.round(x + (rb[k] - x) * t));
      return `rgb(${c[0]} ${c[1]} ${c[2]})`;
    }
  }
  return stops[stops.length - 1][1];
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}
