"use client";
// OWNER: analytics agent. District days of cover for one medicine, against lead time and threshold.
import { useMemo } from "react";
import { useDistrict } from "@/lib/district/store";
import { fmtDays, fmtInt } from "@/lib/analytics/format";
import { RISK_VAR, medicineSnapshot } from "@/lib/analytics/metrics";
import { RiskChip } from "./RiskChip";
import { EmptyState } from "./ChartTooltip";
import s from "./bits.module.css";

export type CoverageGaugeProps = {
  /** Defaults to the selected medicine. */
  medicineId?: string;
  compact?: boolean;
  className?: string;
};

export function CoverageGauge({ medicineId, compact = false, className }: CoverageGaugeProps) {
  const { state, assessments } = useDistrict();
  const id = medicineId ?? state.selectedMedicineId;
  const snap = useMemo(() => {
    const m = state.medicines.find((x) => x.id === id);
    return m ? medicineSnapshot(state, assessments, m) : null;
  }, [state, assessments, id]);

  if (!snap) return <EmptyState title="No medicine selected" />;
  const { medicine: m, coverageDays, thresholdDays } = snap;
  const max = Math.max(thresholdDays * 3, Number.isFinite(coverageDays) ? Math.ceil(coverageDays / 5) * 5 : 0, 10);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const fillW = Number.isFinite(coverageDays) ? pct(coverageDays) : "100%";

  return (
    <div
      className={[s.gauge, compact && s.gaugeCompact, className].filter(Boolean).join(" ")}
      role="group"
      aria-label={`${m.name} ${m.strength}: district cover ${fmtDays(coverageDays)} days against an ${thresholdDays}-day threshold`}
    >
      <div className={s.gaugeHead}>
        <p className={s.gaugeLabel}>
          District cover · <b>{m.name} {m.strength}</b>
        </p>
        <RiskChip risk={snap.risk} size="sm" />
      </div>
      <p className={s.gaugeValue}>
        {fmtDays(coverageDays)}
        <small>days pooled</small>
      </p>
      <div className={s.gaugeTrack} aria-hidden>
        <span className={s.gaugeFill} style={{ width: fillW, background: RISK_VAR[snap.risk] }} />
        <span className={`${s.gaugeMark} ${s.lead}`} style={{ left: pct(m.leadTimeDays) }} title={`Lead time ${m.leadTimeDays} d`} />
        <span className={s.gaugeMark} style={{ left: pct(thresholdDays) }} title={`Threshold ${thresholdDays} d`} />
      </div>
      <div className={s.gaugeScale} aria-hidden>
        <span style={{ left: 0 }}>0</span>
        <span style={{ left: pct(thresholdDays) }}>{m.leadTimeDays}+{m.safetyBufferDays}d threshold</span>
        <span style={{ left: "100%" }}>{max}d</span>
      </div>
      {!compact && (
        <p className={s.gaugeFoot}>
          <span>{fmtInt(snap.totalStock)} {m.unit} on shelves</span>
          <span>{snap.atRisk} of {snap.facilities} facilities below threshold</span>
          <span>{snap.donors} donors · {fmtInt(snap.transferable)} movable</span>
        </p>
      )}
    </div>
  );
}
