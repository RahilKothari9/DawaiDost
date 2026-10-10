// OWNER: find agent. Plain-language Hindi/English words for the public /find page, answers, SMS and speech.
import { FACILITIES, MEDICINES } from "../district/data";
import { BLOCK_HI, CONDITIONS, MEDICINE_WORDS, PLACE_HI, PLACE_HI_SHORT, VILLAGES, type ConditionId } from "./lexicon";
import { istDaysAgo, istTime, type Band, type FacilityOption, type FindAnswer, type Origin } from "./answer";

export type Lang = "hi" | "en";

const MED_EN = new Map(MEDICINES.map((m) => [m.id, `${m.name} ${m.strength}`]));
const MED_NAME = new Map(MEDICINES.map((m) => [m.id, m.name]));
const FAC_EN = new Map(FACILITIES.map((f) => [f.id, f.name]));

export function medName(id: string, lang: Lang): string {
  if (lang === "hi") return MEDICINE_WORDS[id]?.hi ?? MED_EN.get(id) ?? id;
  return MED_EN.get(id) ?? id;
}

/** Name without strength: "मेटफॉर्मिन" / "Metformin". */
export function medShort(id: string, lang: Lang): string {
  if (lang === "hi") return MEDICINE_WORDS[id]?.hi ?? MED_NAME.get(id) ?? id;
  return MED_NAME.get(id) ?? id;
}

export function medPurpose(id: string, lang: Lang): string {
  const w = MEDICINE_WORDS[id];
  return w ? (lang === "hi" ? w.plainHi : w.plainEn) : "";
}

export function placeName(id: string, lang: Lang): string {
  if (lang === "hi") return PLACE_HI_SHORT[id] ?? PLACE_HI[id] ?? FAC_EN.get(id) ?? id;
  return FAC_EN.get(id) ?? id;
}

export function villageName(id: string, lang: Lang): string {
  const v = VILLAGES.find((x) => x.id === id);
  return v ? (lang === "hi" ? v.hi : v.name) : id;
}

export function blockName(block: string, lang: Lang): string {
  return lang === "hi" ? BLOCK_HI[block] ?? block : block;
}

export function conditionName(id: ConditionId, lang: Lang): string {
  const c = CONDITIONS.find((x) => x.id === id);
  return c ? (lang === "hi" ? c.hi : c.en) : id;
}

export function originLabel(origin: Origin, lang: Lang): string {
  if (origin.kind === "village") return villageName(origin.id, lang);
  if (origin.kind === "gps") return lang === "hi" ? "आपकी जगह" : "Your location";
  return placeName(origin.id, lang);
}

export function bandText(band: Band, lang: Lang): string {
  const t = { available: ["उपलब्ध है", "Available"], low: ["कम बची है", "Running low"], out: ["खत्म है", "Out of stock"] }[band];
  return lang === "hi" ? t[0] : t[1];
}

export function kmText(km: number, lang: Lang): string {
  if (km === 0) return lang === "hi" ? "आपका केंद्र" : "your centre";
  return `${km} km`;
}

/** "verified today 09:42" / "आज 09:42 जाँचा गया"; unverified counts say so. */
export function freshnessText(o: Pick<FacilityOption, "reportedAt" | "verified" | "freshness">, now: string, lang: Lang): string {
  const days = istDaysAgo(o.reportedAt, now);
  const time = istTime(o.reportedAt);
  if (lang === "hi") {
    const when = days === 0 ? `आज ${time}` : days === 1 ? `कल ${time}` : `${days} दिन पहले`;
    if (o.freshness === "stale") return `जानकारी ${days} दिन पुरानी`;
    return o.verified ? `${when} जाँचा गया` : `${when} बताया गया, जाँच बाकी`;
  }
  const when = days === 0 ? `today ${time}` : days === 1 ? `yesterday ${time}` : `${days} days ago`;
  if (o.freshness === "stale") return `last report ${days} days old`;
  return o.verified ? `verified ${when}` : `reported ${when}, not yet verified`;
}

export function arrivingText(hours: number, lang: Lang, here = true): string {
  const h = Math.max(1, hours);
  if (lang === "hi") return `${here ? "आपके PHC पर " : ""}दवा लगभग ${h} घंटे में पहुँच रही है`;
  return `Stock arriving${here ? " at your PHC" : ""} in about ${h} hour${h === 1 ? "" : "s"}`;
}

const HOME_ISSUE: Record<NonNullable<FindAnswer["homeIssue"]>, [string, string]> = {
  out: ["आपके PHC पर नहीं है।", "Not at your PHC."],
  stale: ["आपके PHC की जानकारी पुरानी है।", "Your PHC has not reported recently."],
  unverified: ["आपके PHC की गिनती की जाँच बाकी है।", "Your PHC's count is not yet verified."],
  reported_out: ["आपके PHC पर मरीज़ों ने कमी बताई है।", "Patients reported it missing at your PHC."],
};

export type AnswerCopy = { headline: string; sub: string | null; arriving: string | null; supply: string | null };

export function answerCopy(a: FindAnswer, lang: Lang): AnswerCopy {
  const hi = lang === "hi";
  const arriving = a.home?.arrivingInHours != null && a.kind !== "here" ? arrivingText(a.home.arrivingInHours, lang) : null;
  const supply = a.kind === "nowhere" && a.upstream !== "available"
    ? hi ? "राज्य से सप्लाई देर से आ रही है। ज़िला स्वास्थ्य अधिकारी को इसकी जानकारी है।" : "State supply is delayed. The district health office knows."
    : null;
  if (a.kind === "here" || a.kind === "here_low") {
    const name = placeName(a.home!.facilityId, lang);
    const headline = hi ? `${name} पर मिलेगी` : `Available at ${name}`;
    const sub = a.kind === "here_low" ? (hi ? "पर कम बची है। आज या कल जाएँ।" : "But running low. Go today or tomorrow.") : null;
    return { headline, sub, arriving, supply };
  }
  const issue = a.homeIssue ? HOME_ISSUE[a.homeIssue][hi ? 0 : 1] : hi ? "आपके PHC की जानकारी नहीं है।" : "No report from your PHC.";
  if (a.kind === "elsewhere" && a.go) {
    const name = placeName(a.go.facilityId, lang);
    const headline = hi ? `${issue} सबसे पास: ${name}, ${a.go.distanceKm} km` : `${issue} Nearest with stock: ${name}, ${a.go.distanceKm} km`;
    return { headline, sub: null, arriving, supply };
  }
  const headline = hi ? `${issue} आस-पास किसी केंद्र पर अभी नहीं है।` : `${issue} No nearby centre has it right now.`;
  return { headline, sub: null, arriving, supply };
}

/** One or two sentences for text-to-speech. */
export function speakText(a: FindAnswer, lang: Lang): string {
  const c = answerCopy(a, lang);
  const med = medName(a.medicineId, lang);
  return [`${med}:`, c.headline.replace(/km/g, lang === "hi" ? "किलोमीटर" : "kilometres"), c.sub, c.arriving, c.supply].filter(Boolean).join(" ");
}

/** Short SMS-style summary an ASHA worker can forward to a patient. */
export function smsSummary(answers: FindAnswer[], origin: Origin, now: string, lang: Lang): string {
  const hi = lang === "hi";
  const date = new Date(new Date(now).getTime() + 5.5 * 36e5);
  const day = `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
  const where = origin.kind === "facility" ? placeName(origin.homeFacilityId, lang) : `${originLabel(origin, lang)} (${placeName(origin.homeFacilityId, lang)})`;
  const head = `${hi ? "दवा दोस्त" : "Dawai Dost"}: ${where} - ${day} ${istTime(now)}`;
  const lines = answers.map((a, i) => {
    const med = medName(a.medicineId, lang);
    let line: string;
    if (a.kind === "here") line = hi ? "आपके PHC पर मिलेगी" : "at your PHC";
    else if (a.kind === "here_low") line = hi ? "आपके PHC पर, कम बची है" : "at your PHC, running low";
    else if (a.kind === "elsewhere" && a.go) line = hi ? `यहाँ नहीं; ${placeName(a.go.facilityId, lang)} (${a.go.distanceKm} km)` : `not here; ${placeName(a.go.facilityId, lang)} (${a.go.distanceKm} km)`;
    else line = hi ? "अभी कहीं नहीं" : "not available nearby";
    if (a.kind !== "here" && a.home?.arrivingInHours != null) line += hi ? `, ~${Math.max(1, a.home.arrivingInHours)} घंटे में आ रही है` : `, arriving in ~${Math.max(1, a.home.arrivingInHours)} h`;
    return `${i + 1}. ${med}: ${line}`;
  });
  const tail = hi ? "(डेमो डेटा, असली स्टॉक नहीं)" : "(demo data, not real stock)";
  return [head, ...lines, tail].join("\n");
}
