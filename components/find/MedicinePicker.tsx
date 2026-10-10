"use client";
// OWNER: find agent. Medicine search: typed name, Hindi name, brand or illness. Single pick (patient) or many (ASHA).
import { useId, useMemo, type RefObject } from "react";
import { Check, Search, X } from "lucide-react";
import type { Medicine } from "@/lib/district/types";
import { conditionName, medPurpose, medShort, type Lang } from "@/lib/find/copy";
import { CONDITIONS } from "@/lib/find/lexicon";
import { matchCondition, searchMedicines } from "@/lib/find/match";
import { CONDITION_ICON, MedicineIcon } from "./icons";
import { t } from "./strings";
import s from "./find.module.css";

type Props = {
  lang: Lang;
  medicines: Medicine[];
  multi: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function MedicinePicker({ lang, medicines, multi, selected, onToggle, query, onQuery, inputRef }: Props) {
  const listId = useId();
  const ids = useMemo(() => medicines.map((m) => m.id), [medicines]);
  const hits = useMemo(() => searchMedicines(query, { typeahead: true, medicineIds: ids }), [query, ids]);
  const condition = useMemo(() => (query.trim() ? matchCondition(query, { typeahead: true }) : null), [query]);
  const byCondition = hits.length > 1 && hits.every((h) => h.via === "condition");
  const strength = (id: string) => medicines.find((m) => m.id === id)?.strength ?? "";

  return (
    <div className={s.picker}>
      <div className={s.searchBox}>
        <Search aria-hidden size={22} className={s.searchIcon} />
        <input
          ref={inputRef}
          className={s.searchInput}
          type="search"
          inputMode="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t("medicinePlaceholder", lang)}
          aria-label={t("medicinePlaceholder", lang)}
          aria-controls={listId}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          lang={lang}
        />
        {query && (
          <button type="button" className={s.clearBtn} onClick={() => onQuery("")} aria-label={t("clear", lang)}>
            <X size={22} aria-hidden />
          </button>
        )}
      </div>

      {!query.trim() && (
        <>
          <p className={s.hint}>{t("medicineExamples", lang)}</p>
          <ul className={s.chips} aria-label={lang === "hi" ? "बीमारी से चुनें" : "Choose by illness"}>
            {CONDITIONS.map((c) => {
              const Icon = CONDITION_ICON[c.id];
              return (
                <li key={c.id}>
                  <button type="button" className={s.chip} onClick={() => onQuery(lang === "hi" ? c.aliases.find((a) => /[ऀ-ॿ]/.test(a)) ?? c.hi : c.en)}>
                    <Icon size={20} aria-hidden />
                    <span>{conditionName(c.id, lang)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {query.trim() && (
        <div id={listId}>
          {byCondition && condition && (
            <p className={s.hint}>
              <strong>{conditionName(condition.id, lang)}</strong> · {t("pickOne", lang)}
            </p>
          )}
          {hits.length === 0 ? (
            <p className={s.empty}>{t("noMatch", lang)}</p>
          ) : (
            <ul className={s.options}>
              {hits.map((h) => {
                const on = selected.includes(h.medicineId);
                return (
                  <li key={h.medicineId}>
                    <button
                      type="button"
                      className={s.option}
                      data-on={on || undefined}
                      aria-pressed={multi ? on : undefined}
                      onClick={() => onToggle(h.medicineId)}
                    >
                      <span className={s.optionIcon}><MedicineIcon id={h.medicineId} /></span>
                      <span className={s.optionText}>
                        <span className={s.optionName}>{medShort(h.medicineId, lang)} <span className={s.optionStrength}>{strength(h.medicineId)}</span></span>
                        <span className={s.optionSub}>{lang === "hi" ? `${medShort(h.medicineId, "en")} · ${medPurpose(h.medicineId, lang)}` : medPurpose(h.medicineId, lang)}</span>
                      </span>
                      {multi && <span className={s.check} aria-hidden>{on && <Check size={20} strokeWidth={3} />}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The chosen medicine, collapsed, with a way to change it. */
export function ChosenMedicine({ lang, id, strength, onChange }: { lang: Lang; id: string; strength: string; onChange: () => void }) {
  return (
    <div className={s.chosen}>
      <span className={s.optionIcon}><MedicineIcon id={id} /></span>
      <span className={s.optionText}>
        <span className={s.optionName}>{medShort(id, lang)} <span className={s.optionStrength}>{strength}</span></span>
        <span className={s.optionSub}>{lang === "hi" ? `${medShort(id, "en")} · ${medPurpose(id, lang)}` : medPurpose(id, lang)}</span>
      </span>
      <button type="button" className={s.linkBtn} onClick={onChange}>{t("change", lang)}</button>
    </div>
  );
}
