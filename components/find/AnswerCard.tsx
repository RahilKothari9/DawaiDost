"use client";
// OWNER: find agent. The answer: where to go, how sure we are, and what is on the way. Bands only, never counts.
import { useState } from "react";
import { Clock, Flag, MapPin, PackageX, Truck, Users, Volume2, VolumeX } from "lucide-react";
import type { FacilityOption, FindAnswer } from "@/lib/find/answer";
import { answerCopy, arrivingText, bandText, freshnessText, kmText, medShort, placeName, speakText, type Lang } from "@/lib/find/copy";
import { BAND_ICON } from "./icons";
import { speak, stopSpeaking } from "./speech";
import { t } from "./strings";
import s from "./find.module.css";

const OTHERS_SHOWN = 4;

function BandPill({ band, lang, size = "md" }: { band: FacilityOption["band"]; lang: Lang; size?: "md" | "lg" }) {
  const Icon = BAND_ICON[band];
  return (
    <span className={s.band} data-band={band} data-size={size}>
      <Icon size={size === "lg" ? 26 : 18} aria-hidden strokeWidth={2.4} />
      {bandText(band, lang)}
    </span>
  );
}

function ReportsNote({ n, lang }: { n: number; lang: Lang }) {
  if (!n) return null;
  return (
    <p className={s.metaRow} data-tone="warn">
      <Users size={20} aria-hidden />
      <span>{n === 1 ? t("patientReported", lang) : `${n} ${t("patientsReported", lang)}`}</span>
    </p>
  );
}

type Props = {
  lang: Lang;
  answer: FindAnswer;
  now: string;
  reported: boolean;
  onReport: () => void;
};

export function AnswerCard({ lang, answer, now, reported, onReport }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const copy = answerCopy(answer, lang);
  const focus = answer.go ?? answer.home;
  const tone = answer.kind === "here" ? "available" : answer.kind === "here_low" ? "low" : answer.kind === "elsewhere" ? "elsewhere" : "out";
  const others = answer.others.filter((o) => o.facilityId !== answer.go?.facilityId);
  const shown = showAll ? others : others.slice(0, OTHERS_SHOWN);
  const home = answer.home;

  const toggleSpeak = async () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    await speak(speakText(answer, lang), lang);
    setSpeaking(false);
  };

  return (
    <article className={s.answer} data-tone={tone} aria-live="polite">
      <header className={s.answerHead}>
        <span className={s.answerMed}>{medShort(answer.medicineId, lang)}</span>
        {answer.kind === "here" || answer.kind === "here_low"
          ? <BandPill band={answer.home!.band} lang={lang} size="lg" />
          : <span className={s.band} data-band="out" data-size="lg"><PackageX size={26} aria-hidden strokeWidth={2.2} />{lang === "hi" ? "आपके PHC पर नहीं" : "Not at your PHC"}</span>}
      </header>

      <h2 className={s.answerHeadline}>{copy.headline}</h2>
      {copy.sub && <p className={s.answerSub}>{copy.sub}</p>}

      {focus && answer.kind !== "nowhere" && (
        <div className={s.meta}>
          <p className={s.metaRow}>
            <MapPin size={20} aria-hidden />
            <span><strong>{placeName(focus.facilityId, lang)}</strong> · {kmText(focus.distanceKm, lang)}</span>
          </p>
          <p className={s.metaRow}>
            <Clock size={20} aria-hidden />
            <span>{freshnessText(focus, now, lang)}</span>
          </p>
          {answer.kind === "elsewhere" && <p className={s.metaRow}><BandPill band={focus.band} lang={lang} /></p>}
          <ReportsNote n={focus.patientReports} lang={lang} />
        </div>
      )}

      {copy.arriving && (
        <p className={s.arriving}>
          <Truck size={22} aria-hidden />
          <span>{copy.arriving}</span>
        </p>
      )}
      {copy.supply && <p className={s.notice}>{copy.supply}</p>}

      {answer.kind !== "here" && answer.kind !== "here_low" && home && (
        <div className={s.homeLine}>
          <span>{placeName(home.facilityId, lang)}</span>
          <BandPill band={home.band} lang={lang} />
          <span className={s.homeFresh}>{freshnessText(home, now, lang)}</span>
          <ReportsNote n={home.patientReports} lang={lang} />
        </div>
      )}

      <div className={s.actions}>
        <button type="button" className={s.actionBtn} onClick={toggleSpeak} aria-pressed={speaking}>
          {speaking ? <VolumeX size={22} aria-hidden /> : <Volume2 size={22} aria-hidden />}
          {speaking ? t("stop", lang) : t("listen", lang)}
        </button>
        {home && !reported && !confirming && (
          <button type="button" className={s.actionBtn} data-variant="quiet" onClick={() => setConfirming(true)}>
            <Flag size={22} aria-hidden />
            {t("reportCta", lang)}
          </button>
        )}
      </div>

      {home && confirming && !reported && (
        <div className={s.confirm} role="group" aria-label={t("reportCta", lang)}>
          <p>{t("reportConfirm", lang, { place: placeName(home.facilityId, lang), med: medShort(answer.medicineId, lang) })}</p>
          <div className={s.actions}>
            <button type="button" className={s.primaryBtn} onClick={() => { onReport(); setConfirming(false); }}>{t("reportYes", lang)}</button>
            <button type="button" className={s.actionBtn} data-variant="quiet" onClick={() => setConfirming(false)}>{t("reportNo", lang)}</button>
          </div>
        </div>
      )}
      {reported && <p className={s.done} role="status">{t("reportDone", lang)}</p>}

      {others.length > 0 && (
        <section className={s.others} aria-label={t("otherCentres", lang)}>
          <h3 className={s.othersTitle}>{t("otherCentres", lang)}</h3>
          <ol className={s.distanceList}>
            {shown.map((o) => (
              <li key={o.facilityId} className={s.distanceRow}>
                <span className={s.distanceKm}>{o.distanceKm}<small> km</small></span>
                <span className={s.distanceName}>
                  <span>{placeName(o.facilityId, lang)}</span>
                  <small>
                    {freshnessText(o, now, lang)}
                    {o.arrivingInHours != null && ` · ${arrivingText(o.arrivingInHours, lang, false)}`}
                  </small>
                </span>
                <BandPill band={o.band} lang={lang} />
              </li>
            ))}
          </ol>
          {others.length > OTHERS_SHOWN && (
            <button type="button" className={s.linkBtn} onClick={() => setShowAll((v) => !v)}>
              {showAll ? t("showFewer", lang) : `${t("showAll", lang)} (${others.length})`}
            </button>
          )}
        </section>
      )}
    </article>
  );
}
