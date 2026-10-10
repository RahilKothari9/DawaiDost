"use client";
// OWNER: analytics agent. One row per medicine: pooled site stock, cover vs threshold, risk spread, donors.
import { useMemo } from "react";
import { useDistrict } from "@/lib/district/store";
import { fmtCompact, fmtDays } from "@/lib/analytics/format";
import { RISK_LABEL, RISK_LEVELS, RISK_VAR, historyWeeks, medicineSnapshot, medicineWeekly } from "@/lib/analytics/metrics";
import { EmptyState } from "./ChartTooltip";
import { Sparkline } from "./Sparkline";
import bits from "./bits.module.css";
import s from "./MedicineCoverageBoard.module.css";

export type MedicineCoverageBoardProps = {
  onSelect?: (medicineId: string) => void;
  /** "risk" (default) puts the medicines with most at-risk sites first; "name" keeps catalogue order. */
  sort?: "risk" | "name";
  className?: string;
};

export function MedicineCoverageBoard({ onSelect, sort = "risk", className }: MedicineCoverageBoardProps) {
  const { state, dispatch, assessments } = useDistrict();
  const rows = useMemo(() => {
    const weeks = historyWeeks(state);
    const list = state.medicines.map((m) => ({
      snap: medicineSnapshot(state, assessments, m),
      trend: medicineWeekly(state, m, weeks).map((w) => w.coverageDays),
    }));
    if (sort === "risk") list.sort((a, b) => b.snap.atRisk - a.snap.atRisk || a.snap.coverageDays / a.snap.thresholdDays - b.snap.coverageDays / b.snap.thresholdDays);
    return list;
  }, [state, assessments, sort]);

  if (!rows.length) return <EmptyState title="No medicines tracked yet" />;
  const scaleMax = Math.max(...rows.map((r) => r.snap.thresholdDays * 3));

  const pick = (id: string) => {
    dispatch({ type: "SELECT_MEDICINE", medicineId: id });
    onSelect?.(id);
  };

  return (
    <div className={[s.wrap, className].filter(Boolean).join(" ")}>
      <table className={s.table}>
        <caption className={bits.srOnly}>
          District coverage by medicine. Select a row to focus that medicine.
        </caption>
        <thead>
          <tr>
            <th scope="col">Medicine</th>
            <th scope="col" className={`${s.num} ${s.hideSm}`}>Site stock</th>
            <th scope="col">Pooled cover</th>
            <th scope="col">Sites at risk</th>
            <th scope="col" className={s.num}>Donors</th>
            <th scope="col" className={s.hideSm}>12-wk cover</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ snap, trend }) => {
            const m = snap.medicine;
            const cov = Number.isFinite(snap.coverageDays) ? snap.coverageDays : scaleMax;
            const pct = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`;
            const selected = state.selectedMedicineId === m.id;
            return (
              <tr
                key={m.id}
                tabIndex={0}
                data-selected={selected}
                aria-current={selected || undefined}
                onClick={() => pick(m.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(m.id);
                  }
                }}
                aria-label={`${m.name} ${m.strength}: ${fmtDays(snap.coverageDays)} days pooled cover, ${snap.atRisk} of ${snap.facilities} sites at risk, ${snap.donors} donors`}
              >
                <td>
                  <span className={s.name}>
                    <b>
                      {m.name}
                      {m.upstream && m.upstream.status !== "available" && <span className={s.upstream} title={m.upstream.note}>{m.upstream.status}</span>}
                    </b>
                    <small>{m.strength} · {m.leadTimeDays}+{m.safetyBufferDays}d threshold</small>
                  </span>
                </td>
                <td className={`${s.num} ${s.hideSm}`}>
                  <span className={s.mono}>{fmtCompact(snap.totalStock)}</span>
                  {snap.warehouseStock > 0 && <><br /><span className={s.mono}><small>+{fmtCompact(snap.warehouseStock)} WH</small></span></>}
                </td>
                <td>
                  <span className={s.cover}>
                    <span className={s.mono}>{fmtDays(snap.coverageDays)}d</span>
                    <span className={s.bar} aria-hidden>
                      <i style={{ width: pct(cov), background: RISK_VAR[snap.risk] }} />
                      <b style={{ left: pct(snap.thresholdDays) }} />
                    </span>
                  </span>
                </td>
                <td>
                  <span className={s.dist}>
                    <span className={s.distCount}>{snap.atRisk}<small style={{ color: "var(--muted)" }}>/{snap.facilities}</small></span>
                    <span className={s.stack} aria-hidden>
                      {RISK_LEVELS.map((r) =>
                        snap.distribution[r] > 0 ? <i key={r} title={`${RISK_LABEL[r]}: ${snap.distribution[r]}`} style={{ flex: snap.distribution[r], background: RISK_VAR[r] }} /> : null,
                      )}
                    </span>
                  </span>
                </td>
                <td className={s.num}>
                  <span className={s.mono}>{snap.donors}</span>
                  {snap.transferable > 0 && <><br /><span className={s.mono}><small>{fmtCompact(snap.transferable)} movable</small></span></>}
                </td>
                <td className={s.hideSm}>
                  <Sparkline values={trend} width={96} height={26} threshold={snap.thresholdDays} risk={snap.risk} ariaLabel={`${m.name} pooled cover trend`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className={s.legend} aria-label="Risk spread legend">
        {RISK_LEVELS.map((r) => (
          <li key={r}><i style={{ background: RISK_VAR[r] }} aria-hidden />{RISK_LABEL[r]}</li>
        ))}
        <li><i style={{ width: 2, background: "var(--ink)" }} aria-hidden />Threshold</li>
      </ul>
    </div>
  );
}
