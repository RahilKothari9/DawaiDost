"use client";
// OWNER: analytics agent. Headline KPI row for the district command center.
import { useMemo, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, OctagonX, Radio, ShieldCheck, Sparkles, TriangleAlert, Truck, Inbox } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { fmtAgo, fmtCompact, fmtPct, fmtSigned } from "@/lib/analytics/format";
import { useCountUp } from "@/lib/analytics/hooks";
import { computeKpis } from "@/lib/analytics/metrics";
import { Sparkline } from "./Sparkline";
import s from "./KpiStrip.module.css";

export type KpiStripProps = { variant?: "full" | "compact"; className?: string };

function Count({ value, digits = 0, suffix }: { value: number; digits?: number; suffix?: ReactNode }) {
  const v = useCountUp(value);
  return (
    <>
      {digits ? v.toFixed(digits) : fmtCompact(Math.round(v))}
      {suffix && <small>{suffix}</small>}
    </>
  );
}

function Delta({ series, upIsBad = true, unit = "vs last wk" }: { series: number[]; upIsBad?: boolean; unit?: string }) {
  if (series.length < 2) return null;
  const d = series[series.length - 1]! - series[series.length - 2]!;
  const tone = d === 0 ? "flat" : (d > 0) === upIsBad ? "bad" : "good";
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return (
    <span className={s.delta} data-tone={tone}>
      <Icon aria-hidden strokeWidth={2.4} />
      {fmtSigned(d)} <span className={s.muted}>{unit}</span>
    </span>
  );
}

type Tile = {
  id: string;
  label: string;
  icon: ReactNode;
  value: ReactNode;
  aria: string;
  spark?: ReactNode;
  foot?: ReactNode;
  accent?: boolean;
  alert?: boolean;
};

export function KpiStrip({ variant = "full", className }: KpiStripProps) {
  const { state } = useDistrict();
  const k = useMemo(() => computeKpis(state), [state]);
  const compact = variant === "compact";
  const silent = k.facilitiesTotal - k.facilitiesReporting;

  const tiles: Tile[] = [
    {
      id: "reporting",
      label: "Reporting this week",
      icon: <Radio aria-hidden />,
      value: <><Count value={k.facilitiesReporting} /><small>/{k.facilitiesTotal}</small></>,
      aria: `${k.facilitiesReporting} of ${k.facilitiesTotal} facilities reported in the last 7 days`,
      spark: (
        <span className={s.meter} aria-hidden>
          {Array.from({ length: Math.min(k.facilitiesTotal, 30) }, (_, i) => (
            <i key={i} data-on={i < Math.round((k.facilitiesReporting / Math.max(1, k.facilitiesTotal)) * Math.min(k.facilitiesTotal, 30))} />
          ))}
        </span>
      ),
      foot: silent > 0 ? <span>{silent} silent &gt; 7 days</span> : <span className={s.muted}>All facilities current</span>,
    },
    {
      id: "atrisk",
      label: "At-risk stock lines",
      icon: <TriangleAlert aria-hidden style={{ color: "var(--risk-critical)" }} />,
      value: <Count value={k.atRisk} />,
      aria: `${k.atRisk} facility-medicine lines below the planning threshold`,
      spark: <Sparkline values={k.atRiskSeries} width={72} height={26} color="var(--risk-critical)" ariaLabel={`At-risk lines, last ${k.atRiskSeries.length} weeks`} />,
      foot: <Delta series={k.atRiskSeries} />,
    },
    {
      id: "stockouts",
      label: "Active stockouts",
      icon: <OctagonX aria-hidden style={{ color: "var(--risk-stockout)" }} />,
      value: <Count value={k.stockouts} />,
      alert: k.stockouts > 0,
      aria: `${k.stockouts} facility-medicine lines with zero stock`,
      spark: <Sparkline values={k.stockoutSeries} width={72} height={26} color="var(--risk-stockout)" ariaLabel={`Stockouts, last ${k.stockoutSeries.length} weeks`} />,
      foot: <Delta series={k.stockoutSeries} />,
    },
    {
      id: "transit",
      label: "Units in transit",
      icon: <Truck aria-hidden style={{ color: "var(--accent)" }} />,
      value: <Count value={k.unitsInTransit} />,
      accent: true,
      aria: `${k.unitsInTransit} units moving in ${k.transfersInTransit} transfers`,
      foot: <span>{k.transfersInTransit} {k.transfersInTransit === 1 ? "transfer" : "transfers"} on the road</span>,
    },
    {
      id: "averted",
      label: "Stockout-days averted",
      icon: <ShieldCheck aria-hidden style={{ color: "var(--accent)" }} />,
      value: <Count value={k.avertedDays} digits={1} suffix="d" />,
      accent: true,
      aria: `${k.avertedDays.toFixed(1)} projected stockout-days averted by approved transfers`,
      spark: k.avertedSeries.length > 1 ? <Sparkline values={k.avertedSeries} width={72} height={26} color="var(--accent)" fill ariaLabel="Cumulative stockout-days averted" /> : undefined,
      foot: <span className={s.muted}>Projected, within resupply window</span>,
    },
    {
      id: "pending",
      label: "Decisions pending",
      icon: <Inbox aria-hidden />,
      value: <Count value={k.decisionsPending} />,
      aria: `${k.decisionsPending} decisions awaiting officer approval`,
      foot: k.oldestPendingAt ? <span>Oldest {fmtAgo(k.oldestPendingAt, state.now)}</span> : <span className={s.muted}>Queue clear</span>,
    },
    {
      id: "live",
      label: "Live Decisions API",
      icon: <Sparkles aria-hidden style={{ color: "var(--accent)" }} />,
      value: k.liveShare === null ? <>—</> : <Count value={Math.round(k.liveShare * 100)} suffix="%" />,
      accent: true,
      aria: k.liveShare === null ? "No decisions yet" : `${fmtPct(k.liveShare)} of decisions from the live Decisions API, ${k.fallbackDecisions} from demo fallback`,
      spark:
        k.decisionsTotal > 0 ? (
          <span className={s.split} aria-hidden>
            <i style={{ width: `${(k.liveDecisions / Math.max(1, k.liveDecisions + k.fallbackDecisions)) * 100}%`, background: "var(--accent)" }} />
            <i style={{ flex: 1, background: "var(--line-strong)" }} />
          </span>
        ) : undefined,
      foot: k.decisionsTotal ? <span>{k.liveDecisions} live · {k.fallbackDecisions} fallback</span> : <span className={s.muted}>No decisions yet</span>,
    },
  ];

  return (
    <section className={[s.strip, compact && s.compact, className].filter(Boolean).join(" ")} aria-label="District headline indicators">
      {tiles.map((t) => (
        <div key={t.id} className={s.tile} data-accent={t.accent ? "true" : undefined} role="group" aria-label={t.aria}>
          <p className={s.label} aria-hidden>
            {t.icon}
            {t.label}
          </p>
          <div className={s.valueRow} aria-hidden>
            <p className={s.value} data-alert={t.alert ? "true" : undefined}>{t.value}</p>
            {!compact && t.spark}
          </div>
          <p className={s.foot} aria-hidden>{t.foot}</p>
        </div>
      ))}
    </section>
  );
}
