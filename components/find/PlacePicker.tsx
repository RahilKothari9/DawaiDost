"use client";
// OWNER: find agent. Where the person is: GPS (nearest PHC), a typed village / PHC, or a block → centre list.
import { useMemo, useState, type RefObject } from "react";
import { Building2, ChevronRight, Home, LocateFixed, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { originForFacility, originForPoint, originForVillage, type Origin } from "@/lib/find/answer";
import { blockName, originLabel, placeName, villageName, type Lang } from "@/lib/find/copy";
import { searchPlaces, type PlaceFacility } from "@/lib/find/match";
import { t } from "./strings";
import s from "./find.module.css";

type Props = {
  lang: Lang;
  facilities: PlaceFacility[];
  onOrigin: (o: Origin) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
};

type GeoState = { status: "idle" | "busy" } | { status: "error"; reason: "denied" | "far" };

const TYPE_ORDER: Record<string, number> = { PHC: 0, CHC: 1, DH: 2 };

export function PlacePicker({ lang, facilities, onOrigin, inputRef }: Props) {
  const [query, setQuery] = useState("");
  const [block, setBlock] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const blocks = useMemo(() => [...new Set(facilities.map((f) => f.block))], [facilities]);
  const hits = useMemo(() => searchPlaces(query, facilities, { typeahead: true }).slice(0, 6), [query, facilities]);
  const inBlock = useMemo(
    () => (block ? facilities.filter((f) => f.block === block).sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name)) : []),
    [block, facilities],
  );

  const pickFacility = (id: string) => {
    const o = originForFacility(facilities, id);
    if (o) onOrigin(o);
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", reason: "denied" });
      return;
    }
    setGeo({ status: "busy" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const o = originForPoint(facilities, pos.coords.latitude, pos.coords.longitude);
        if (o) {
          setGeo({ status: "idle" });
          onOrigin(o);
        } else setGeo({ status: "error", reason: "far" });
      },
      () => setGeo({ status: "error", reason: "denied" }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60_000 },
    );
  };

  return (
    <div className={s.picker}>
      <button type="button" className={s.bigBtn} onClick={locate} disabled={geo.status === "busy"}>
        {geo.status === "busy" ? <LoaderCircle size={22} className={s.spin} aria-hidden /> : <LocateFixed size={22} aria-hidden />}
        <span>{geo.status === "busy" ? t("locating", lang) : t("useLocation", lang)}</span>
      </button>
      {geo.status === "error" && (
        <p className={s.notice} role="status">{t(geo.reason === "far" ? "locationFar" : "locationDenied", lang)}</p>
      )}

      <div className={s.searchBox}>
        <Search aria-hidden size={22} className={s.searchIcon} />
        <input
          ref={inputRef}
          className={s.searchInput}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t("placePlaceholder", lang)}
          aria-label={t("placePlaceholder", lang)}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          lang={lang}
        />
        {query && (
          <button type="button" className={s.clearBtn} onClick={() => setQuery("")} aria-label={t("clear", lang)}>
            <X size={22} aria-hidden />
          </button>
        )}
      </div>

      {query.trim() && (
        hits.length === 0 ? <p className={s.empty}>{lang === "hi" ? "यह जगह नहीं मिली। ब्लॉक चुनें।" : "No place matched. Choose a block."}</p> : (
          <ul className={s.options}>
            {hits.map((h) => (
              <li key={`${h.kind}:${h.id}`}>
                <button
                  type="button"
                  className={s.option}
                  onClick={() => {
                    if (h.kind === "block") { setBlock(h.id); setQuery(""); return; }
                    const o = h.kind === "village" ? originForVillage(facilities, h.id) : originForFacility(facilities, h.id);
                    if (o) onOrigin(o);
                  }}
                >
                  <span className={s.optionIcon}>{h.kind === "village" ? <Home size={22} aria-hidden /> : h.kind === "block" ? <MapPin size={22} aria-hidden /> : <Building2 size={22} aria-hidden />}</span>
                  <span className={s.optionText}>
                    <span className={s.optionName}>
                      {h.kind === "village" ? villageName(h.id, lang) : h.kind === "block" ? blockName(h.id, lang) : placeName(h.id, lang)}
                    </span>
                    <span className={s.optionSub}>
                      {h.kind === "village" ? `${t("village", lang)} · ${placeName(h.facilityId!, lang)}` : `${blockName(h.block, lang)} ${t("block", lang)}`}
                    </span>
                  </span>
                  <ChevronRight size={20} aria-hidden className={s.chev} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {!query.trim() && (
        <>
          <p className={s.hint}>{t("orBlock", lang)}</p>
          <ul className={s.chips}>
            {blocks.map((b) => (
              <li key={b}>
                <button type="button" className={s.chip} data-on={block === b || undefined} aria-pressed={block === b} onClick={() => setBlock(block === b ? null : b)}>
                  <MapPin size={18} aria-hidden />
                  <span>{blockName(b, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
          {block && (
            <ul className={s.options}>
              {inBlock.map((f) => (
                <li key={f.id}>
                  <button type="button" className={s.option} onClick={() => pickFacility(f.id)}>
                    <span className={s.optionIcon}><Building2 size={22} aria-hidden /></span>
                    <span className={s.optionText}>
                      <span className={s.optionName}>{placeName(f.id, lang)}</span>
                      <span className={s.optionSub}>{lang === "hi" && placeName(f.id, "en") !== placeName(f.id, "hi") ? placeName(f.id, "en") : `${blockName(f.block, lang)} ${t("block", lang)}`}</span>
                    </span>
                    <ChevronRight size={20} aria-hidden className={s.chev} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** The chosen place, collapsed. */
export function ChosenPlace({ lang, origin, onChange }: { lang: Lang; origin: Origin; onChange: () => void }) {
  const showHome = origin.kind !== "facility";
  return (
    <div className={s.chosen}>
      <span className={s.optionIcon}>{origin.kind === "gps" ? <LocateFixed size={22} aria-hidden /> : origin.kind === "village" ? <Home size={22} aria-hidden /> : <Building2 size={22} aria-hidden />}</span>
      <span className={s.optionText}>
        <span className={s.optionName}>{originLabel(origin, lang)}</span>
        {showHome && <span className={s.optionSub}>{origin.kind === "gps" ? t("nearestPhc", lang) : t("servedBy", lang)}: {placeName(origin.homeFacilityId, lang)}</span>}
      </span>
      <button type="button" className={s.linkBtn} onClick={onChange}>{t("change", lang)}</button>
    </div>
  );
}
