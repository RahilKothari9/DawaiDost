"use client";
// OWNER: map agent. District command map: MapLibre GL when available, styled SVG otherwise.
// Overlays (medicine switcher, layer toggles, legend, tooltip, week time-lapse) live here and are
// shared by both renderers. Export name and DistrictMapProps are a cross-team contract.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Layers, Pause, Play, RotateCcw, X } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { formatClock, MapAnimator } from "@/lib/map/animator";
import { buildMapModel, flowProgress, formatDays, relativeTime, TYPE_LABEL, type MapFlow } from "@/lib/map/model";
import { DEFAULT_PALETTE, readPalette, RISK_LABEL, RISK_ORDER, STATUS_LABEL } from "@/lib/map/palette";
import { DEFAULT_LAYERS, LAYER_META, type LayerVisibility } from "./layers";
import { shortUnit } from "./labels";
import { SvgMap } from "./SvgMap";
import { TransferFlowMiniView } from "./TransferFlowMini";
import styles from "./DistrictMap.module.css";

const MapLibreCanvas = dynamic(() => import("./MapLibreCanvas").then((m) => m.MapLibreCanvas), { ssr: false });

export type DistrictMapProps = {
  height?: number | string;
  variant?: "full" | "compact";
  onSelectFacility?: (facilityId: string) => void;
  /** Controlled transfer highlight (falls back to internal state when omitted). */
  selectedTransferId?: string | null;
  onSelectTransfer?: (transferId: string | null) => void;
  /** Force the offline SVG renderer (useful for demos without network). */
  renderer?: "auto" | "svg";
  /** Override initial layer toggles. */
  defaultLayers?: Partial<LayerVisibility>;
  className?: string;
};

const WEEK_HOURS = 168;
const STEP_HOURS = 4;

const noopSubscribe = () => () => {};
function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

type Hover = { kind: "facility" | "flow"; id: string; x: number; y: number; flipX: boolean; flipY: boolean } | null;

export function DistrictMap({
  height,
  variant = "full",
  onSelectFacility,
  selectedTransferId,
  onSelectTransfer,
  renderer = "auto",
  defaultLayers,
  className,
}: DistrictMapProps) {
  const { state, dispatch, assessments } = useDistrict();
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const palette = useMemo(() => (isClient ? readPalette(document.documentElement) : DEFAULT_PALETTE), [isClient]);
  const compact = variant === "compact";

  const [layers, setLayers] = useState<LayerVisibility>(() => ({ ...DEFAULT_LAYERS[variant], ...defaultLayers }));
  const [glFailed, setGlFailed] = useState<string | null>(null);
  const [glReady, setGlReady] = useState<{ basemap: boolean } | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [internalFlow, setInternalFlow] = useState<string | null>(null);
  const [layersOpen, setLayersOpen] = useState(!compact);
  const [play, setPlay] = useState({ playing: false, hours: 0 });
  const [width, setWidth] = useState(960);
  const frameRef = useRef<HTMLDivElement>(null);
  const clockDayRef = useRef<HTMLSpanElement>(null);
  const clockTimeRef = useRef<HTMLSpanElement>(null);

  const nowMs = new Date(state.now).getTime();
  const [animator] = useState(() => new MapAnimator(nowMs, false));
  useEffect(() => () => animator.destroy(), [animator]);
  useEffect(() => {
    animator.setReducedMotion(reduced);
    animator.setTarget(nowMs);
  }, [animator, nowMs, reduced]);

  // live clock text, written straight to the DOM every frame
  useEffect(
    () =>
      animator.subscribe((fr) => {
        const c = formatClock(fr.displayNowMs);
        if (clockDayRef.current && clockDayRef.current.textContent !== c.day) clockDayRef.current.textContent = c.day;
        if (clockTimeRef.current && clockTimeRef.current.textContent !== c.time) clockTimeRef.current.textContent = c.time;
      }),
    [animator],
  );

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- week time-lapse ------------------------------------------------------------------
  useEffect(() => {
    if (!play.playing) return;
    const id = setInterval(() => {
      dispatch({ type: "ADVANCE_CLOCK", hours: STEP_HOURS });
      setPlay((s) => {
        const hours = s.hours + STEP_HOURS;
        return hours >= WEEK_HOURS ? { playing: false, hours: WEEK_HOURS } : { playing: true, hours };
      });
    }, reduced ? 650 : 420);
    return () => clearInterval(id);
  }, [play.playing, dispatch, reduced]);

  const togglePlay = () => setPlay((s) => (s.playing ? { ...s, playing: false } : { playing: true, hours: s.hours >= WEEK_HOURS ? 0 : s.hours }));
  const stepOnce = () => {
    dispatch({ type: "ADVANCE_CLOCK", hours: 24 });
    setPlay((s) => ({ playing: false, hours: Math.min(WEEK_HOURS, s.hours + 24) }));
  };

  // ---- model ------------------------------------------------------------------------------
  const model = useMemo(
    () => buildMapModel(state, assessments, { allMedicines: layers.allMedicines, showOpportunities: layers.opportunities, coverage: layers.coverage }),
    [state, assessments, layers.allMedicines, layers.opportunities, layers.coverage],
  );
  const medicine = model.medicine;
  const unitShort = shortUnit(medicine?.unit);

  const selectedFlowId = selectedTransferId !== undefined ? selectedTransferId : internalFlow;
  const selectedFlow = selectedFlowId ? model.flows.find((f) => f.id === selectedFlowId) ?? null : null;

  const selectFlow = useCallback(
    (id: string | null) => {
      setInternalFlow(id);
      onSelectTransfer?.(id && !id.startsWith("opp:") ? id : null);
    },
    [onSelectTransfer],
  );
  const selectFacility = useCallback(
    (id: string) => {
      dispatch({ type: "SELECT_FACILITY", facilityId: id });
      onSelectFacility?.(id);
    },
    [dispatch, onSelectFacility],
  );

  const placeHover = useCallback((kind: "facility" | "flow", id: string | null, pt: { x: number; y: number } | null) => {
    setHover((prev) => {
      if (!id || !pt) return prev && prev.kind === kind ? null : prev;
      const el = frameRef.current;
      const w = el?.clientWidth ?? 800;
      const h = el?.clientHeight ?? 600;
      return { kind, id, x: pt.x, y: pt.y, flipX: pt.x > w * 0.62, flipY: pt.y > h * 0.6 };
    });
  }, []);
  const onHoverFacility = useCallback((id: string | null, pt: { x: number; y: number } | null) => placeHover("facility", id, pt), [placeHover]);
  const onHoverFlow = useCallback((id: string | null, pt: { x: number; y: number } | null) => placeHover("flow", id, pt), [placeHover]);
  const onFail = useCallback((reason: string) => setGlFailed(reason), []);
  const onReady = useCallback((info: { basemap: boolean }) => setGlReady(info), []);

  const padding = useMemo(() => {
    if (compact) return { top: 64, bottom: 56, left: 24, right: 24 };
    const wide = width > 940;
    return { top: 120, bottom: 96, left: wide ? 60 : 24, right: wide ? 270 : 24 };
  }, [compact, width]);

  const useSvg = renderer === "svg" || !!glFailed;
  const rendererProps = {
    model,
    palette,
    layers,
    variant,
    selectedFacilityId: state.selectedFacilityId,
    selectedFlowId,
    hoveredFacilityId: hover?.kind === "facility" ? hover.id : null,
    animator,
    unitShort,
    padding,
    onHoverFacility,
    onHoverFlow,
    onClickFacility: selectFacility,
    onClickFlow: selectFlow,
  };

  const medRisk = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assessments) if (a.risk === "stockout" || a.risk === "critical") m.set(a.medicineId, (m.get(a.medicineId) ?? 0) + 1);
    return m;
  }, [assessments]);

  const { stats } = model;
  const frameHeight = height ?? (compact ? 380 : 680);

  return (
    <section
      ref={frameRef}
      className={[styles.frame, compact ? styles.compact : styles.full, className ?? ""].join(" ")}
      style={{ height: frameHeight }}
      aria-label={`District map of ${state.district.name}${medicine ? `, showing ${medicine.name}` : ""}`}
    >
      <div className={styles.stage}>
        {isClient && (useSvg ? <SvgMap {...rendererProps} /> : <MapLibreCanvas {...rendererProps} onFail={onFail} onReady={onReady} />)}
        {isClient && !useSvg && !glReady && <div className={styles.loading}>Drawing the district…</div>}
      </div>

      {/* ---- header: medicine + headline numbers ---- */}
      <div className={styles.header}>
        <div className={styles.eyebrow}>
          {state.district.name} district · {state.district.state}
          <span className={styles.synthetic}>synthetic network</span>
        </div>
        <label className={styles.medPicker}>
          <span className={styles.srOnly}>Medicine shown on map</span>
          <select value={state.selectedMedicineId} onChange={(e) => dispatch({ type: "SELECT_MEDICINE", medicineId: e.target.value })}>
            {state.medicines.map((m) => {
              const n = medRisk.get(m.id) ?? 0;
              return (
                <option key={m.id} value={m.id}>
                  {m.name} {m.strength}
                  {n ? ` — ${n} at risk` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <div className={styles.statRow}>
          <Stat n={stats.stockouts} label="stocked out" tone="stockout" />
          <Stat n={stats.atRisk - stats.stockouts} label="critical" tone="critical" />
          <Stat n={stats.inTransit} label="in transit" tone="accent" />
          {!compact && <Stat n={stats.proposed + stats.approved} label="awaiting" tone="ink" />}
          {!compact && layers.opportunities && <Stat n={stats.opportunities} label="opportunities" tone="surplus" />}
        </div>
      </div>

      {/* ---- layer toggles ---- */}
      {!compact && (
        <div className={`${styles.panel} ${styles.layersPanel}`} data-open={layersOpen}>
          <button type="button" className={styles.panelHead} onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen}>
            <Layers size={14} aria-hidden="true" /> Layers
          </button>
          {layersOpen && (
            <ul className={styles.layerList}>
              {LAYER_META.map((l) => (
                <li key={l.key}>
                  <label className={styles.toggle} title={l.hint}>
                    <input
                      type="checkbox"
                      checked={layers[l.key]}
                      disabled={l.key === "opportunities" && !layers.transfers}
                      onChange={(e) => setLayers((s) => ({ ...s, [l.key]: e.target.checked }))}
                    />
                    <span className={styles.switch} aria-hidden="true" />
                    <span>{l.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---- legend ---- */}
      <div className={`${styles.panel} ${styles.legend}`}>
        <div className={styles.legendRow}>
          {RISK_ORDER.map((r) => (
            <span key={r} className={styles.legendItem}>
              <i className={styles.dot} style={{ background: `var(--risk-${r})` }} />
              {RISK_LABEL[r]}
            </span>
          ))}
        </div>
        {!compact && (
          <>
            <div className={styles.legendRow}>
              {(["opportunity", "proposed", "approved", "in_transit", "delivered"] as const).map((s) => (
                <span key={s} className={styles.legendItem}>
                  <svg width="26" height="8" aria-hidden="true" className={styles[`leg_${s}`]}>
                    <line x1="1" y1="4" x2="25" y2="4" />
                  </svg>
                  {STATUS_LABEL[s]}
                </span>
              ))}
            </div>
            <div className={styles.legendRow}>
              <span className={styles.legendItem}><i className={styles.glyphPhc} />PHC · size = catchment</span>
              <span className={styles.legendItem}><i className={styles.glyphChc} />CHC</span>
              <span className={styles.legendItem}><i className={styles.glyphDh} />District hosp.</span>
              <span className={styles.legendItem}><i className={styles.glyphWh} />Warehouse</span>
            </div>
            {layers.coverage && (
              <div className={styles.legendRow}>
                <span className={styles.legendItem}>
                  Days of stock vs threshold
                  <i className={styles.ramp} />
                  <small>0 → 1× → 2×+</small>
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ---- time-lapse ---- */}
      <div className={`${styles.panel} ${styles.player}`}>
        <button type="button" className={styles.playBtn} onClick={togglePlay} aria-label={play.playing ? "Pause week time-lapse" : "Play a week of stock and transfers"}>
          {play.playing ? <Pause size={16} aria-hidden="true" /> : play.hours >= WEEK_HOURS ? <RotateCcw size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <div className={styles.clock} aria-live="off">
          <span ref={clockDayRef} className={styles.clockDay}>
            {formatClock(nowMs).day}
          </span>
          <span ref={clockTimeRef} className={styles.clockTime}>
            {formatClock(nowMs).time}
          </span>
        </div>
        {!compact && (
          <div className={styles.week} aria-hidden="true">
            <div className={styles.weekTrack}>
              <div className={styles.weekFill} style={{ width: `${(play.hours / WEEK_HOURS) * 100}%` }} />
              {Array.from({ length: 6 }, (_, i) => (
                <i key={i} style={{ left: `${((i + 1) / 7) * 100}%` }} />
              ))}
            </div>
            <div className={styles.weekLabel}>{play.playing ? `Day ${Math.min(7, Math.floor(play.hours / 24) + 1)} of 7` : play.hours ? `+${Math.round(play.hours / 24 * 10) / 10} days` : "Play week"}</div>
          </div>
        )}
        {!compact && (
          <button type="button" className={styles.stepBtn} onClick={stepOnce} disabled={play.playing} title="Advance one day">
            +1d
          </button>
        )}
      </div>

      {/* ---- selected transfer card ---- */}
      {selectedFlow && !compact && (
        <div className={`${styles.panel} ${styles.flowCard}`}>
          <button type="button" className={styles.close} onClick={() => selectFlow(null)} aria-label="Clear selected transfer">
            <X size={14} aria-hidden="true" />
          </button>
          <div className={styles.flowCardHead}>
            <span className={`${styles.statusChip} ${styles[`chip_${selectedFlow.status}`]}`}>{STATUS_LABEL[selectedFlow.status]}</span>
            {selectedFlow.status === "in_transit" && <span className={styles.mono}>{Math.round(flowProgress(selectedFlow, nowMs) * 100)}% of route</span>}
          </div>
          <TransferFlowMiniView
            from={{ name: selectedFlow.fromName, risk: model.facilityById.get(selectedFlow.fromId)?.risk ?? null, days: model.facilityById.get(selectedFlow.fromId)?.daysOfStock ?? null }}
            to={{ name: selectedFlow.toName, risk: model.facilityById.get(selectedFlow.toId)?.risk ?? null, days: model.facilityById.get(selectedFlow.toId)?.daysOfStock ?? null }}
            quantity={selectedFlow.quantity}
            unit={shortUnit(state.medicines.find((m) => m.id === selectedFlow.medicineId)?.unit)}
            etaHours={selectedFlow.etaHours}
            distanceKm={selectedFlow.distanceKm}
            status={selectedFlow.status}
            progress={flowProgress(selectedFlow, nowMs)}
          />
        </div>
      )}

      {/* ---- hover tooltip ---- */}
      {hover && (
        <div
          className={styles.tooltip}
          style={{
            left: hover.x,
            top: hover.y,
            transform: `translate(${hover.flipX ? "calc(-100% - 14px)" : "14px"}, ${hover.flipY ? "calc(-100% + 10px)" : "-10px"})`,
          }}
          role="tooltip"
        >
          {hover.kind === "facility" ? (
            <FacilityTip id={hover.id} model={model} unit={medicine?.unit ?? "units"} medicineName={medicine ? `${medicine.name} ${medicine.strength}` : ""} />
          ) : (
            <FlowTip flow={model.flows.find((f) => f.id === hover.id)} nowMs={nowMs} unit={unitShort} />
          )}
        </div>
      )}

      {isClient && useSvg && (
        <div className={styles.offlineBadge} title={glFailed ?? "SVG renderer"}>
          Offline map
        </div>
      )}
      {glReady && !glReady.basemap && !useSvg && <div className={styles.offlineBadge}>Basemap offline</div>}

      {/* keyboard / screen-reader access to facilities */}
      <ul className={styles.srOnly} aria-label="Facilities">
        {model.facilities.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => selectFacility(f.id)}>
              {f.name}, {TYPE_LABEL[f.type]}, {f.risk ? RISK_LABEL[f.risk] : "no report"}, {formatDays(f.daysOfStock)} days of stock
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <span className={styles.stat} data-tone={tone} data-zero={n === 0}>
      <b>{n}</b> {label}
    </span>
  );
}

function FacilityTip({ id, model, unit, medicineName }: { id: string; model: ReturnType<typeof buildMapModel>; unit: string; medicineName: string }) {
  const f = model.facilityById.get(id);
  if (!f) return null;
  const days = f.daysOfStock;
  const thr = f.thresholdDays ?? 8;
  const pct = days === null ? 0 : Number.isFinite(days) ? Math.min(100, (days / (thr * 2)) * 100) : 100;
  return (
    <div className={styles.tip}>
      <div className={styles.tipHead}>
        <span className={styles.tipType}>{f.type === "PHC" ? "PHC" : f.type === "CHC" ? "CHC" : f.type === "DH" ? "DH" : "Store"}</span>
        <div>
          <div className={styles.tipName}>{f.name}</div>
          <div className={styles.tipSub}>
            {TYPE_LABEL[f.type]} · {f.block} block
          </div>
        </div>
      </div>
      {f.risk ? (
        <>
          <div className={styles.tipMed}>{medicineName}</div>
          <div className={styles.tipStats}>
            <div>
              <span className={styles.tipBig}>{f.stock?.toLocaleString("en-IN")}</span>
              <span className={styles.tipLabel}>{unit} on shelf</span>
            </div>
            <div>
              <span className={styles.tipBig} style={{ color: `var(--risk-${f.risk})` }}>
                {formatDays(days)}
              </span>
              <span className={styles.tipLabel}>days of stock</span>
            </div>
          </div>
          <div className={styles.tipBar} aria-hidden="true">
            <i style={{ width: `${pct}%`, background: `var(--risk-${f.risk})` }} />
            <b style={{ left: "50%" }} title="threshold" />
          </div>
          <div className={styles.tipRow}>
            <span className={`${styles.riskChip}`} style={{ background: `var(--risk-${f.risk})` }}>
              {RISK_LABEL[f.risk]}
            </span>
            <span className={styles.tipMuted}>threshold {thr} d · uses {f.dailyUse}/day</span>
          </div>
          {(f.transferable > 0 || f.gapUnits > 0 || f.inbound > 0 || f.outbound > 0) && (
            <div className={styles.tipRow}>
              {f.gapUnits > 0 && <span className={styles.tipMuted}>needs {f.gapUnits}</span>}
              {f.transferable > 0 && <span className={styles.tipMuted}>can spare {f.transferable}</span>}
              {f.inbound > 0 && <span className={styles.tipAccent}>↘ {f.inbound} inbound</span>}
              {f.outbound > 0 && <span className={styles.tipAccent}>↗ {f.outbound} outbound</span>}
            </div>
          )}
          <div className={styles.tipFoot}>
            Last report {relativeTime(f.lastReportAt, model.nowMs)} · {f.reportSource === "voice" ? "voice call" : f.reportSource}
            {f.verified ? "" : " · unverified"}
            <br />
            Pharmacist {f.pharmacist.name}
          </div>
        </>
      ) : (
        <div className={styles.tipFoot}>No stock record for this medicine · Pharmacist {f.pharmacist.name}</div>
      )}
    </div>
  );
}

function FlowTip({ flow, nowMs, unit }: { flow: MapFlow | undefined; nowMs: number; unit: string }) {
  if (!flow) return null;
  const pct = Math.round(flowProgress(flow, nowMs) * 100);
  return (
    <div className={styles.tip}>
      <div className={styles.flowTipHead}>
        <span className={`${styles.statusChip} ${styles[`chip_${flow.status}`]}`}>{STATUS_LABEL[flow.status]}</span>
        <span className={styles.tipBig}>
          {flow.quantity.toLocaleString("en-IN")} <small>{unit}</small>
        </span>
      </div>
      <div className={styles.tipName}>
        {flow.fromName} <span className={styles.tipMuted}>→</span> {flow.toName}
      </div>
      <div className={styles.tipFoot}>
        {flow.distanceKm.toFixed(0)} km · ETA {flow.etaHours.toFixed(flow.etaHours < 10 ? 1 : 0)} h
        {flow.status === "in_transit" ? ` · ${pct}% there` : ""}
        {flow.status === "opportunity" ? " · safe surplus, not yet proposed" : ""}
        {!flow.primary ? " · other medicine" : ""}
      </div>
    </div>
  );
}
