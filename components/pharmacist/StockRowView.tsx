"use client";
import { ArrowDownToLine, CircleCheck } from "lucide-react";
import type { StockRow } from "@/lib/pharmacist/derive";
import { daysHi, medicineHi, unitHi } from "@/lib/pharmacist/hindi";
import s from "./phone.module.css";

/** One medicine: big days-left number, Hindi name, shelf count. */
export function StockRowView({ row, onClick, done, flag }: { row: StockRow; onClick?: () => void; done?: boolean; flag?: string }) {
  const d = daysHi(row.assessment.daysOfStock);
  const body = (
    <>
      <span className={s.days} data-risk={row.assessment.risk} aria-label={`${d.value} days left`}>
        <b>{d.value}</b>
        <span>{d.label}</span>
      </span>
      <span style={{ minWidth: 0 }}>
        <span className={s.medName} style={{ display: "block" }}>{medicineHi(row.medicine)}</span>
        <span className={s.medSub} style={{ display: "block" }}>{row.medicine.name} {row.medicine.strength}</span>
        {flag ? <span className={s.pill} data-tone="warn" style={{ marginTop: 4 }}>{flag}</span> : null}
        {row.inbound > 0 ? (
          <span className={s.inbound}><ArrowDownToLine aria-hidden /> +{row.inbound} आ रहा है</span>
        ) : null}
      </span>
      <span className={s.qty}>
        {done ? <CircleCheck aria-label="Counted this week" className={s.check} style={{ width: 22, height: 22, display: "block", marginLeft: "auto" }} /> : null}
        {row.record.stock}
        <small>{unitHi(row.medicine, row.record.stock)}</small>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={s.stockRow} onClick={onClick}>{body}</button>
  ) : (
    <div className={s.stockRow}>{body}</div>
  );
}
