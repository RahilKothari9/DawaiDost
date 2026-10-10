"use client";
// OWNER: escalations agent. The printable escalation memo. Figures come from code; prose may be model-written.
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { EscalationMemo, MemoResponse } from "@/lib/escalations/memo";
import { fmtLongDate, fmtUnits } from "@/lib/escalations/memo";
import s from "./escalations.module.css";

export function MemoSheet({ memo, response, district, officer }: { memo: EscalationMemo; response: MemoResponse; district: string; officer: { name: string; title: string } }) {
  const remarks = memo.evidence.some((e) => e.remark);
  return (
    <article className={s.sheet} aria-label="Escalation memo">
      <header className={s.sheetHead}>
        <div className={s.sheetOffice}>
          Office of the {officer.title}
          <small>District {district}</small>
        </div>
        <div className={s.sheetMeta}>
          <div>No. {memo.ref}</div>
          <div>Date: {fmtLongDate(memo.date)}</div>
          <span className={s.sheetDraft}>Synthetic demo data</span>
        </div>
      </header>
      <dl className={s.addr}>
        <dt>To</dt><dd>{memo.to}</dd>
        <dt>From</dt><dd>{memo.from}</dd>
        <dt>Copy</dt><dd>{memo.cc.join("; ")}</dd>
      </dl>
      <p className={s.subject}>Subject: {memo.subject}</p>
      <p>{memo.summary}</p>

      <h3>Evidence (from the district stock ledger as of {fmtLongDate(memo.date)})</h3>
      <div className={s.scrollX}><table className={s.evidence}>
        <thead><tr><th scope="col">Indicator</th><th scope="col">Value</th>{remarks ? <th scope="col">Remark</th> : null}</tr></thead>
        <tbody>
          {memo.evidence.map((e) => (
            <tr key={e.key}><td>{e.label}</td><td className={s.val}>{e.value}</td>{remarks ? <td>{e.remark}</td> : null}</tr>
          ))}
        </tbody>
      </table></div>

      <h3>Requests</h3>
      <ol className={s.asks}>{memo.asks.map((a, i) => <li key={i}>{a}</li>)}</ol>
      <p style={{ marginTop: 10 }}><strong>Requested delivery to district warehouse: on or before {fmtLongDate(memo.requestedDeliveryDate)}.</strong></p>

      <h3>सारांश (हिंदी)</h3>
      <p className={s.hindi} lang="hi">{memo.hindiSummary}</p>

      {memo.annex.length ? (
        <>
          <h3>Annexure: facilities below required cover</h3>
          <div className={s.scrollX}><table className={s.evidence}>
            <thead><tr><th scope="col">Facility</th><th scope="col">Block</th><th scope="col">Days of stock</th><th scope="col">Units needed</th><th scope="col">Catchment</th></tr></thead>
            <tbody>
              {memo.annex.map((a) => (
                <tr key={a.name}><td>{a.name}</td><td>{a.block}</td><td className={s.val}>{a.daysOfStock ?? "—"}</td><td className={s.val}>{fmtUnits(a.needUnits)}</td><td className={s.val}>{fmtUnits(a.population)}</td></tr>
              ))}
            </tbody>
          </table></div>
        </>
      ) : null}

      <div className={s.signoff}>
        <div>
          <small>Enclosure: facility stock ledger extract</small>
        </div>
        <div style={{ textAlign: "right" }}>
          ({officer.name})
          <small>{officer.title}, {district}</small>
        </div>
      </div>
      <p className={s.footnote}>
        Figures computed by Dawai Dost from facility stock reports. {response.source === "live"
          ? `Wording drafted by ${response.model ?? "an OpenAI model"}; every number was checked against the computed figures.`
          : "Wording from the standard template."} Draft for officer review; nothing is sent automatically.
      </p>
    </article>
  );
}

const subscribe = () => () => {};

/** Renders the memo into a body-level node that is the only thing visible when printing. */
export function PrintPortal({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <div className={s.printRoot} data-escalation-print="">
      <style media="print">{`body > *:not([data-escalation-print]) { display: none !important; } @page { size: A4; margin: 16mm 14mm; } body { background: #fff !important; }`}</style>
      {children}
    </div>,
    document.body,
  );
}
