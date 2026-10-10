"use client";
// OWNER: find agent. Public "where can I get my medicine today?" page for patients and ASHA workers.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Info, ShieldCheck } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { medicineLabel } from "@/lib/district/engine";
import { answerFor, answerMany, buildFindSnapshot, originForFacility, originForVillage, PATIENT_REPORT_ACTOR, type Origin } from "@/lib/find/answer";
import { type Lang } from "@/lib/find/copy";
import { CONDITIONS } from "@/lib/find/lexicon";
import type { AskResponse } from "@/lib/find/schema";
import { AnswerCard } from "./AnswerCard";
import { AshaResults } from "./AshaResults";
import { ChosenMedicine, MedicinePicker } from "./MedicinePicker";
import { ChosenPlace, PlacePicker } from "./PlacePicker";
import { speak } from "./speech";
import { t } from "./strings";
import { VoiceAsk } from "./VoiceAsk";
import s from "./find.module.css";

type Mode = "patient" | "asha";
const STORE_KEY = "dawai-dost.find.v1";

type Saved = { lang?: Lang; mode?: Mode; origin?: Origin | null };

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

function save(v: Saved) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    // private mode or blocked storage: the page still works, it just forgets
  }
}

export function FindApp() {
  const { state, dispatch, assessments } = useDistrict();
  const snapshot = useMemo(() => buildFindSnapshot(state, assessments), [state, assessments]);

  const [lang, setLang] = useState<Lang>("hi");
  const [mode, setMode] = useState<Mode>("patient");
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [editingPlace, setEditingPlace] = useState(false);
  const [medicineId, setMedicineId] = useState<string | null>(null);
  const [ashaIds, setAshaIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [reported, setReported] = useState<Set<string>>(() => new Set());
  const [restored, setRestored] = useState(false);
  const medInput = useRef<HTMLInputElement>(null);
  const placeInput = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  // Restore the person's language, mode and place after hydration (server render has no storage).
  useEffect(() => {
    const saved = load();
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from browser storage after hydration */
    if (saved.lang === "hi" || saved.lang === "en") setLang(saved.lang);
    if (saved.mode === "patient" || saved.mode === "asha") setMode(saved.mode);
    if (saved.origin?.homeFacilityId && snapshot.facilities.some((f) => f.id === saved.origin!.homeFacilityId)) setOrigin(saved.origin);
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (restored) save({ lang, mode, origin });
  }, [lang, mode, origin, restored]);

  useEffect(() => {
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = "en"; };
  }, [lang]);

  const medicines = state.medicines;
  const strengthOf = (id: string) => medicines.find((m) => m.id === id)?.strength ?? "";
  const placeOpen = !origin || editingPlace;

  const answer = useMemo(() => (mode === "patient" && medicineId && origin ? answerFor(snapshot, origin, medicineId) : null), [mode, medicineId, origin, snapshot]);
  const ashaAnswers = useMemo(() => (mode === "asha" && origin && ashaIds.length ? answerMany(snapshot, origin, ashaIds) : []), [mode, origin, ashaIds, snapshot]);

  const resultKey = answer ? `${answer.medicineId}|${origin?.id}` : ashaAnswers.length ? `asha|${origin?.id}` : "";
  useEffect(() => {
    if (resultKey) answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [resultKey]);

  const chooseOrigin = (o: Origin) => {
    setOrigin(o);
    setEditingPlace(false);
  };

  const toggleMedicine = (id: string) => {
    if (mode === "patient") {
      setMedicineId(id);
      setQuery("");
      if (!origin) setTimeout(() => placeInput.current?.focus(), 50);
    } else {
      setAshaIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    }
  };

  const report = () => {
    if (!answer?.home) return;
    const f = state.facilities.find((x) => x.id === answer.home!.facilityId);
    const m = medicines.find((x) => x.id === answer.medicineId);
    if (!f || !m) return;
    dispatch({
      type: "ADD_TIMELINE",
      event: {
        id: `ev-patient-${Date.now().toString(36)}`,
        at: state.now,
        kind: "alert",
        title: `Patient report: ${medicineLabel(m)} not available at ${f.name}`,
        detail: "Reported on the public Find page. Not a verified count; ask the pharmacist to recount.",
        facilityId: f.id,
        medicineId: m.id,
        actor: PATIENT_REPORT_ACTOR,
      },
    });
    setReported((r) => new Set(r).add(`${f.id}|${m.id}`));
  };

  const onVoice = (r: AskResponse) => {
    if (r.place && r.place.kind !== "block") {
      const o = r.place.kind === "village" ? originForVillage(snapshot.facilities, r.place.id) : originForFacility(snapshot.facilities, r.place.id);
      if (o) chooseOrigin(o);
    }
    if (r.medicineIds.length) {
      if (mode === "asha") setAshaIds((ids) => [...new Set([...ids, ...r.medicineIds])]);
      else if (r.medicineIds.length === 1) { setMedicineId(r.medicineIds[0]); setQuery(""); }
      else {
        // A condition ("शुगर की दवा"): show the choices, read out the answers for all of them.
        setMedicineId(null);
        const c = CONDITIONS.find((x) => x.id === r.conditionId);
        setQuery(c ? (lang === "hi" ? c.hi : c.en) : r.transcript);
      }
    }
    if (r.needs === "place") {
      setEditingPlace(true);
      setTimeout(() => placeInput.current?.focus(), 50);
    }
    if (r.answerText) void speak(r.answerText, lang);
  };

  const reportedNow = answer?.home ? reported.has(`${answer.home.facilityId}|${answer.medicineId}`) : false;

  return (
    <div className={s.page} lang={lang}>
      <header className={s.top}>
        <span className={s.brand}>
          <ShieldCheck size={22} aria-hidden />
          {t("brand", lang)}
        </span>
        <div className={s.segmented} role="group" aria-label="Language / भाषा">
          <button type="button" aria-pressed={lang === "hi"} onClick={() => setLang("hi")} lang="hi">हिंदी</button>
          <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en">English</button>
        </div>
      </header>

      <main className={s.main}>
        <h1 className={s.title}>{t("title", lang)}</h1>

        <div className={s.modes} role="tablist" aria-label={lang === "hi" ? "किसके लिए" : "Who is asking"}>
          <button type="button" role="tab" aria-selected={mode === "patient"} onClick={() => setMode("patient")}>{t("modePatient", lang)}</button>
          <button type="button" role="tab" aria-selected={mode === "asha"} onClick={() => setMode("asha")}>{t("modeAsha", lang)}</button>
        </div>
        <p className={s.lede}>{mode === "asha" ? t("modeAshaHint", lang) : t("lede", lang)}</p>

        <VoiceAsk lang={lang} snapshot={snapshot} origin={origin} onResult={onVoice} onFallback={() => medInput.current?.focus()} />

        <section className={s.step} aria-labelledby="step-med">
          <h2 id="step-med" className={s.stepTitle}><span className={s.stepNum}>1</span>{mode === "asha" ? t("stepMedicines", lang) : t("stepMedicine", lang)}</h2>
          {mode === "patient" && medicineId ? (
            <ChosenMedicine lang={lang} id={medicineId} strength={strengthOf(medicineId)} onChange={() => { setMedicineId(null); setTimeout(() => medInput.current?.focus(), 50); }} />
          ) : (
            <MedicinePicker
              lang={lang}
              medicines={medicines}
              multi={mode === "asha"}
              selected={mode === "asha" ? ashaIds : medicineId ? [medicineId] : []}
              onToggle={toggleMedicine}
              query={query}
              onQuery={setQuery}
              inputRef={medInput}
            />
          )}
          {mode === "asha" && ashaIds.length === 0 && <p className={s.hint}>{t("ashaEmpty", lang)}</p>}
        </section>

        <section className={s.step} aria-labelledby="step-place">
          <h2 id="step-place" className={s.stepTitle}><span className={s.stepNum}>2</span>{t("stepPlace", lang)}</h2>
          {placeOpen ? (
            <PlacePicker lang={lang} facilities={snapshot.facilities} onOrigin={chooseOrigin} inputRef={placeInput} />
          ) : (
            <ChosenPlace lang={lang} origin={origin!} onChange={() => setEditingPlace(true)} />
          )}
        </section>

        <div ref={answerRef} className={s.resultAnchor}>
          {answer && <AnswerCard key={`${answer.medicineId}|${origin?.id}`} lang={lang} answer={answer} now={snapshot.now} reported={reportedNow} onReport={report} />}
          {mode === "asha" && origin && ashaAnswers.length > 0 && (
            <AshaResults lang={lang} answers={ashaAnswers} origin={origin} now={snapshot.now} onRemove={(id) => setAshaIds((ids) => ids.filter((x) => x !== id))} />
          )}
        </div>
      </main>

      <footer className={s.footer}>
        <p className={s.demo}><Info size={18} aria-hidden /> <span>{t("demo", lang)}</span></p>
        <p className={s.privacy}>{t("privacy", lang)}</p>
        <Link href="/" className={s.officer}>{t("officerLink", lang)} →</Link>
      </footer>
    </div>
  );
}
