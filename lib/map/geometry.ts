// OWNER: map agent. Pure geometry helpers for the district map (arcs, hull, coverage grid).
// Coordinates are [lng, lat]. Distances that matter for drawing use a local equirectangular
// projection so curves look even at district scale (~100 km).

export type LngLat = [number, number];

const K = Math.PI / 180;

/** Local planar frame around a reference latitude (x scaled by cos(lat)). */
function toPlane([lng, lat]: LngLat, cosLat: number): [number, number] {
  return [lng * cosLat, lat];
}
function fromPlane([x, y]: [number, number], cosLat: number): LngLat {
  return [x / cosLat, y];
}

export type Arc = {
  coords: LngLat[];
  /** Control point of the quadratic bezier (planar), kept for point-at-t evaluation. */
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  cosLat: number;
};

/**
 * Quadratic bezier arc from `a` to `b`, bowed to the left of travel direction so
 * A→B and B→A never overlap. `bend` is the control-point offset as a share of length.
 */
export function makeArc(a: LngLat, b: LngLat, bend = 0.24, samples = 48): Arc {
  const cosLat = Math.cos(((a[1] + b[1]) / 2) * K);
  const p0 = toPlane(a, cosLat);
  const p2 = toPlane(b, cosLat);
  const dx = p2[0] - p0[0];
  const dy = p2[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  // left-hand normal
  const nx = -dy / len;
  const ny = dx / len;
  const p1: [number, number] = [(p0[0] + p2[0]) / 2 + nx * len * bend, (p0[1] + p2[1]) / 2 + ny * len * bend];
  const arc: Arc = { coords: [], p0, p1, p2, cosLat };
  for (let i = 0; i <= samples; i++) arc.coords.push(pointOnArc(arc, i / samples));
  return arc;
}

export function pointOnArc(arc: Arc, t: number): LngLat {
  const u = 1 - t;
  const x = u * u * arc.p0[0] + 2 * u * t * arc.p1[0] + t * t * arc.p2[0];
  const y = u * u * arc.p0[1] + 2 * u * t * arc.p1[1] + t * t * arc.p2[1];
  return fromPlane([x, y], arc.cosLat);
}

/** Heading in degrees (0 = east, counter-clockwise) of the arc tangent at t, in planar space. */
export function tangentOnArc(arc: Arc, t: number): number {
  const dx = 2 * (1 - t) * (arc.p1[0] - arc.p0[0]) + 2 * t * (arc.p2[0] - arc.p1[0]);
  const dy = 2 * (1 - t) * (arc.p1[1] - arc.p0[1]) + 2 * t * (arc.p2[1] - arc.p1[1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Sub-section of the arc between t0 and t1 (used for the travelled part of a route). */
export function arcSlice(arc: Arc, t0: number, t1: number, samples = 24): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i <= samples; i++) out.push(pointOnArc(arc, t0 + ((t1 - t0) * i) / samples));
  return out;
}

/** Andrew's monotone chain convex hull. Returns a closed ring. */
export function convexHull(points: LngLat[]): LngLat[] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts.length ? [...pts, pts[0]] : [];
  const cross = (o: LngLat, a: LngLat, b: LngLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: LngLat[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: LngLat[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const ring = lower.slice(0, -1).concat(upper.slice(0, -1));
  ring.push(ring[0]);
  return ring;
}

/**
 * A soft, organic "district outline": the convex hull of facilities, pushed outward by
 * `padKm` and smoothed with Chaikin subdivision. Purely illustrative — not a real boundary.
 */
export function districtOutline(points: LngLat[], padKm = 9): LngLat[] {
  if (points.length === 0) return [];
  const cLat = points.reduce((s, p) => s + p[1], 0) / points.length;
  const cosLat = Math.cos(cLat * K);
  const padDeg = padKm / 111;
  // Expand every point into a small octagon, then hull — equivalent to a rounded buffer.
  const expanded: LngLat[] = [];
  for (const [lng, lat] of points) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      expanded.push([lng + (Math.cos(a) * padDeg) / cosLat, lat + Math.sin(a) * padDeg]);
    }
  }
  let ring = convexHull(expanded).slice(0, -1);
  for (let iter = 0; iter < 2; iter++) {
    const next: LngLat[] = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      next.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
      next.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    ring = next;
  }
  ring.push(ring[0]);
  return ring;
}

export function pointInRing([x, y]: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(points: LngLat[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export type CoverageSample = { at: LngLat; value: number; weight: number };
export type CoverageCell = { ring: LngLat[]; center: LngLat; value: number };

/**
 * Inverse-distance-weighted surface of a value (days of stock) on a square grid,
 * clipped to `clip`. `weight` lets bigger catchments pull harder.
 */
export function coverageGrid(samples: CoverageSample[], clip: LngLat[], cols = 96): CoverageCell[] {
  if (samples.length === 0 || clip.length < 4) return [];
  const [minX, minY, maxX, maxY] = bbox(clip);
  const cLat = (minY + maxY) / 2;
  const cosLat = Math.cos(cLat * K);
  const step = (maxX - minX) / cols;
  const stepY = step * cosLat; // square cells on the ground
  const cells: CoverageCell[] = [];
  for (let y = minY; y < maxY; y += stepY) {
    for (let x = minX; x < maxX; x += step) {
      const center: LngLat = [x + step / 2, y + stepY / 2];
      if (!pointInRing(center, clip)) continue;
      let num = 0, den = 0, nearest = Infinity, nearestVal = 0;
      for (const s of samples) {
        const dx = (s.at[0] - center[0]) * cosLat;
        const dy = s.at[1] - center[1];
        const d2 = dx * dx + dy * dy;
        if (d2 < nearest) { nearest = d2; nearestVal = s.value; }
        const w = s.weight / Math.pow(d2 + 1e-5, 1.4);
        num += w * s.value;
        den += w;
      }
      const value = nearest < 1e-6 ? nearestVal : num / den;
      cells.push({
        center,
        value,
        ring: [[x, y], [x + step, y], [x + step, y + stepY], [x, y + stepY], [x, y]],
      });
    }
  }
  return cells;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
