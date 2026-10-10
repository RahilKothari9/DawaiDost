"use client";
// OWNER: find agent. ASHA mode: one line per medicine for a patient, plus a Hindi SMS the ASHA can forward.
import { useMemo, useState } from "react";
import { ArrowRight, Check, Copy, MessageSquareText, Share2, Truck, X } from "lucide-react";
import type { FindAnswer, Origin } from "@/lib/find/answer";
import { arrivingText, bandText, medShort, placeName, smsSummary, type Lang } from "@/lib/find/copy";
import { BAND_ICON, MedicineIcon } from "./icons";
import { t } from "./strings";
import s from "./find.module.css";

type Props = { lang: Lang; answers: FindAnswer[]; origin: Origin; now: string; onRemove: (id: string) => void };

export function AshaResults({ lang, answers, origin, now, onRemove }: Props) {
  const [copied, setCopied] = useState(false);
  const [smsLang, setSmsLang] = useState<Lang>("hi");
  const sms = useMemo(() => smsSummary(answers, origin, now, smsLang), [answers, origin, now, smsLang]);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sms);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={s.answer} data-tone="asha" aria-live="polite">
      <h2 className={s.sectionTitle}>{t("ashaResults", lang)}: {placeName(origin.homeFacilityId, lang)}</h2>
      <ul className={s.ashaList}>
        {answers.map((a) => {
          const band = a.home?.band ?? "out";
          const BandIcon = BAND_ICON[a.kind === "here" ? "available" : a.kind === "here_low" ? "low" : "out"];
          return (
            <li key={a.medicineId} className={s.ashaRow} data-band={a.kind === "here" ? "available" : a.kind === "here_low" ? "low" : "out"}>
              <span className={s.optionIcon}><MedicineIcon id={a.medicineId} size={20} /></span>
              <span className={s.ashaMain}>
                <span className={s.optionName}>{medShort(a.medicineId, lang)}</span>
                <span className={s.ashaStatus}>
                  <BandIcon size={18} aria-hidden strokeWidth={2.4} />
                  {a.kind === "here" || a.kind === "here_low" ? bandText(band, lang)
                    : a.kind === "elsewhere" && a.go ? <>{lang === "hi" ? "यहाँ नहीं" : "Not here"} <ArrowRight size={16} aria-hidden /> {placeName(a.go.facilityId, lang)}, {a.go.distanceKm} km</>
                    : lang === "hi" ? "आस-पास कहीं नहीं" : "Not available nearby"}
                </span>
                {a.kind !== "here" && a.home?.arrivingInHours != null && (
                  <span className={s.ashaArriving}><Truck size={16} aria-hidden /> {arrivingText(a.home.arrivingInHours, lang)}</span>
                )}
              </span>
              <button type="button" className={s.iconBtn} onClick={() => onRemove(a.medicineId)} aria-label={`${t("clear", lang)}: ${medShort(a.medicineId, lang)}`}>
                <X size={20} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>

      <div className={s.sms}>
        <div className={s.smsHead}>
          <h3 className={s.othersTitle}><MessageSquareText size={20} aria-hidden /> {t("smsTitle", lang)}</h3>
          <div className={s.segmented} role="group" aria-label="SMS language">
            <button type="button" aria-pressed={smsLang === "hi"} onClick={() => setSmsLang("hi")}>हिंदी</button>
            <button type="button" aria-pressed={smsLang === "en"} onClick={() => setSmsLang("en")}>English</button>
          </div>
        </div>
        <pre className={s.smsText} lang={smsLang}>{sms}</pre>
        <div className={s.actions}>
          <button type="button" className={s.primaryBtn} onClick={copy}>
            {copied ? <Check size={22} aria-hidden /> : <Copy size={22} aria-hidden />}
            {copied ? t("copied", lang) : t("copy", lang)}
          </button>
          <a className={s.actionBtn} href={`sms:?&body=${encodeURIComponent(sms)}`}>
            <MessageSquareText size={22} aria-hidden />
            {t("sms", lang)}
          </a>
          {canShare && (
            <button type="button" className={s.actionBtn} onClick={() => navigator.share({ text: sms }).catch(() => undefined)}>
              <Share2 size={22} aria-hidden />
              {t("share", lang)}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
