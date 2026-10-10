// OWNER: map agent. Canvas-drawn facility glyphs and route chevrons for MapLibre symbol layers.
// Also exports matching SVG path builders so the fallback renderer draws identical shapes.
import type { RiskLevel } from "../district/types";
import type { MapPalette } from "./palette";

export const ICON_PIXEL_RATIO = 2;
export type HubType = "WAREHOUSE" | "DH" | "CHC";
export const RISK_KEYS: (RiskLevel | "none")[] = ["stockout", "critical", "low", "ok", "surplus", "none"];

export type IconImage = { id: string; width: number; height: number; data: Uint8ClampedArray; pixelRatio: number };

function canvas(size: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c.getContext("2d");
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHub(ctx: CanvasRenderingContext2D, type: HubType, fill: string, p: MapPalette, s: number) {
  const c = s / 2;
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(20,19,15,0.28)";
  ctx.shadowBlur = s * 0.08;
  ctx.shadowOffsetY = s * 0.03;
  if (type === "WAREHOUSE") {
    // ink tile with a stacked-box glyph — the district's source of supply
    roundRect(ctx, s * 0.12, s * 0.12, s * 0.76, s * 0.76, s * 0.16);
    ctx.fillStyle = p.ink;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = s * 0.05;
    ctx.strokeStyle = fill;
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = s * 0.055;
    ctx.beginPath();
    // roof
    ctx.moveTo(s * 0.28, s * 0.44);
    ctx.lineTo(c, s * 0.3);
    ctx.lineTo(s * 0.72, s * 0.44);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(s * 0.33, s * 0.47, s * 0.34, s * 0.24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.33, s * 0.59);
    ctx.lineTo(s * 0.67, s * 0.59);
    ctx.stroke();
    return;
  }
  if (type === "DH") {
    roundRect(ctx, s * 0.14, s * 0.14, s * 0.72, s * 0.72, s * 0.2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = s * 0.06;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    const a = s * 0.09, b = s * 0.26;
    ctx.fillRect(c - a, c - b, a * 2, b * 2);
    ctx.fillRect(c - b, c - a, b * 2, a * 2);
    return;
  }
  // CHC — diamond with a centre dot
  ctx.beginPath();
  ctx.moveTo(c, s * 0.08);
  ctx.lineTo(s * 0.92, c);
  ctx.lineTo(c, s * 0.92);
  ctx.lineTo(s * 0.08, c);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = s * 0.06;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, s * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
}

function toImage(id: string, ctx: CanvasRenderingContext2D, size: number): IconImage {
  const img = ctx.getImageData(0, 0, size, size);
  return { id, width: size, height: size, data: img.data, pixelRatio: ICON_PIXEL_RATIO };
}

export function hubIconId(type: HubType, risk: RiskLevel | "none"): string {
  return `dd-${type}-${risk}`;
}

export function buildIcons(p: MapPalette): IconImage[] {
  const out: IconImage[] = [];
  const size = 30 * ICON_PIXEL_RATIO;
  for (const type of ["WAREHOUSE", "DH", "CHC"] as HubType[]) {
    for (const risk of RISK_KEYS) {
      const ctx = canvas(size);
      if (!ctx) return out;
      drawHub(ctx, type, risk === "none" ? p.unknown : p.risk[risk], p, size);
      out.push(toImage(hubIconId(type, risk), ctx, size));
    }
  }
  // Route chevrons: one per tone
  const chevSize = 14 * ICON_PIXEL_RATIO;
  const tones: [string, string][] = [
    ["dd-chev-accent", p.accent],
    ["dd-chev-ink", p.ink2],
    ["dd-chev-surplus", p.risk.surplus],
  ];
  for (const [id, color] of tones) {
    const ctx = canvas(chevSize);
    if (!ctx) return out;
    const s = chevSize;
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.16;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(s * 0.34, s * 0.24);
    ctx.lineTo(s * 0.66, s * 0.5);
    ctx.lineTo(s * 0.34, s * 0.76);
    ctx.stroke();
    out.push(toImage(id, ctx, s));
  }
  return out;
}

/** SVG path for a hub glyph outline centred at 0,0 with half-size `h`. */
export function hubOutlinePath(type: HubType, h: number): string {
  if (type === "CHC") return `M0 ${-h} L${h} 0 L0 ${h} L${-h} 0Z`;
  const r = h * 0.4;
  return `M${-h + r} ${-h} H${h - r} Q${h} ${-h} ${h} ${-h + r} V${h - r} Q${h} ${h} ${h - r} ${h} H${-h + r} Q${-h} ${h} ${-h} ${h - r} V${-h + r} Q${-h} ${-h} ${-h + r} ${-h}Z`;
}
