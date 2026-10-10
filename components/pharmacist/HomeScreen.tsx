"use client";
import { ArrowRight, CircleCheck, ClipboardList, Keyboard, PackageOpen, Phone, RotateCcw, Truck, ArrowDownToLine } from "lucide-react";
import type { PharmacistView } from "@/lib/pharmacist/derive";
import { agoHi, clockHi, facilityHi, hoursEn, hoursHi, medicineHi, placeHi, unitHi } from "@/lib/pharmacist/hindi";
import type { Screen } from "./PhoneApp";
import { StockRowView } from "./StockRowView";
import s from "./phone.module.css";

export function HomeScreen({ view, now, go }: { view: PharmacistView; now: string; go: (s: Screen) => void }) {
  const { checkin, dispatch, incoming, recounts, low, outgoingInTransit } = view;
  const receivable = incoming.filter((i) => i.transfer.status === "in_transit");
  const awaiting = incoming.filter((i) => i.transfer.status === "approved");
  const pct = checkin.total ? Math.round((checkin.done / checkin.total) * 100) : 0;
  const hasTasks = dispatch.length + receivable.length + recounts.length > 0;

  return (
    <>
      {hasTasks ? (
        <section aria-labelledby="ph-tasks" style={{ display: "grid", gap: 10 }}>
          <div className={s.sectionHead}>
            <h2 id="ph-tasks">आज के काम <span className={s.en}>To do</span></h2>
          </div>
          {receivable.map((r) => (
            <button key={r.transfer.id} type="button" className={s.task} data-tone="receive" onClick={() => go({ name: "receive", transferId: r.transfer.id })}>
              <span className={s.taskIcon}><Truck aria-hidden /></span>
              <span>
                <span className={s.taskKicker}>माल आ रहा है · ARRIVING</span>
                <span className={s.taskTitle} style={{ display: "block" }}>{r.transfer.quantity} {unitHi(r.medicine, r.transfer.quantity)} {medicineHi(r.medicine)}</span>
                <span className={s.taskMeta}>{placeHi(r.from)} से · {hoursHi(r.hoursLeft)} में <span className={s.en}>({hoursEn(r.hoursLeft)})</span></span>
                <span className={s.taskCta}>पहुँचने पर गिनें <span className={s.en}>Count on arrival</span> <ArrowRight aria-hidden /></span>
              </span>
            </button>
          ))}
          {dispatch.map((d) => (
            <button key={d.transfer.id} type="button" className={s.task} data-tone="dispatch" onClick={() => go({ name: "dispatch", transferId: d.transfer.id })}>
              <span className={s.taskIcon}><PackageOpen aria-hidden /></span>
              <span>
                <span className={s.taskKicker}>भेजना है · SEND</span>
                <span className={s.taskTitle} style={{ display: "block" }}>{d.transfer.quantity} {unitHi(d.medicine, d.transfer.quantity)} {medicineHi(d.medicine)}</span>
                <span className={s.taskMeta}>{facilityHi(d.to)} के लिए <span className={s.en}>to {d.to.name}</span></span>
                <span className={s.taskCta}>पैक करें <span className={s.en}>Pack it</span> <ArrowRight aria-hidden /></span>
              </span>
            </button>
          ))}
          {recounts.map((r) => (
            <button key={r.medicine.id} type="button" className={s.task} data-tone="recount" onClick={() => go({ name: "count", medicineId: r.medicine.id, recount: true })}>
              <span className={s.taskIcon}><RotateCcw aria-hidden /></span>
              <span>
                <span className={s.taskKicker}>दोबारा गिनें · RECOUNT</span>
                <span className={s.taskTitle} style={{ display: "block" }}>{medicineHi(r.medicine)} <span className={s.en}>{r.medicine.name} {r.medicine.strength}</span></span>
                <span className={s.taskMeta}>जिला कार्यालय ने पूछा है <span className={s.en}>District asked for a recount</span></span>
                <span className={s.taskCta}>गिनती लिखें <span className={s.en}>Enter count</span> <ArrowRight aria-hidden /></span>
              </span>
            </button>
          ))}
        </section>
      ) : null}

      <section className={`${s.card} ${s.checkin}`} aria-labelledby="ph-checkin">
        <div className={s.checkinTop}>
          <span className={s.ring} style={{ ["--p" as string]: pct }}>
            <span>{checkin.complete ? <CircleCheck aria-hidden /> : `${checkin.done}/${checkin.total}`}</span>
          </span>
          <div>
            <strong id="ph-checkin">{checkin.complete ? "इस हफ़्ते की गिनती हो गई" : "इस हफ़्ते की गिनती बाकी"}</strong>
            <small>
              {checkin.complete ? `This week's count is done` : `${checkin.total - checkin.done} medicines still to count`}
              {checkin.lastAt ? ` · ${agoHi(checkin.lastAt, now)}` : ""}
            </small>
          </div>
        </div>
        <div className={s.row2}>
          <button type="button" className={`${s.btn} ${checkin.complete ? "" : s.primary}`} onClick={() => go({ name: "checkin", call: true })}>
            <Phone aria-hidden />
            <span className={s.btnStack}>कॉल करें<small>Call me now</small></span>
          </button>
          <button type="button" className={s.btn} onClick={() => go({ name: "checkin" })}>
            <Keyboard aria-hidden />
            <span className={s.btnStack}>खुद लिखें<small>Type counts</small></span>
          </button>
        </div>
      </section>

      <section aria-labelledby="ph-low" style={{ display: "grid", gap: 10 }}>
        <div className={s.sectionHead}>
          <h2 id="ph-low">कम स्टॉक <span className={s.en}>Running low</span></h2>
          <span>दिन बचे · days left</span>
        </div>
        {low.length ? (
          <div className={s.list}>
            {low.map((r) => (
              <StockRowView key={r.medicine.id} row={r} onClick={() => go({ name: "count", medicineId: r.medicine.id })} />
            ))}
          </div>
        ) : (
          <div className={`${s.card} ${s.empty}`}><CircleCheck aria-hidden className={s.check} /> सब दवाइयाँ पर्याप्त हैं · All medicines have enough stock</div>
        )}
      </section>

      {awaiting.length || receivable.length ? (
        <section aria-labelledby="ph-in" style={{ display: "grid", gap: 10 }}>
          <div className={s.sectionHead}>
            <h2 id="ph-in">आने वाला माल <span className={s.en}>Incoming</span></h2>
          </div>
          <div className={s.list}>
            {[...receivable, ...awaiting].map((r) => {
              const moving = r.transfer.status === "in_transit";
              const progress = moving && r.transfer.dispatchedAt
                ? Math.min(1, Math.max(0.04, (Date.parse(now) - Date.parse(r.transfer.dispatchedAt)) / (r.transfer.etaHours * 36e5)))
                : 0;
              return (
                <div key={r.transfer.id} className={s.stockRow} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                  <div>
                    <div className={s.medName}>{r.transfer.quantity} {unitHi(r.medicine, r.transfer.quantity)} {medicineHi(r.medicine)}</div>
                    <div className={s.medSub}>{placeHi(r.from)} से · {r.from.name}</div>
                    {moving ? <div className={s.transit} aria-hidden><i style={{ width: `${progress * 100}%` }} /></div> : null}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className={s.pill} data-tone={moving ? "moving" : undefined}>
                      {moving ? <Truck aria-hidden /> : <ClipboardList aria-hidden />}
                      {moving ? "रास्ते में" : "मंज़ूर"}
                    </span>
                    <div className={s.medSub} style={{ marginTop: 4 }}>
                      {moving ? `${clockHi(r.arrivalAt)} तक` : "गाड़ी का इंतज़ार"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {outgoingInTransit.length ? (
        <section aria-labelledby="ph-out" style={{ display: "grid", gap: 10 }}>
          <div className={s.sectionHead}>
            <h2 id="ph-out">भेजा गया <span className={s.en}>Sent</span></h2>
          </div>
          <div className={s.list}>
            {outgoingInTransit.map((r) => (
              <div key={r.transfer.id} className={s.stockRow} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <div>
                  <div className={s.medName}>{r.transfer.quantity} {unitHi(r.medicine, r.transfer.quantity)} {medicineHi(r.medicine)}</div>
                  <div className={s.medSub}>{facilityHi(r.from)} को · to {r.from.name}</div>
                </div>
                <span className={s.pill} data-tone="moving"><ArrowDownToLine aria-hidden style={{ transform: "rotate(-90deg)" }} /> रास्ते में</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
