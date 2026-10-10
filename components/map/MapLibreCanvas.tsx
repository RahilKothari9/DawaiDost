"use client";
// OWNER: map agent. WebGL renderer for the district map (MapLibre GL). Everything that moves
// (flowing dashes, consignment dots, pulses, arrival pings) is driven by MapAnimator through
// paint properties / GeoJSON setData — never by React re-renders.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent, Marker, StyleSpecification } from "maplibre-gl";
import { DASH_SEQUENCE, type Frame, type MapAnimator } from "@/lib/map/animator";
import { BASEMAP_URL, restyleBasemap } from "@/lib/map/basemap";
import { arcSlice, easeInOut, pointOnArc, type LngLat } from "@/lib/map/geometry";
import { buildIcons, hubIconId, type HubType } from "@/lib/map/icons";
import { flowProgress, type MapFlow, type MapModel } from "@/lib/map/model";
import { coverageStops, type MapPalette } from "@/lib/map/palette";
import type { LayerVisibility } from "./layers";
import { flowLabelText, facilityLabelVisible } from "./labels";
import styles from "./DistrictMap.module.css";

type Pt = { x: number; y: number };

export type MapLibreCanvasProps = {
  model: MapModel;
  palette: MapPalette;
  layers: LayerVisibility;
  variant: "full" | "compact";
  selectedFacilityId: string | null;
  selectedFlowId: string | null;
  hoveredFacilityId: string | null;
  animator: MapAnimator;
  unitShort: string;
  padding: { top: number; bottom: number; left: number; right: number };
  onHoverFacility: (id: string | null, pt: Pt | null) => void;
  onHoverFlow: (id: string | null, pt: Pt | null) => void;
  onClickFacility: (id: string) => void;
  onClickFlow: (id: string | null) => void;
  onFail: (reason: string) => void;
  onReady: (info: { basemap: boolean }) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Expr = any;
type FC = GeoJSON.FeatureCollection;

const EMPTY: FC = { type: "FeatureCollection", features: [] };
const FLOW_LAYERS = [
  "dd-flow-opportunity",
  "dd-flow-delivered",
  "dd-flow-proposed",
  "dd-flow-approved",
  "dd-flow-transit-base",
  "dd-flow-transit-dash",
  "dd-trail",
  "dd-chevrons",
  "dd-flow-hl",
  "dd-flow-hit",
  "dd-cons-glow",
  "dd-cons-dot",
  "dd-ping",
];
const FAC_LAYERS = ["dd-fac-phc", "dd-fac-hub"];

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function blankStyle(p: MapPalette): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": p.land } }] };
}

async function loadBasemap(p: MapPalette, signal: AbortSignal): Promise<StyleSpecification | null> {
  try {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 6000));
    const res = await Promise.race([fetch(BASEMAP_URL, { signal }), timeout]);
    if (!res || !res.ok) return null;
    const json = (await res.json()) as StyleSpecification;
    return restyleBasemap(json, p);
  } catch {
    return null;
  }
}

function signedArea(ring: LngLat[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}

function radiusExpr(extra: number | Expr = 0, scale = 1): Expr {
  const r = ["*", ["get", "r"], scale];
  return ["interpolate", ["linear"], ["zoom"], 7, ["+", ["*", r, 0.72], extra], 10, ["+", r, extra], 13, ["+", ["*", r, 1.55], extra]];
}

function riskColorExpr(p: MapPalette): Expr {
  return ["match", ["get", "risk"], "stockout", p.risk.stockout, "critical", p.risk.critical, "low", p.risk.low, "ok", p.risk.ok, "surplus", p.risk.surplus, p.unknown];
}

function installLayers(map: MLMap, p: MapPalette) {
  for (const icon of buildIcons(p)) {
    if (!map.hasImage(icon.id)) map.addImage(icon.id, { width: icon.width, height: icon.height, data: icon.data }, { pixelRatio: icon.pixelRatio });
  }
  for (const id of ["dd-mask", "dd-outline", "dd-coverage", "dd-spokes", "dd-flows", "dd-motion", "dd-pings", "dd-facilities"]) {
    map.addSource(id, { type: "geojson", data: EMPTY });
  }
  const add = (layer: Expr) => map.addLayer(layer);
  const stops = coverageStops(p).flatMap(([v, c]) => [v, c]);

  add({ id: "dd-mask", type: "fill", source: "dd-mask", paint: { "fill-color": p.bg, "fill-opacity": 0.62 } });
  add({ id: "dd-coverage", type: "fill", source: "dd-coverage", paint: { "fill-color": ["interpolate", ["linear"], ["get", "v"], ...stops], "fill-opacity": 0.3, "fill-antialias": false } });
  add({ id: "dd-outline-glow", type: "line", source: "dd-outline", paint: { "line-color": p.ink, "line-opacity": 0.05, "line-width": 10, "line-blur": 6 } });
  add({ id: "dd-outline", type: "line", source: "dd-outline", paint: { "line-color": p.ink2, "line-opacity": 0.45, "line-width": 1.2, "line-dasharray": [4, 2.5] } });
  add({ id: "dd-spokes", type: "line", source: "dd-spokes", layout: { "line-cap": "round" }, paint: { "line-color": p.ink2, "line-opacity": 0.38, "line-width": 1, "line-dasharray": [0.6, 2.4] } });

  const dimOpacity = (base: number): Expr => ["*", base, ["case", ["get", "dim"], 0.28, ["get", "primary"], 1, 0.45]];
  add({ id: "dd-flow-hl", type: "line", source: "dd-flows", filter: ["all", ["get", "hl"], ["!=", ["get", "status"], "opportunity"]], layout: { "line-cap": "round" }, paint: { "line-color": p.accent, "line-opacity": 0.2, "line-width": 12, "line-blur": 4 } });
  add({ id: "dd-flow-opportunity", type: "line", source: "dd-flows", filter: ["==", ["get", "status"], "opportunity"], layout: { "line-cap": "round" }, paint: { "line-color": p.risk.surplus, "line-opacity": ["case", ["get", "hl"], 0.95, dimOpacity(0.6)], "line-width": ["case", ["get", "hl"], 2.4, 1.6], "line-dasharray": [0.5, 2] } });
  add({ id: "dd-flow-delivered", type: "line", source: "dd-flows", filter: ["==", ["get", "status"], "delivered"], layout: { "line-cap": "round" }, paint: { "line-color": p.risk.ok, "line-opacity": dimOpacity(0.42), "line-width": 1.8 } });
  add({ id: "dd-flow-proposed", type: "line", source: "dd-flows", filter: ["==", ["get", "status"], "proposed"], layout: { "line-cap": "butt" }, paint: { "line-color": p.ink2, "line-opacity": dimOpacity(0.7), "line-width": 2.2, "line-dasharray": [2.2, 1.6] } });
  add({ id: "dd-flow-approved", type: "line", source: "dd-flows", filter: ["==", ["get", "status"], "approved"], layout: { "line-cap": "round" }, paint: { "line-color": p.accent, "line-opacity": dimOpacity(0.95), "line-width": 2.8 } });
  add({ id: "dd-flow-transit-base", type: "line", source: "dd-flows", filter: ["==", ["get", "status"], "in_transit"], layout: { "line-cap": "round" }, paint: { "line-color": p.accent, "line-opacity": dimOpacity(0.22), "line-width": 4 } });
  add({ id: "dd-flow-transit-dash", type: "line", source: "dd-flows", filter: ["==", ["get", "status"], "in_transit"], paint: { "line-color": p.accent, "line-opacity": dimOpacity(1), "line-width": 2.6, "line-dasharray": DASH_SEQUENCE[0] } });
  add({ id: "dd-trail", type: "line", source: "dd-motion", filter: ["==", ["get", "kind"], "trail"], layout: { "line-cap": "round" }, paint: { "line-color": p.accent, "line-opacity": ["*", 0.85, ["case", ["get", "dim"], 0.3, 1]], "line-width": 3.4 } });
  add({
    id: "dd-chevrons",
    type: "symbol",
    source: "dd-flows",
    filter: ["match", ["get", "status"], ["approved", "in_transit", "proposed", "opportunity"], true, false],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 8, 70, 12, 120],
      "icon-image": ["match", ["get", "status"], "proposed", "dd-chev-ink", "opportunity", "dd-chev-surplus", "dd-chev-accent"],
      "icon-size": ["match", ["get", "status"], "opportunity", 0.75, 0.95],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotation-alignment": "map",
    },
    paint: { "icon-opacity": ["case", ["get", "dim"], 0.25, ["==", ["get", "status"], "opportunity"], 0.7, 1] },
  });
  add({ id: "dd-flow-hit", type: "line", source: "dd-flows", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 16 } });

  add({ id: "dd-ping", type: "circle", source: "dd-pings", paint: { "circle-radius": ["get", "rad"], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": p.risk.ok, "circle-stroke-width": 2.5, "circle-stroke-opacity": ["get", "op"] } });

  const alertFilter: Expr = ["all", ["get", "alert"], ["!=", ["get", "type"], "WAREHOUSE"]];
  const haloColor: Expr = ["match", ["get", "risk"], "stockout", p.risk.stockout, p.risk.critical];
  add({ id: "dd-halo-a", type: "circle", source: "dd-facilities", filter: alertFilter, paint: { "circle-radius": radiusExpr(8), "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": haloColor, "circle-stroke-width": 2, "circle-stroke-opacity": 0.4 } });
  add({ id: "dd-halo-b", type: "circle", source: "dd-facilities", filter: alertFilter, paint: { "circle-radius": radiusExpr(14), "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": haloColor, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.2 } });
  add({ id: "dd-fac-glow", type: "circle", source: "dd-facilities", filter: alertFilter, paint: { "circle-radius": radiusExpr(6), "circle-color": haloColor, "circle-opacity": 0.16, "circle-blur": 0.6 } });
  add({ id: "dd-fac-shadow", type: "circle", source: "dd-facilities", filter: ["==", ["get", "type"], "PHC"], paint: { "circle-radius": radiusExpr(1.5), "circle-color": p.ink, "circle-opacity": ["*", 0.22, ["get", "op"]], "circle-blur": 0.7, "circle-translate": [0, 1.5] } });
  add({
    id: "dd-fac-phc",
    type: "circle",
    source: "dd-facilities",
    filter: ["==", ["get", "type"], "PHC"],
    paint: { "circle-radius": radiusExpr(0), "circle-color": riskColorExpr(p), "circle-opacity": ["get", "op"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-stroke-opacity": ["get", "op"] },
  });
  add({
    id: "dd-fac-hub",
    type: "symbol",
    source: "dd-facilities",
    filter: ["!=", ["get", "type"], "PHC"],
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.78, 10, 1, 13, 1.35],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-opacity": ["get", "op"] },
  });
  add({ id: "dd-fac-hover", type: "circle", source: "dd-facilities", filter: ["get", "hov"], paint: { "circle-radius": radiusExpr(5), "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": p.ink2, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.6 } });
  add({ id: "dd-fac-ring", type: "circle", source: "dd-facilities", filter: ["get", "sel"], paint: { "circle-radius": radiusExpr(6), "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": p.ink, "circle-stroke-width": 2.5 } });

  add({ id: "dd-cons-glow", type: "circle", source: "dd-motion", filter: ["==", ["get", "kind"], "dot"], paint: { "circle-radius": 12, "circle-color": p.accent, "circle-opacity": ["*", 0.25, ["case", ["get", "dim"], 0.3, 1]], "circle-blur": 0.5 } });
  add({ id: "dd-cons-dot", type: "circle", source: "dd-motion", filter: ["==", ["get", "kind"], "dot"], paint: { "circle-radius": ["case", ["get", "waiting"], 4, 5.5], "circle-color": "#ffffff", "circle-stroke-color": p.accent, "circle-stroke-width": ["case", ["get", "waiting"], 2, 3], "circle-opacity": ["case", ["get", "dim"], 0.4, 1], "circle-stroke-opacity": ["case", ["get", "dim"], 0.4, 1] } });
}

class GlEngine {
  map: MLMap | null = null;
  ml: typeof import("maplibre-gl") | null = null;
  ready = false;
  dirty = true;
  fitKey = "";
  markers = new Map<string, { marker: Marker; el: HTMLDivElement }>();
  pings: { at: LngLat; start: number }[] = [];
  prevStatus = new Map<string, string>();
  lastFlown: { fac: string | null; flow: string | null } = { fac: null, flow: null };
  constructor(public props: MapLibreCanvasProps) {}

  private disposed = false;
  private abort = new AbortController();
  private loadTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubAnim: (() => void) | null = null;

  mount(container: HTMLDivElement) {
    if (!hasWebGL()) {
      this.props.onFail("WebGL unavailable");
      return;
    }
    void this.boot(container);
    this.unsubAnim = this.props.animator.subscribe((fr) => this.frame(fr));
  }

  destroy() {
    this.disposed = true;
    this.abort.abort();
    clearTimeout(this.loadTimer);
    this.unsubAnim?.();
    for (const { marker } of this.markers.values()) marker.remove();
    this.markers.clear();
    this.ready = false;
    this.map?.remove();
    this.map = null;
  }

  update(props: MapLibreCanvasProps) {
    const prev = this.props;
    this.props = props;
    if (!this.ready) return;
    if (
      prev.model !== props.model ||
      prev.layers !== props.layers ||
      prev.selectedFacilityId !== props.selectedFacilityId ||
      prev.selectedFlowId !== props.selectedFlowId ||
      prev.hoveredFacilityId !== props.hoveredFacilityId ||
      prev.variant !== props.variant
    ) {
      this.sync();
    }
    this.follow();
  }

  private async boot(container: HTMLDivElement) {
    const p = this.props.palette;
    const [ml, basemap] = await Promise.all([import("maplibre-gl"), loadBasemap(p, this.abort.signal)]);
    if (this.disposed) return;
    this.ml = ml;
    const { model, padding } = this.props;
    let map: MLMap;
    try {
      map = new ml.Map({
        container,
        style: basemap ?? blankStyle(p),
        bounds: model.bounds,
        fitBoundsOptions: { padding },
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: false,
        fadeDuration: 150,
        minZoom: 6.5,
        maxZoom: 14,
        maxBounds: [model.bounds[0] - 1.6, model.bounds[1] - 1.2, model.bounds[2] + 1.6, model.bounds[3] + 1.2],
      });
    } catch (err) {
      this.props.onFail(`MapLibre init failed: ${String(err)}`);
      return;
    }
    this.map = map;
    map.touchZoomRotate.disableRotation();

    this.loadTimer = setTimeout(() => {
      if (!this.ready) this.props.onFail("Map load timed out");
    }, 12000);

    map.on("error", (e) => {
      if (!this.ready) {
        // Basemap tile hiccups after load are tolerated; only GL failures before first load fall back.
        const msg = (e as unknown as { error?: Error }).error?.message ?? "map error";
        if (/webgl|context/i.test(msg)) this.props.onFail(msg);
      }
    });

    map.on("load", () => {
      if (this.disposed) return;
      clearTimeout(this.loadTimer);
      try {
        installLayers(map, this.props.palette);
      } catch (err) {
        this.props.onFail(`Layer setup failed: ${String(err)}`);
        return;
      }
      this.ready = true;
      this.dirty = true;
      this.fitKey = boundsKey(this.props.model);
      this.sync();
      this.bindEvents(map);
      this.lastFlown = { fac: this.props.selectedFacilityId, flow: this.props.selectedFlowId };
      this.props.onReady({ basemap: !!basemap });
    });
  }

  /** Camera follows selection changes. */
  private follow() {
    const map = this.map;
    if (!map) return;
    const { selectedFacilityId: fac, selectedFlowId: flow, model, variant, padding } = this.props;
    const last = this.lastFlown;
    const reduce = this.props.animator.reduced;
    if (flow && flow !== last.flow) {
      const f = model.flows.find((x) => x.id === flow);
      if (f) {
        const [a, b] = [f.arc.coords[0], f.arc.coords[f.arc.coords.length - 1]];
        map.fitBounds([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], {
          padding: { ...padding, top: padding.top + 40, bottom: padding.bottom + 40 },
          maxZoom: 10.5,
          duration: reduce ? 0 : 1100,
        });
      }
    } else if (fac && fac !== last.fac) {
      const f = model.facilityById.get(fac);
      if (f) {
        map.easeTo({
          center: f.lngLat,
          zoom: variant === "compact" ? map.getZoom() : Math.max(map.getZoom(), 9.4),
          duration: reduce ? 0 : 900,
          padding,
        });
      }
    }
    this.lastFlown = { fac, flow };
  }

  private dashIdx = -1;
  private lastDashT = 0;
  private lastClock = -1;

  private frame(fr: Frame) {
    const map = this.map;
    if (!map || !this.ready) return;
    const { model, layers } = this.props;
    const hasTransit = layers.transfers && model.flows.some((f) => f.status === "in_transit");

    // 1. marching dashes on in-transit routes (stepped dasharray, the classic MapLibre technique)
    if (!fr.reduced && hasTransit && fr.t - this.lastDashT > 55) {
      this.lastDashT = fr.t;
      this.dashIdx = (this.dashIdx + 1) % DASH_SEQUENCE.length;
      map.setPaintProperty("dd-flow-transit-dash", "line-dasharray", DASH_SEQUENCE[this.dashIdx]);
    }

    // 2. double pulse halo for stockout / critical facilities, breathing consignment glow
    if (!fr.reduced) {
      const phaseA = (fr.t % 2200) / 2200;
      const phaseB = ((fr.t + 1100) % 2200) / 2200;
      map.setPaintProperty("dd-halo-a", "circle-radius", radiusExpr(4 + easeInOut(phaseA) * 18));
      map.setPaintProperty("dd-halo-a", "circle-stroke-opacity", 0.55 * (1 - phaseA));
      map.setPaintProperty("dd-halo-b", "circle-radius", radiusExpr(4 + easeInOut(phaseB) * 18));
      map.setPaintProperty("dd-halo-b", "circle-stroke-opacity", 0.55 * (1 - phaseB));
      const g = 0.5 + 0.5 * Math.sin(fr.t / 260);
      map.setPaintProperty("dd-cons-glow", "circle-radius", 9 + g * 6);
    }

    // 3. consignments, travelled trail and arrival pings — only when something changed
    if (this.dirty || fr.clockMoving || this.pings.length || Math.abs(fr.displayNowMs - this.lastClock) > 1000) {
      this.lastClock = fr.displayNowMs;
      this.dirty = false;
      this.pushMotion(map, model, layers, fr);
    }
  }


  private bindEvents(map: MLMap) {
    let hoverFac: string | null = null;
    let hoverFlow: string | null = null;
    const pick = (e: MapMouseEvent) => {
      const fac = map.queryRenderedFeatures(e.point, { layers: FAC_LAYERS })[0];
      const flow = fac ? undefined : map.queryRenderedFeatures(e.point, { layers: ["dd-flow-hit"] })[0];
      return { fac: (fac?.properties?.id as string) ?? null, flow: (flow?.properties?.id as string) ?? null };
    };
    map.on("mousemove", (e) => {
      const { fac, flow } = pick(e);
      map.getCanvas().style.cursor = fac || flow ? "pointer" : "";
      const pt = { x: e.point.x, y: e.point.y };
      if (fac !== hoverFac || fac) this.props.onHoverFacility(fac, fac ? pt : null);
      if (flow !== hoverFlow || flow) this.props.onHoverFlow(flow, flow ? pt : null);
      hoverFac = fac;
      hoverFlow = flow;
    });
    map.on("mouseout", () => {
      hoverFac = hoverFlow = null;
      this.props.onHoverFacility(null, null);
      this.props.onHoverFlow(null, null);
    });
    map.on("click", (e) => {
      const { fac, flow } = pick(e);
      if (fac) this.props.onClickFacility(fac);
      else this.props.onClickFlow(flow);
    });
  }

  private sync() {
    const map = this.map;
    if (!map || !this.ready) return;
    const { model, layers, selectedFacilityId: selFac, selectedFlowId: selFlow, hoveredFacilityId: hov, padding } = this.props;
    const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;

    // refit when the network itself changes (e.g. seed data replaced)
    const key = boundsKey(model);
    if (key !== this.fitKey) {
      this.fitKey = key;
      map.fitBounds(model.bounds, { padding, duration: 0 });
      map.setMaxBounds([model.bounds[0] - 1.6, model.bounds[1] - 1.2, model.bounds[2] + 1.6, model.bounds[3] + 1.2]);
    }

    const vis = (ids: string[], on: boolean) => {
      for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    vis(["dd-coverage"], layers.coverage);
    vis(["dd-spokes"], layers.spokes);
    vis(FLOW_LAYERS, layers.transfers);
    if (layers.transfers) vis(["dd-flow-opportunity"], layers.opportunities);

    // outline + mask
    const ring = model.outline;
    if (ring.length > 3) {
      const hole = signedArea(ring) > 0 ? [...ring].reverse() : ring; // outer world ring is CCW
      src("dd-mask")?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[[-179, -80], [179, -80], [179, 80], [-179, 80], [-179, -80]], hole] },
      });
      src("dd-outline")?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } });
    }

    if (layers.coverage) {
      src("dd-coverage")?.setData({
        type: "FeatureCollection",
        features: model.coverage.map((c) => ({ type: "Feature", properties: { v: c.value }, geometry: { type: "Polygon", coordinates: [c.ring] } })),
      });
    }
    if (layers.spokes) {
      src("dd-spokes")?.setData({
        type: "FeatureCollection",
        features: model.spokes.map((s) => ({ type: "Feature", properties: { id: s.id }, geometry: { type: "LineString", coordinates: s.coords } })),
      });
    }

    const focusFlow = selFlow ? model.flows.find((f) => f.id === selFlow) : undefined;
    const isHl = (f: MapFlow) => f.id === selFlow || (!selFlow && !!selFac && (f.fromId === selFac || f.toId === selFac));
    src("dd-flows")?.setData({
      type: "FeatureCollection",
      features: model.flows.map((f) => ({
        type: "Feature",
        properties: { id: f.id, status: f.status, primary: f.primary, hl: isHl(f), dim: !!focusFlow && f.id !== focusFlow.id, q: f.quantity },
        geometry: { type: "LineString", coordinates: f.arc.coords },
      })),
    });

    // arrival pings: in_transit -> delivered since last sync
    const prev = this.prevStatus;
    const nextStatus = new Map<string, string>();
    for (const f of model.flows) {
      nextStatus.set(f.id, f.status);
      if (f.status === "delivered" && prev.get(f.id) === "in_transit") {
        this.pings.push({ at: f.arc.coords[f.arc.coords.length - 1], start: performance.now() });
      }
    }
    this.prevStatus = nextStatus;

    const focusEnds = focusFlow ? new Set([focusFlow.fromId, focusFlow.toId]) : null;
    src("dd-facilities")?.setData({
      type: "FeatureCollection",
      features: model.facilities.map((f) => ({
        type: "Feature",
        properties: {
          id: f.id,
          type: f.type,
          risk: f.risk ?? "none",
          r: f.radius,
          icon: f.type === "PHC" ? "" : hubIconId(f.type as HubType, f.risk ?? "none"),
          alert: f.risk === "stockout" || f.risk === "critical",
          sel: f.id === selFac,
          hov: f.id === hov && f.id !== selFac,
          op: focusEnds && !focusEnds.has(f.id) ? 0.45 : 1,
        },
        geometry: { type: "Point", coordinates: f.lngLat },
      })),
    });

    this.syncMarkers(map, focusFlow?.id ?? null);
    this.dirty = true;
  }

  private syncMarkers(map: MLMap, focusId: string | null) {
    const ml = this.ml;
    if (!ml) return;
    const { model, layers, selectedFacilityId: selFac, variant, unitShort } = this.props;
    const want = new Map<string, { at: LngLat; text: string; cls: string; anchor: "center" | "top"; offset: [number, number]; flowId?: string; facId?: string }>();

    if (layers.transfers) {
      for (const f of model.flows) {
        if (!f.primary) continue;
        if (f.status === "opportunity" && (!layers.opportunities || variant === "compact")) continue;
        if (variant === "compact" && f.status === "delivered") continue;
        const cls = [styles.flowPill, styles[`pill_${f.status}`], focusId && focusId !== f.id ? styles.pillDim : "", focusId === f.id ? styles.pillFocus : ""].join(" ");
        want.set(`flow:${f.id}`, { at: f.mid, text: flowLabelText(f, unitShort), cls, anchor: "center", offset: [0, 0], flowId: f.id });
      }
    }
    for (const f of model.facilities) {
      if (!facilityLabelVisible(f, selFac, variant)) continue;
      const cls = [styles.facLabel, f.id === selFac ? styles.facLabelSel : "", f.risk ? styles[`facLabel_${f.risk}`] : ""].join(" ");
      want.set(`fac:${f.id}`, { at: f.lngLat, text: f.name, cls, anchor: "top", offset: [0, f.radius + 8], facId: f.id });
    }

    const have = this.markers;
    for (const [k, m] of have) {
      if (!want.has(k)) {
        m.marker.remove();
        have.delete(k);
      }
    }
    for (const [k, w] of want) {
      let m = have.get(k);
      if (!m) {
        const el = document.createElement("div");
        const inner = document.createElement("div");
        el.appendChild(inner);
        const flowId = w.flowId;
        const facId = w.facId;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (flowId) this.props.onClickFlow(flowId);
          if (facId) this.props.onClickFacility(facId);
        });
        const marker = new ml.Marker({ element: el, anchor: w.anchor, offset: w.offset }).setLngLat(w.at).addTo(map);
        m = { marker, el: inner };
        have.set(k, m);
      } else {
        m.marker.setLngLat(w.at);
        m.marker.setOffset(w.offset);
      }
      if (m.el.className !== w.cls) m.el.className = w.cls;
      if (m.el.dataset.text !== w.text) {
        m.el.dataset.text = w.text;
        m.el.innerHTML = w.text;
      }
    }
  }

  private pushMotion(map: MLMap, model: MapModel, layers: LayerVisibility, fr: Frame) {
    const motion = map.getSource("dd-motion") as GeoJSONSource | undefined;
    const pingSrc = map.getSource("dd-pings") as GeoJSONSource | undefined;
    if (!motion || !pingSrc) return;
    const focus = this.props.selectedFlowId;
    const feats: GeoJSON.Feature[] = [];
    if (layers.transfers) {
      for (const f of model.flows) {
        const dim = !!focus && focus !== f.id;
        if (f.status === "in_transit") {
          const t = flowProgress(f, fr.displayNowMs);
          if (t > 0.01) feats.push({ type: "Feature", properties: { kind: "trail", dim }, geometry: { type: "LineString", coordinates: arcSlice(f.arc, 0, t) } });
          feats.push({ type: "Feature", properties: { kind: "dot", waiting: false, dim }, geometry: { type: "Point", coordinates: pointOnArc(f.arc, t) } });
        } else if (f.status === "approved") {
          feats.push({ type: "Feature", properties: { kind: "dot", waiting: true, dim }, geometry: { type: "Point", coordinates: f.arc.coords[0] } });
        }
      }
    }
    motion.setData({ type: "FeatureCollection", features: feats });

    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.start < 1600);
    pingSrc.setData({
      type: "FeatureCollection",
      features: this.pings.map((p) => {
        const k = (now - p.start) / 1600;
        return { type: "Feature", properties: { rad: 8 + easeInOut(k) * 34, op: 0.9 * (1 - k) }, geometry: { type: "Point", coordinates: p.at } };
      }),
    });
  }
}

export function MapLibreCanvas(props: MapLibreCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GlEngine | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = new GlEngine(props);
    engineRef.current = engine;
    engine.mount(container);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // The engine is created once; later props flow in through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.update(props);
  });

  return <div ref={containerRef} className={styles.glCanvas} aria-hidden="true" />;
}


function boundsKey(model: MapModel): string {
  return `${model.facilities.length}:${model.bounds.map((v) => v.toFixed(2)).join(",")}`;
}
