"use client";
import { useState } from "react";
import { ArrowRight, CircleCheck, Home, Map as MapIcon, PackageCheck, ShieldCheck, Truck, TriangleAlert, Pencil } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { dispatchActions, receiptActions } from "@/lib/pharmacist/actions";
import { dispatchPlan, type PharmacistView } from "@/lib/pharmacist/derive";
import { clockHi, facilityHi, hoursEn, hoursHi, medicineHi, placeHi, unitEn, unitHi } from "@/lib/pharmacist/hindi";
import { transferArrivalAt } from "@/lib/district/engine";
import { NumberEntry } from "./NumberEntry";
import type { Screen } from "./PhoneApp";
import s from "./phone.module.css";

type Common = { view: PharmacistView; transferId: string; go: (s: Screen) => void; notify: (hi: string, en: string) => void };

function HomeButton({ go }: { go: (s: Screen) => void }) {
  return (
    <button type="button" className={`${s.btn} ${s.block}`} onClick={() => go({ name: "home" })}>
      <Home aria-hidden />
      <span className={s.btnStack}>होम<small>Back to home</small></span>
    </button>
  );
}

/** Donor clinic: officer approved a transfer out of this clinic. */
export function DispatchScreen({ view, transferId, go, notify }: Common) {
  const { state, dispatch } = useDistrict();
  const t = state.transfers.find((x) => x.id === transferId);
  const [sent, setSent] = useState(false);
  const plan = t ? dispatchPlan(state, t) : null;
  if (!t || !plan) return <div className={s.empty}>अनुरोध नहीं मिला · Request not found</div>;
  const { medicine: m, to } = plan;
  const uHi = unitHi(m, t.quantity);

  if (sent || t.status !== "approved") {
    const moving = t.status === "in_transit";
    return (
      <div className={s.done}>
        <span className={s.doneIcon} data-tone={moving ? "moving" : undefined}>{moving ? <Truck aria-hidden /> : <CircleCheck aria-hidden />}</span>
        <h2>{moving ? "रवाना हो गया" : t.status === "delivered" ? "पहुँच गया" : "दर्ज हो गया"}</h2>
        <p>{t.quantity} {uHi} {medicineHi(m)} → {facilityHi(to)}</p>
        <p className={s.en}>{moving ? `Dispatched. Arrives around ${clockHi(transferArrivalAt(t))}.` : `Status: ${t.status.replace("_", " ")}.`}</p>
        <div className={s.note} data-tone="moving" style={{ textAlign: "left", width: "100%" }}>
          <MapIcon aria-hidden />
          <div>जिला कार्यालय के नक्शे पर गाड़ी अब दिख रही है।<div className={s.en}>The district officer now sees this consignment moving on the map.</div></div>
        </div>
        <div style={{ width: "100%", marginTop: 8 }}><HomeButton go={go} /></div>
      </div>
    );
  }

  const keepPct = plan.stockNow > 0 ? (plan.stockAfter / plan.stockNow) * 100 : 0;
  return (
    <>
      <section className={s.hero}>
        <span className={s.pill} data-tone="moving" style={{ justifySelf: "start" }}>जिला कार्यालय से मंज़ूर · Approved by district</span>
        <div className={s.heroNum}>{t.quantity}<small>{uHi}</small></div>
        <div className={s.heroMed}>{medicineHi(m)} <span className={s.en}>{m.name} {m.strength}</span></div>
        <div className={s.route}>
          {placeHi(view.facility)} <ArrowRight aria-hidden /> {facilityHi(to)}
        </div>
        <div className={s.medSub}>{t.distanceKm} km · {hoursHi(t.etaHours)} <span className={s.en}>({hoursEn(t.etaHours)} by road)</span></div>
      </section>

      <section className={`${s.card} ${s.split}`} aria-label="Stock after dispatch">
        <div style={{ fontWeight: 700 }}>भेजने के बाद आपके पास <span className={s.en}>Left with you after sending</span></div>
        <div className={s.bar} role="img" aria-label={`${plan.stockAfter} kept, ${t.quantity} sent`}>
          <span className={s.barKeep} style={{ width: `${keepPct}%` }}>{plan.stockAfter}</span>
          <span className={s.barSend} style={{ width: `${100 - keepPct}%` }}>{t.quantity}</span>
        </div>
        <div className={s.legend}>
          <span><b>{plan.stockAfter}</b> {unitHi(m, plan.stockAfter)} रखें{plan.daysAfter !== null ? <> · <b>{plan.daysAfter}</b> दिन</> : null}</span>
          <span><b>{t.quantity}</b> भेजें</span>
        </div>
        <div className={s.note} data-tone={plan.keepsReserve ? "ok" : "warn"}>
          {plan.keepsReserve ? <ShieldCheck aria-hidden /> : <TriangleAlert aria-hidden />}
          <div>
            {plan.keepsReserve
              ? `आपका ${m.reserveDays} दिन का ज़रूरी स्टॉक (${plan.reserveUnits} ${unitHi(m)}) आपके पास ही रहेगा।`
              : `ध्यान दें: भेजने के बाद स्टॉक ${m.reserveDays} दिन के ज़रूरी स्टॉक से कम होगा। जिला कार्यालय को कॉल करें।`}
            <div className={s.en}>
              {plan.keepsReserve
                ? `Your ${m.reserveDays}-day reserve (${plan.reserveUnits} ${unitEn(m)}) stays on your shelf.`
                : `Sending this leaves you below your ${m.reserveDays}-day reserve. Call the district office before packing.`}
            </div>
          </div>
        </div>
      </section>

      <ol className={s.steps}>
        <li><span>{t.quantity} {uHi} गिनकर पैक करें <span className={s.en}>Count and pack {t.quantity}</span></span></li>
        <li><span>डिब्बे पर “{facilityHi(to)}” लिखें <span className={s.en}>Label the box for {to.name}</span></span></li>
        <li><span>गाड़ी के ड्राइवर को सौंपें <span className={s.en}>Hand it to the driver</span></span></li>
      </ol>

      <button
        type="button"
        className={`${s.btn} ${s.moving} ${s.block} ${s.big}`}
        onClick={() => {
          dispatchActions(state, t).forEach(dispatch);
          setSent(true);
          notify("रवाना दर्ज हुआ", `${t.quantity} ${unitEn(m, t.quantity)} dispatched to ${to.name}`);
        }}
      >
        <PackageCheck aria-hidden />
        <span className={s.btnStack}>पैक करके गाड़ी को सौंप दिया<small>Packed &amp; handed to vehicle</small></span>
      </button>
    </>
  );
}

/** Recipient clinic: consignment in transit to this clinic. */
export function ReceiveScreen({ view, transferId, go, notify }: Common) {
  const { state, dispatch } = useDistrict();
  const t = state.transfers.find((x) => x.id === transferId);
  const [mode, setMode] = useState<"ask" | "count" | "done">("ask");
  const [received, setReceived] = useState<number | null>(null);
  const m = t ? state.medicines.find((x) => x.id === t.medicineId) : undefined;
  const from = t ? state.facilities.find((f) => f.id === t.fromId) : undefined;
  if (!t || !m || !from) return <div className={s.empty}>माल नहीं मिला · Consignment not found</div>;
  const uHi = unitHi(m, t.quantity);

  const confirm = (n: number) => {
    receiptActions(state, t, n).forEach(dispatch);
    setReceived(n);
    setMode("done");
    notify("प्राप्ति दर्ज हुई", `${n} ${unitEn(m, n)} ${m.name} added to ${view.facility.name}`);
  };

  if (mode === "done" || t.status === "delivered") {
    const n = received ?? t.quantity;
    const diff = n - t.quantity;
    return (
      <div className={s.done}>
        <span className={s.doneIcon}><CircleCheck aria-hidden /></span>
        <h2>स्टॉक में जुड़ गया</h2>
        <p>{n} {unitHi(m, n)} {medicineHi(m)}</p>
        <p className={s.en}>Added to your stock. The district office sees it now.</p>
        {diff !== 0 ? (
          <div className={s.note} data-tone="warn" style={{ textAlign: "left", width: "100%" }}>
            <TriangleAlert aria-hidden />
            <div>
              {Math.abs(diff)} {unitHi(m, Math.abs(diff))} {diff < 0 ? "कम" : "ज़्यादा"} मिले। जिला कार्यालय और {placeHi(from)} को सूचना भेज दी गई है।
              <div className={s.en}>{Math.abs(diff)} {diff < 0 ? "short" : "over"}. Logged for the district officer; {from.name} asked to recount.</div>
            </div>
          </div>
        ) : null}
        <div style={{ width: "100%", marginTop: 8 }}><HomeButton go={go} /></div>
      </div>
    );
  }

  if (t.status !== "in_transit") {
    return (
      <div className={s.done}>
        <span className={s.doneIcon} data-tone="moving"><Truck aria-hidden /></span>
        <h2>गाड़ी अभी निकली नहीं</h2>
        <p className={s.en}>Not dispatched yet. You will get an SMS when the vehicle leaves {from.name}.</p>
        <div style={{ width: "100%" }}><HomeButton go={go} /></div>
      </div>
    );
  }

  return (
    <>
      <section className={s.hero}>
        <span className={s.pill} data-tone="moving" style={{ justifySelf: "start" }}><Truck aria-hidden /> रास्ते में · On the way</span>
        <div className={s.heroNum}>{t.quantity}<small>{uHi}</small></div>
        <div className={s.heroMed}>{medicineHi(m)} <span className={s.en}>{m.name} {m.strength}</span></div>
        <div className={s.route}>{facilityHi(from)} <ArrowRight aria-hidden /> {placeHi(view.facility)}</div>
        <div className={s.medSub}>लगभग {clockHi(transferArrivalAt(t))} तक <span className={s.en}>(expected by {clockHi(transferArrivalAt(t))})</span></div>
      </section>

      {mode === "ask" ? (
        <>
          <div className={s.note}>
            <PackageCheck aria-hidden />
            <div>डिब्बा खोलकर गिनें, फिर बताएँ कितने मिले।<div className={s.en}>Open the box and count before confirming.</div></div>
          </div>
          <button type="button" className={`${s.btn} ${s.go} ${s.block} ${s.big}`} onClick={() => confirm(t.quantity)}>
            <CircleCheck aria-hidden />
            <span className={s.btnStack}>पूरे {t.quantity} {uHi} मिले<small>Received all {t.quantity}</small></span>
          </button>
          <button type="button" className={`${s.btn} ${s.block} ${s.big}`} onClick={() => setMode("count")}>
            <Pencil aria-hidden />
            <span className={s.btnStack}>कम या ज़्यादा मिले<small>Different count</small></span>
          </button>
        </>
      ) : (
        <NumberEntry
          unitHi={unitHi(m)}
          unitEn={unitEn(m)}
          prompt={{ hi: `कितने ${unitHi(m)} मिले?`, en: `How many ${unitEn(m)} arrived? (sent: ${t.quantity})` }}
          max={t.quantity * 3}
          warn={(n) => n === t.quantity ? null : {
            hi: `भेजे गए ${t.quantity} थे। ${Math.abs(n - t.quantity)} ${n < t.quantity ? "कम" : "ज़्यादा"} दर्ज होंगे और जिला कार्यालय को सूचना जाएगी।`,
            en: `${t.quantity} were sent. A ${Math.abs(n - t.quantity)}-unit ${n < t.quantity ? "shortfall" : "excess"} will be reported to the district office.`,
          }}
          confirmLabel={{ hi: "हाँ, इतने ही मिले", en: "Yes, this many arrived" }}
          onConfirm={(n) => confirm(n)}
        />
      )}
    </>
  );
}
