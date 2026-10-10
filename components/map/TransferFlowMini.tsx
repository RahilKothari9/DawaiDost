"use client";
// OWNER: map agent. Small SVG route diagram for one transfer (donor → recipient), no MapLibre.
// `TransferFlowMini` reads names/risk from the store; `TransferFlowMiniView` is the pure view.
import { useId } from "react";
import { useDistrict } from "@/lib/district/store";
import type { RiskLevel, Transfer } from "@/lib/district/types";
import { haversineKm } from "@/lib/district/engine";
import { formatDays, type FlowStatus } from "@/lib/map/model";
import { STATUS_LABEL } from "@/lib/map/palette";
import { shortUnit } from "./labels";
import styles from "./TransferFlowMini.module.css";

type End = { name: string; risk: RiskLevel | null; days: number | null };

export type TransferFlowMiniViewProps = {
  from: End;
  to: End;
  quantity: number;
  unit?: string;
  etaHours: number;
  distanceKm?: number;
  status?: FlowStatus;
  /** 0..1 position of the consignment for in_transit. */
  progress?: number;
  /** Days of stock at the recipient after the transfer lands, if known. */
  toDaysAfter?: number | null;
  className?: string;
};

const W = 320;
const H = 104;
const AX = 34;
const BX = W - 34;
const Y = 54;

export function TransferFlowMiniView({
  from,
  to,
  quantity,
  unit = "units",
  etaHours,
  distanceKm,
  status = "proposed",
  progress = 0,
  toDaysAfter,
  className,
}: TransferFlowMiniViewProps) {
  const uid = useId().replace(/:/g, "");
  const cx = (AX + BX) / 2;
  const cy = Y - 34;
  const d = `M${AX},${Y} Q${cx},${cy} ${BX},${Y}`;
  const t = status === "in_transit" ? Math.max(0, Math.min(1, progress)) : status === "delivered" ? 1 : 0;
  const px = (1 - t) * (1 - t) * AX + 2 * (1 - t) * t * cx + t * t * BX;
  const py = (1 - t) * (1 - t) * Y + 2 * (1 - t) * t * cy + t * t * Y;
  const color = (r: RiskLevel | null) => (r ? `var(--risk-${r})` : "var(--muted)");
  const label = `${STATUS_LABEL[status]} transfer of ${quantity} ${unit} from ${from.name} to ${to.name}, ETA ${etaHours} hours`;

  return (
    <figure className={[styles.root, styles[`s_${status}`], className ?? ""].join(" ")} aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-hidden="true">
        <defs>
          <marker id={`ah-${uid}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M2 1 L8 5 L2 9" className={styles.arrow} />
          </marker>
        </defs>
        <path d={d} className={styles.base} />
        <path d={d} className={styles.route} markerEnd={`url(#ah-${uid})`} pathLength={100} />
        {status === "in_transit" && <path d={d} className={styles.travelled} pathLength={100} style={{ strokeDasharray: `${t * 100} 100` }} />}
        <text x={cx} y={cy + 4} className={styles.qty} textAnchor="middle">
          {quantity.toLocaleString("en-IN")} <tspan className={styles.unit}>{unit}</tspan>
        </text>

        <circle cx={AX} cy={Y} r="9" fill={color(from.risk)} className={styles.node} />
        <circle cx={BX} cy={Y} r="9" fill={color(to.risk)} className={styles.node} />
        {(to.risk === "stockout" || to.risk === "critical") && status !== "delivered" && (
          <circle cx={BX} cy={Y} r="9" className={styles.halo} style={{ stroke: color(to.risk) }} />
        )}

        {(status === "in_transit" || status === "approved") && (
          <g transform={`translate(${px},${py})`}>
            <circle r="8" className={styles.consGlow} />
            <circle r="4.5" className={styles.cons} />
          </g>
        )}
        {status === "delivered" && <path d={`M${BX - 4},${Y} l3,3 l5,-6`} className={styles.check} />}

        <text x={AX} y={Y + 24} className={styles.name} textAnchor="start">
          {trim(from.name)}
        </text>
        <text x={BX} y={Y + 24} className={styles.name} textAnchor="end">
          {trim(to.name)}
        </text>
        <text x={AX} y={Y + 38} className={styles.meta} textAnchor="start">
          {formatDays(from.days)} d cover
        </text>
        <text x={BX} y={Y + 38} className={styles.meta} textAnchor="end">
          {formatDays(to.days)} d{toDaysAfter != null ? ` → ${formatDays(toDaysAfter)} d` : " cover"}
        </text>
      </svg>
      <figcaption className={styles.caption}>
        <span>{STATUS_LABEL[status]}</span>
        {distanceKm != null && <span>{distanceKm.toFixed(0)} km</span>}
        <span>ETA {etaHours < 10 ? etaHours.toFixed(1) : Math.round(etaHours)} h</span>
      </figcaption>
    </figure>
  );
}

function trim(name: string): string {
  return name.length > 22 ? `${name.slice(0, 21)}…` : name;
}

export type TransferFlowMiniProps = {
  /** A transfer object (may be a proposal not yet in the store), or the id of one in the store. */
  transfer?: Pick<Transfer, "fromId" | "toId" | "quantity" | "etaHours" | "medicineId"> & Partial<Pick<Transfer, "status" | "distanceKm" | "updatedAt" | "dispatchedAt" | "id">>;
  transferId?: string;
  className?: string;
};

/** Store-connected route diagram for decision cards. */
export function TransferFlowMini({ transfer, transferId, className }: TransferFlowMiniProps) {
  const { state, getAssessment } = useDistrict();
  const t = transfer ?? state.transfers.find((x) => x.id === transferId);
  if (!t) return null;
  const from = state.facilities.find((f) => f.id === t.fromId);
  const to = state.facilities.find((f) => f.id === t.toId);
  if (!from || !to) return null;
  const med = state.medicines.find((m) => m.id === t.medicineId);
  const fa = getAssessment(from.id, t.medicineId);
  const ta = getAssessment(to.id, t.medicineId);
  const toRecord = state.stock.find((r) => r.facilityId === to.id && r.medicineId === t.medicineId);
  const status = t.status ?? "proposed";
  const after = toRecord && toRecord.dailyUse > 0 && status !== "delivered" ? (toRecord.stock + t.quantity) / toRecord.dailyUse : null;
  const progress =
    status === "in_transit" && (t.dispatchedAt ?? t.updatedAt)
      ? (new Date(state.now).getTime() - new Date((t.dispatchedAt ?? t.updatedAt) as string).getTime()) / (Math.max(0.25, t.etaHours) * 3.6e6)
      : 0;
  return (
    <TransferFlowMiniView
      className={className}
      from={{ name: from.name, risk: fa?.risk ?? null, days: fa?.daysOfStock ?? null }}
      to={{ name: to.name, risk: ta?.risk ?? null, days: ta?.daysOfStock ?? null }}
      quantity={t.quantity}
      unit={shortUnit(med?.unit)}
      etaHours={t.etaHours}
      distanceKm={t.distanceKm ?? haversineKm(from, to)}
      status={status}
      progress={progress}
      toDaysAfter={after}
    />
  );
}
