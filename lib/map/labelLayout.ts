// OWNER: map agent. Greedy screen-space placement for transfer quantity pills so they never sit on
// facility markers, facility labels or each other. Renderer-agnostic: callers pass a projector.
import { pointOnArc, type LngLat } from "./geometry";
import type { MapFacility, MapFlow } from "./model";

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type PillPlacement = { id: string; at: LngLat; dx: number; dy: number };

const STATUS_PRIORITY: Record<string, number> = { in_transit: 0, approved: 1, proposed: 2, opportunity: 3, delivered: 4 };
const T_CANDIDATES = [0.5, 0.38, 0.62, 0.28, 0.72];
const D_CANDIDATES = [15, 27, -15, -27, 40];

function hit(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** Rough pill size from its visible text (monospace ~6.4px per char at 10.5px + padding). */
export function pillSize(text: string): { w: number; h: number } {
  const plain = text.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, "x");
  return { w: plain.length * 6.4 + 16, h: 18 };
}

/** Screen boxes of overlay panels (elements marked data-overlay) relative to `origin`. */
export function overlayObstacles(origin: Element | null): Box[] {
  const root = origin?.closest("section");
  if (!origin || !root) return [];
  const o = origin.getBoundingClientRect();
  return Array.from(root.querySelectorAll("[data-overlay]")).map((el) => {
    const r = el.getBoundingClientRect();
    return { x0: r.left - o.left - 4, y0: r.top - o.top - 4, x1: r.right - o.left + 4, y1: r.bottom - o.top + 4 };
  });
}

export function facilityObstacles(
  facilities: MapFacility[],
  project: (ll: LngLat) => [number, number],
  scale: number,
  labelled: Set<string>,
): Box[] {
  const out: Box[] = [];
  for (const f of facilities) {
    const [x, y] = project(f.lngLat);
    const r = f.radius * scale + 5;
    out.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });
    if (labelled.has(f.id)) {
      const w = f.name.length * 6.3 + 14;
      if (f.type === "WAREHOUSE") out.push({ x0: x + r, y0: y - 10, x1: x + r + w, y1: y + 10 });
      else out.push({ x0: x - w / 2, y0: y + r + 2, x1: x + w / 2, y1: y + r + 22 });
    }
  }
  return out;
}

/**
 * Places pills greedily (most important first). Each pill tries a few points along its arc and a
 * few distances off either side of it; if nothing is free it is dropped (still reachable by hover).
 */
export function placePills(
  flows: { flow: MapFlow; text: string; focus: boolean }[],
  project: (ll: LngLat) => [number, number],
  obstacles: Box[],
  bounds: { w: number; h: number },
): PillPlacement[] {
  const taken = [...obstacles];
  const sorted = [...flows].sort(
    (a, b) =>
      Number(b.focus) - Number(a.focus) ||
      Number(b.flow.primary) - Number(a.flow.primary) ||
      (STATUS_PRIORITY[a.flow.status] ?? 9) - (STATUS_PRIORITY[b.flow.status] ?? 9),
  );
  const out: PillPlacement[] = [];
  for (const { flow, text, focus } of sorted) {
    const { w, h } = pillSize(text);
    let placed: PillPlacement | null = null;
    outer: for (const t of T_CANDIDATES) {
      const at = pointOnArc(flow.arc, t);
      const [x, y] = project(at);
      for (const d of D_CANDIDATES) {
        const dx = flow.arc.normal[0] * d;
        const dy = flow.arc.normal[1] * d;
        const box = { x0: x + dx - w / 2, y0: y + dy - h / 2, x1: x + dx + w / 2, y1: y + dy + h / 2 };
        if (box.x0 < 4 || box.y0 < 4 || box.x1 > bounds.w - 4 || box.y1 > bounds.h - 4) continue;
        if (taken.some((o) => hit(o, box))) continue;
        taken.push(box);
        placed = { id: flow.id, at, dx, dy };
        break outer;
      }
    }
    if (!placed && focus) {
      // the focused route always gets its label, at the apex
      placed = { id: flow.id, at: flow.mid, dx: flow.labelOffset[0], dy: flow.labelOffset[1] };
    }
    if (placed) out.push(placed);
  }
  return out;
}
