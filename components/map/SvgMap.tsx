"use client";
// OWNER: map agent. Offline / no-WebGL renderer. Same model, arcs, markers and motion as the
// MapLibre view, projected with d3-geo onto a stylised district outline. Never needs a network.
import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator } from "d3-geo";
import type { Frame, MapAnimator } from "@/lib/map/animator";
import { arcSlice, pointOnArc, type LngLat } from "@/lib/map/geometry";
import { hubOutlinePath } from "@/lib/map/icons";
import { flowProgress, type MapFlow, type MapModel } from "@/lib/map/model";
import { coverageColor, type MapPalette } from "@/lib/map/palette";
import type { LayerVisibility } from "./layers";
import { facilityLabelVisible, flowLabelText } from "./labels";
import styles from "./DistrictMap.module.css";

type Pt = { x: number; y: number };

export type SvgMapProps = {
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
};

export function SvgMap(props: SvgMapProps) {
  const { model, palette: p, layers, variant, selectedFacilityId: selFac, selectedFlowId: selFlow, hoveredFacilityId: hov, padding, unitShort } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionRef = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const project = useMemo(() => {
    const pts = model.outline.length ? model.outline : model.facilities.map((f) => f.lngLat);
    const proj = geoMercator().fitExtent(
      [
        [padding.left, padding.top],
        [Math.max(padding.left + 50, size.w - padding.right), Math.max(padding.top + 50, size.h - padding.bottom)],
      ],
      { type: "MultiPoint", coordinates: pts },
    );
    return (ll: LngLat): [number, number] => proj(ll) ?? [0, 0];
  }, [model.outline, model.facilities, size, padding]);

  const toPath = (coords: LngLat[], close = false) =>
    coords.map((c, i) => `${i ? "L" : "M"}${project(c)[0].toFixed(1)},${project(c)[1].toFixed(1)}`).join("") + (close ? "Z" : "");

  const outlinePath = model.outline.length ? toPath(model.outline, true) : "";

  // coverage surface painted to a canvas, clipped to the outline and softened
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    if (!layers.coverage || !model.coverage.length) return;
    for (const c of model.coverage) {
      const [x0, y0] = project(c.ring[0]);
      const [x1, y1] = project(c.ring[2]);
      ctx.fillStyle = coverageColor(p, c.value);
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 0.6, Math.abs(y1 - y0) + 0.6);
    }
  }, [model.coverage, layers.coverage, project, size, p]);

  // per-frame consignment motion: mutate SVG attributes directly
  useEffect(() => {
    const unsub = props.animator.subscribe((fr: Frame) => {
      const g = motionRef.current;
      if (!g) return;
      for (const node of Array.from(g.children)) {
        const el = node as SVGElement;
        const id = el.dataset.flow;
        const f = id ? model.flows.find((x) => x.id === id) : undefined;
        if (!f) continue;
        const t = flowProgress(f, fr.displayNowMs);
        if (el.dataset.role === "trail") {
          el.setAttribute("d", t > 0.01 ? toPath(arcSlice(f.arc, 0, t)) : "");
        } else {
          const [x, y] = project(pointOnArc(f.arc, t));
          el.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.animator, model, project]);

  const focus = selFlow ? model.flows.find((f) => f.id === selFlow) : undefined;
  const focusEnds = focus ? new Set([focus.fromId, focus.toId]) : null;
  const visibleFlows = layers.transfers ? model.flows.filter((f) => f.status !== "opportunity" || layers.opportunities) : [];
  const relPt = (e: React.PointerEvent): Pt => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const flowClass = (f: MapFlow) =>
    [
      styles.svgFlow,
      styles[`svgFlow_${f.status}`],
      !f.primary ? styles.svgFlowSecondary : "",
      focus && focus.id !== f.id ? styles.svgDim : "",
      f.id === selFlow || (!selFlow && selFac && (f.fromId === selFac || f.toId === selFac)) ? styles.svgFlowHl : "",
    ].join(" ");

  return (
    <div ref={wrapRef} className={styles.svgWrap}>
      <svg className={styles.svg} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
        <defs>
          <pattern id="dd-paper-dots" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="0.9" fill={p.lineStrong} opacity="0.55" />
          </pattern>
          <clipPath id="dd-outline-clip">
            <path d={outlinePath} />
          </clipPath>
          <marker id="dd-arrow-accent" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M2 1 L8 5 L2 9" fill="none" stroke={p.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
          <marker id="dd-arrow-ink" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M2 1 L8 5 L2 9" fill="none" stroke={p.ink2} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        <rect width={size.w} height={size.h} fill={p.bg} onClick={() => props.onClickFlow(null)} />
        <rect width={size.w} height={size.h} fill="url(#dd-paper-dots)" pointerEvents="none" />
        {outlinePath && (
          <>
            <path d={outlinePath} fill={p.land} onClick={() => props.onClickFlow(null)} />
            <foreignObject x="0" y="0" width={size.w} height={size.h} clipPath="url(#dd-outline-clip)">
              <canvas ref={canvasRef} className={styles.svgCoverage} style={{ width: size.w, height: size.h }} />
            </foreignObject>
            <path d={outlinePath} fill="none" stroke={p.ink2} strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="6 4" />
          </>
        )}

        {layers.spokes &&
          model.spokes.map((s) => <path key={s.id} d={toPath(s.coords)} className={styles.svgSpoke} />)}

        <g>
          {visibleFlows.map((f) => (
            <path
              key={f.id}
              d={toPath(f.arc.coords)}
              className={flowClass(f)}
              markerEnd={f.status === "proposed" ? "url(#dd-arrow-ink)" : f.status === "approved" || f.status === "in_transit" ? "url(#dd-arrow-accent)" : undefined}
            />
          ))}
          {visibleFlows.map((f) => (
            <path
              key={`hit-${f.id}`}
              d={toPath(f.arc.coords)}
              className={styles.svgHit}
              onClick={() => props.onClickFlow(f.id)}
              onPointerMove={(e) => props.onHoverFlow(f.id, relPt(e))}
              onPointerLeave={() => props.onHoverFlow(null, null)}
            />
          ))}
        </g>

        <g ref={motionRef}>
          {visibleFlows
            .filter((f) => f.status === "in_transit")
            .map((f) => (
              <path key={`trail-${f.id}`} data-flow={f.id} data-role="trail" className={`${styles.svgTrail} ${focus && focus.id !== f.id ? styles.svgDim : ""}`} />
            ))}
          {visibleFlows
            .filter((f) => f.status === "in_transit" || f.status === "approved")
            .map((f) => {
              const [x, y] = project(pointOnArc(f.arc, flowProgress(f, model.nowMs)));
              return (
                <g key={`dot-${f.id}`} data-flow={f.id} data-role="dot" transform={`translate(${x},${y})`} className={focus && focus.id !== f.id ? styles.svgDim : ""}>
                  <circle r="11" className={styles.svgConsGlow} />
                  <circle r={f.status === "approved" ? 4 : 5.5} className={styles.svgConsDot} />
                </g>
              );
            })}
        </g>

        <g>
          {model.facilities.map((f) => {
            const [x, y] = project(f.lngLat);
            const color = f.risk ? p.risk[f.risk] : p.unknown;
            const r = f.radius;
            const alert = (f.risk === "stockout" || f.risk === "critical") && f.type !== "WAREHOUSE";
            const dim = focusEnds && !focusEnds.has(f.id);
            return (
              <g
                key={f.id}
                transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
                className={`${styles.svgFac} ${dim ? styles.svgDim : ""}`}
                onClick={() => props.onClickFacility(f.id)}
                onPointerMove={(e) => props.onHoverFacility(f.id, relPt(e))}
                onPointerLeave={() => props.onHoverFacility(null, null)}
              >
                {alert && (
                  <>
                    <circle r={r + 4} className={styles.svgHalo} style={{ stroke: color }} />
                    <circle r={r + 4} className={`${styles.svgHalo} ${styles.svgHaloLate}`} style={{ stroke: color }} />
                  </>
                )}
                {f.type === "PHC" ? (
                  <circle r={r} fill={color} stroke="#fff" strokeWidth="2" className={styles.svgShadow} />
                ) : f.type === "WAREHOUSE" ? (
                  <g className={styles.svgShadow}>
                    <path d={hubOutlinePath("WAREHOUSE", 11)} fill={p.ink} stroke={color} strokeWidth="1.5" />
                    <path d="M-5 -1 L0 -5 L5 -1 M-4 0 H4 V5 H-4Z M-4 2.5 H4" fill="none" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
                  </g>
                ) : f.type === "DH" ? (
                  <g className={styles.svgShadow}>
                    <path d={hubOutlinePath("DH", 10)} fill={color} stroke="#fff" strokeWidth="2" />
                    <path d="M-1.6 -5.5 H1.6 V-1.6 H5.5 V1.6 H1.6 V5.5 H-1.6 V1.6 H-5.5 V-1.6 H-1.6Z" fill="#fff" />
                  </g>
                ) : (
                  <g className={styles.svgShadow}>
                    <path d={hubOutlinePath("CHC", 11)} fill={color} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
                    <circle r="2.4" fill="#fff" />
                  </g>
                )}
                {f.id === hov && f.id !== selFac && <circle r={r + 5} fill="none" stroke={p.ink2} strokeOpacity="0.6" strokeWidth="1.5" />}
                {f.id === selFac && <circle r={r + 6} fill="none" stroke={p.ink} strokeWidth="2.5" />}
                <circle r={Math.max(r + 6, 14)} fill="transparent" />
              </g>
            );
          })}
        </g>
      </svg>

      {/* HTML labels, same classes as the MapLibre markers */}
      {visibleFlows
        .filter((f) => !(variant === "compact" && (f.status === "opportunity" || f.status === "delivered")))
        .map((f) => {
          const [x, y] = project(f.mid);
          const cls = [styles.flowPill, styles[`pill_${f.status}`], f.primary ? "" : styles.pillSecondary, focus && focus.id !== f.id ? styles.pillDim : "", focus?.id === f.id ? styles.pillFocus : ""].join(" ");
          return (
            <div
              key={`pill-${f.id}`}
              className={`${styles.abs} ${cls}`}
              style={{ left: x, top: y }}
              onClick={() => props.onClickFlow(f.id)}
              dangerouslySetInnerHTML={{ __html: flowLabelText(f, unitShort) }}
            />
          );
        })}
      {model.facilities
        .filter((f) => facilityLabelVisible(f, selFac, variant))
        .map((f) => {
          const [x, y] = project(f.lngLat);
          const cls = [styles.facLabel, f.id === selFac ? styles.facLabelSel : "", f.risk ? styles[`facLabel_${f.risk}`] : ""].join(" ");
          return (
            <div
              key={`lbl-${f.id}`}
              className={`${f.type === "WAREHOUSE" && f.id !== selFac ? styles.absLeft : styles.absTop} ${cls}`}
              style={f.type === "WAREHOUSE" && f.id !== selFac ? { left: x + f.radius + 8, top: y } : { left: x, top: y + f.radius + 8 }} onClick={() => props.onClickFacility(f.id)}>
              {f.name}
            </div>
          );
        })}
    </div>
  );
}
