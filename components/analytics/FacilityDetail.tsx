"use client";
// OWNER: analytics agent. Drawer / panel content for one facility.
import { useMemo } from "react";
import { ArrowDownLeft, ArrowUpRight, CircleHelp, Clock, Hourglass, Mic, Phone } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { wouldExpireUnused } from "@/lib/district/engine";
import type { Transfer } from "@/lib/district/types";
import { fmtAgo, fmtDate, fmtDateTime, fmtDays, fmtInt, initials } from "@/lib/analytics/format";
import { compareAssessments, isAtRisk, openInbound, transferArrival } from "@/lib/analytics/metrics";
import { EmptyState } from "./ChartTooltip";
import { ForecastChart } from "./ForecastChart";
import { RiskChip } from "./RiskChip";
import { Sparkline } from "./Sparkline";
import s from "./FacilityDetail.module.css";

export type FacilityDetailProps = {
  facilityId: string;
  /** Medicine for the forecast; defaults to the selected medicine, else this facility's worst line. */
  medicineId?: string;
  onMedicineSelect?: (medicineId: string) => void;
  /** Max timeline events (default 6). */
  timelineLimit?: number;
  forecastHeight?: number;
  className?: string;
};

const TYPE_LABEL = { WAREHOUSE: "District warehouse", DH: "District hospital", CHC: "Community health centre", PHC: "Primary health centre" } as const;
const LANG = { hi: "Hindi", en: "English" } as const;

export function FacilityDetail({ facilityId, medicineId, onMedicineSelect, timelineLimit = 6, forecastHeight = 240, className }: FacilityDetailProps) {
  const { state, dispatch, assessments } = useDistrict();

  const data = useMemo(() => {
    const f = state.facilities.find((x) => x.id === facilityId);
    if (!f) return null;
    const meds = new Map(state.medicines.map((m) => [m.id, m]));
    const names = new Map(state.facilities.map((x) => [x.id, x.name]));
    const recs = state.stock.filter((r) => r.facilityId === facilityId);
    const lines = assessments
      .filter((a) => a.facilityId === facilityId)
      .sort(compareAssessments)
      .map((a) => ({ a, r: recs.find((r) => r.medicineId === a.medicineId)!, m: meds.get(a.medicineId)!, inbound: openInbound(state, facilityId, a.medicineId) }))
      .filter((x) => x.r && x.m);
    const voice = recs.filter((r) => r.reportSource === "voice").sort((a, b) => b.lastReportAt.localeCompare(a.lastReportAt))[0];
    const latest = [...recs].sort((a, b) => b.lastReportAt.localeCompare(a.lastReportAt))[0];
    const expiring = recs
      .filter((r) => r.nearExpiry)
      .map((r) => ({ r, m: meds.get(r.medicineId)!, unused: wouldExpireUnused(r, state.now) }))
      .filter((x) => x.m)
      .sort((a, b) => a.r.nearExpiry!.expiresOn.localeCompare(b.r.nearExpiry!.expiresOn));
    const transfers = state.transfers
      .filter((t) => (t.toId === facilityId || t.fromId === facilityId) && t.status !== "rejected")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8);
    const events = state.timeline.filter((e) => e.facilityId === facilityId).slice(0, timelineLimit);
    return { f, meds, names, lines, voice, latest, expiring, transfers, events };
  }, [state, assessments, facilityId, timelineLimit]);

  if (!data) return <EmptyState title="Facility not found">Select a facility on the map or heatmap.</EmptyState>;
  const { f, meds, names, lines, voice, latest, expiring, transfers, events } = data;

  const stocks = new Set(lines.map((l) => l.m.id));
  const forecastMed =
    (medicineId && stocks.has(medicineId) && medicineId) ||
    (stocks.has(state.selectedMedicineId) && state.selectedMedicineId) ||
    lines[0]?.m.id;
  const atRisk = lines.filter((l) => isAtRisk(l.a.risk)).length;
  const outs = lines.filter((l) => l.a.risk === "stockout").length;
  const unverified = lines.filter((l) => !l.r.verified || l.r.recountRequested).length;

  const pick = (id: string) => {
    dispatch({ type: "SELECT_MEDICINE", medicineId: id });
    onMedicineSelect?.(id);
  };

  const transferRow = (t: Transfer) => {
    const inbound = t.toId === facilityId;
    const other = names.get(inbound ? t.fromId : t.toId) ?? (inbound ? t.fromId : t.toId);
    const m = meds.get(t.medicineId);
    const when =
      t.status === "delivered" ? `Delivered ${fmtAgo(t.deliveredAt ?? t.updatedAt, state.now)}`
      : t.status === "in_transit" || t.status === "approved" ? `Arrives ${fmtDateTime(transferArrival(t, state.now))}`
      : `Proposed ${fmtAgo(t.createdAt, state.now)}`;
    return (
      <li key={t.id} className={s.item}>
        {inbound ? <ArrowDownLeft aria-label="Inbound" style={{ color: "var(--accent)" }} /> : <ArrowUpRight aria-label="Outbound" />}
        <span>
          <b>{m?.name ?? t.medicineId}</b> {inbound ? "from" : "to"} {other}
          <small>{when} · {t.distanceKm.toFixed(1)} km</small>
        </span>
        <span className={s.qty}>
          {inbound ? "+" : "−"}{fmtInt(t.quantity)}
          <small><span className={s.status} data-status={t.status}>{t.status.replace("_", " ")}</span></small>
        </span>
      </li>
    );
  };

  return (
    <div className={[s.root, className].filter(Boolean).join(" ")}>
      <div className={s.layout}>
        <header className={s.head}>
          <p className={s.eyebrow}>
            <span className={s.badge}>{f.type === "WAREHOUSE" ? "WH" : f.type}</span>
            {TYPE_LABEL[f.type]} · {f.block} block · {fmtInt(f.catchmentPopulation)} catchment
          </p>
          <h2 className={s.name}>{f.name}</h2>
          <div className={s.people}>
            <div className={s.person}>
              <span className={s.avatar} aria-hidden>{initials(f.pharmacist.name)}</span>
              <span>
                <b>{f.pharmacist.name}</b>
                <small>
                  Pharmacist · {LANG[f.pharmacist.language] ?? f.pharmacist.language} ·{" "}
                  <a href={`tel:${f.pharmacist.phone.replace(/\s/g, "")}`}>
                    <Phone aria-hidden style={{ width: 10, height: 10, verticalAlign: -1 }} /> {f.pharmacist.phone}
                  </a>
                </small>
              </span>
            </div>
            <span className={s.voice} title={voice ? fmtDateTime(voice.lastReportAt) : undefined}>
              <Mic aria-hidden />
              {voice ? <>Voice report {fmtAgo(voice.lastReportAt, state.now)}</> : latest ? <>Last report {fmtAgo(latest.lastReportAt, state.now)}</> : "No reports yet"}
            </span>
          </div>
          <div className={s.stats} role="list" aria-label="Facility summary">
            <div className={s.stat} role="listitem"><span>Lines</span><b>{lines.length}</b></div>
            <div className={s.stat} role="listitem"><span>At risk</span><b>{atRisk}</b></div>
            <div className={s.stat} role="listitem"><span>Stocked out</span><b data-alert={outs > 0 ? "true" : undefined}>{outs}</b></div>
            <div className={s.stat} role="listitem"><span>To verify</span><b>{unverified}</b></div>
          </div>
        </header>

        {forecastMed && (
          <section className={`${s.section} ${s.forecastSlot}`} aria-label="Forecast">
            <div className={s.forecastCard}>
              <ForecastChart facilityId={f.id} medicineId={forecastMed} height={forecastHeight} />
            </div>
          </section>
        )}

        <section className={s.section} aria-label="Medicines at this facility">
          <h3 className={s.sectionTitle}>
            Medicines <small>worst first · select to forecast</small>
          </h3>
          {lines.length ? (
            <ul className={s.meds}>
              {lines.map(({ a, r, m, inbound }) => (
                <li key={m.id}>
                  <button type="button" className={s.med} aria-current={forecastMed === m.id ? "true" : undefined} onClick={() => pick(m.id)}
                    aria-label={`${m.name} ${m.strength}: ${fmtDays(a.daysOfStock)} days, ${a.risk}`}>
                    <span className={s.medName}>
                      <b>{m.name} <span style={{ fontWeight: 400, color: "var(--muted)" }}>{m.strength}</span></b>
                      <small>
                        {fmtInt(r.stock)} {m.unit.split(" ")[0]}
                        {r.nearExpiry && <span className={s.flag} title="Near-expiry stock"><Hourglass aria-hidden />exp</span>}
                        {(!r.verified || r.recountRequested) && <span className={s.flag} title="Count not verified"><CircleHelp aria-hidden />verify</span>}
                        {inbound.length > 0 && <span className={s.flag} title="Inbound transfer" style={{ color: "var(--accent)" }}><ArrowDownLeft aria-hidden />+{fmtInt(inbound.reduce((n, t) => n + t.quantity, 0))}</span>}
                      </small>
                    </span>
                    <Sparkline values={[...r.history.slice(0, -1).map((h) => h.closingStock), r.stock]} width={88} height={24} threshold={a.thresholdDays * r.dailyUse} risk={a.risk} ariaLabel={`${m.name} weekly closing stock`} />
                    <span className={s.days}>{fmtDays(a.daysOfStock)}<small>d</small></span>
                    <RiskChip risk={a.risk} size="sm" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.none}>No stock lines reported.</p>
          )}
        </section>

        <div className={s.cols}>
          <section className={s.section} aria-label="Near-expiry stock">
            <h3 className={s.sectionTitle}>Near expiry <small>{expiring.length || "none"}</small></h3>
            {expiring.length ? (
              <ul className={s.list}>
                {expiring.map(({ r, m, unused }) => (
                  <li key={m.id} className={s.item}>
                    <Clock aria-hidden />
                    <span>
                      <b>{m.name}</b> {m.strength}
                      <small>Expires {fmtDate(r.nearExpiry!.expiresOn)}{unused > 0 ? ` · ${fmtInt(unused)} would expire unused` : " · will be used in time"}</small>
                    </span>
                    <span className={s.qty}>{fmtInt(r.nearExpiry!.quantity)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.none}>No batches near expiry.</p>
            )}
          </section>

          <section className={s.section} aria-label="Transfers">
            <h3 className={s.sectionTitle}>Transfers <small>in & out</small></h3>
            {transfers.length ? <ul className={s.list}>{transfers.map(transferRow)}</ul> : <p className={s.none}>No transfers involving this facility.</p>}
          </section>

          <section className={s.section} aria-label="Recent activity">
            <h3 className={s.sectionTitle}>Recent activity</h3>
            {events.length ? (
              <ol className={s.timeline}>
                {events.map((e) => (
                  <li key={e.id} className={s.event}>
                    <i data-kind={e.kind} aria-hidden />
                    <div>
                      <b>{e.title}</b>
                      {e.detail && <p>{e.detail}</p>}
                      <small>{fmtAgo(e.at, state.now)} · {e.actor}</small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={s.none}>No recorded events yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
