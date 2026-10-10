"use client";
import { useState } from "react";
import { ArrowRight, CircleCheck, Home, Phone, RotateCcw } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { checkCount, keypadReportActions } from "@/lib/pharmacist/actions";
import type { PharmacistView, StockRow } from "@/lib/pharmacist/derive";
import { agoHi, dayHi, medicineHi, unitEn, unitHi } from "@/lib/pharmacist/hindi";
import { NumberEntry } from "./NumberEntry";
import type { Screen } from "./PhoneApp";
import { StockRowView } from "./StockRowView";
import s from "./phone.module.css";

function orderForCount(view: PharmacistView): StockRow[] {
  const pending = new Set(view.checkin.pending.map((r) => r.medicine.id));
  const score = (r: StockRow) =>
    (r.record.recountRequested ? 0 : 100) + (pending.has(r.medicine.id) ? 0 : 50) + Math.min(49, r.assessment.daysOfStock);
  return [...view.rows].sort((a, b) => score(a) - score(b));
}

export function CheckinScreen({ view, now, go, onCall }: { view: PharmacistView; now: string; go: (s: Screen) => void; onCall: () => void }) {
  const pending = new Set(view.checkin.pending.map((r) => r.medicine.id));
  const rows = orderForCount(view);
  return (
    <>
      <section className={`${s.card}`} style={{ display: "grid", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>हर हफ़्ते, एक मिनट की कॉल</div>
          <div className={s.en}>One short call a week. Say each count in Hindi; it is read back before saving.</div>
        </div>
        <button type="button" className={`${s.btn} ${s.go} ${s.block} ${s.big}`} onClick={onCall}>
          <Phone aria-hidden />
          <span className={s.btnStack}>मुझे अभी कॉल करें<small>Call me now</small></span>
        </button>
      </section>

      <section style={{ display: "grid", gap: 10 }} aria-labelledby="ph-keypad">
        <div className={s.sectionHead}>
          <h2 id="ph-keypad">या खुद लिखें <span className={s.en}>Or type each count</span></h2>
          <span>{view.checkin.done}/{view.checkin.total}</span>
        </div>
        <div className={s.list}>
          {rows.map((r) => (
            <StockRowView
              key={r.medicine.id}
              row={r}
              done={!pending.has(r.medicine.id) && !r.record.recountRequested}
              flag={r.record.recountRequested ? "दोबारा गिनें · Recount" : undefined}
              onClick={() => go({ name: "count", medicineId: r.medicine.id, recount: Boolean(r.record.recountRequested) })}
            />
          ))}
        </div>
        <p className={s.en} style={{ margin: "0 2px" }}>
          Last report {view.checkin.lastAt ? agoHi(view.checkin.lastAt, now) : "—"}. Days left = shelf count ÷ daily use.
        </p>
      </section>
    </>
  );
}

export function CountScreen({ view, medicineId, recount, go, notify }: {
  view: PharmacistView;
  medicineId: string;
  recount?: boolean;
  go: (s: Screen) => void;
  notify: (hi: string, en: string) => void;
}) {
  const { state, dispatch } = useDistrict();
  const row = view.rows.find((r) => r.medicine.id === medicineId);
  const [saved, setSaved] = useState<number | null>(null);
  if (!row) return <div className={s.empty}>दवा नहीं मिली · Medicine not found</div>;
  const m = row.medicine;
  const uHi = unitHi(m);
  const uEn = unitEn(m);

  if (saved !== null) {
    const next = orderForCount(view).find((r) => r.medicine.id !== medicineId && (view.checkin.pending.some((p) => p.medicine.id === r.medicine.id) || r.record.recountRequested));
    return (
      <div className={s.done}>
        <span className={s.doneIcon}><CircleCheck aria-hidden /></span>
        <h2>सेव हो गया</h2>
        <p>{medicineHi(m)}: {saved} {unitHi(m, saved)}</p>
        <p className={s.en}>Saved and sent to the district office.</p>
        <div style={{ display: "grid", gap: 10, width: "100%", marginTop: 12 }}>
          {next ? (
            <button type="button" className={`${s.btn} ${s.primary} ${s.block} ${s.big}`} onClick={() => { setSaved(null); go({ name: "count", medicineId: next.medicine.id, recount: Boolean(next.record.recountRequested) }); }}>
              <span className={s.btnStack}>अगली दवा: {medicineHi(next.medicine)}<small>Next: {next.medicine.name}</small></span>
              <ArrowRight aria-hidden />
            </button>
          ) : null}
          <button type="button" className={`${s.btn} ${s.block}`} onClick={() => go({ name: "home" })}>
            <Home aria-hidden />
            <span className={s.btnStack}>होम<small>Back to home</small></span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className={s.hero} style={{ gap: 4 }}>
        <div className={s.heroMed}>{medicineHi(m)} <span className={s.en}>{m.name} {m.strength}</span></div>
        <div className={s.medSub}>
          पिछली गिनती: <b style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{row.record.stock}</b> {uHi} · {dayHi(row.record.lastReportAt)}
        </div>
        <div className={s.en}>Last count {row.record.stock} {uEn} (1 = {m.unit}).</div>
      </section>
      {recount && row.record.recountRequested ? (
        <div className={s.note} data-tone="warn">
          <RotateCcw aria-hidden />
          <div>
            जिला कार्यालय ने दोबारा गिनने को कहा है। अलमारी और स्टोर, दोनों जगह गिनें।
            <div className={s.en}>{row.record.recountRequested.reason}</div>
          </div>
        </div>
      ) : null}
      <NumberEntry
        key={medicineId}
        unitHi={uHi}
        unitEn={uEn}
        prompt={{ hi: `अलमारी में कितने ${uHi} हैं?`, en: `How many ${uEn} are on the shelf now?` }}
        warn={(n) => {
          const c = checkCount(state, view.facility.id, medicineId, n);
          if (c.plausible || c.expected === null) return null;
          return {
            hi: `पिछले हफ़्ते के हिसाब से लगभग ${c.expected} ${uHi} होने चाहिए। एक बार फिर गिन लें?`,
            en: `Based on last week, about ${c.expected} expected (${c.min}–${c.max}). Please count once more if unsure.`,
          };
        }}
        confirmLabel={{ hi: "हाँ, यही गिनती है — भेजें", en: "Yes, send this count" }}
        onConfirm={(n) => {
          keypadReportActions(state, view.facility, medicineId, n, { answeringRecount: recount }).forEach(dispatch);
          setSaved(n);
          notify("गिनती भेज दी गई", `${m.name}: ${n} ${unitEn(m, n)} sent to the district office`);
        }}
      />
    </>
  );
}
