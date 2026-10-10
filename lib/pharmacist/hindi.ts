// Hindi labels for the pharmacist surface. Synthetic facility names are transliterated, not translated.
import type { Facility, Medicine } from "../district/types";
import { hindiMedicineName } from "../voice/facts";

const PLACE_HI: Record<string, string> = {
  saraswati: "सरस्वती", kalyanpur: "कल्याणपुर", devgarh: "देवगढ़", rampur: "रामपुर", hirapur: "हीरापुर",
  gopalpura: "गोपालपुरा", anandpur: "आनंदपुर", chandanpura: "चंदनपुरा", lakshmipura: "लक्ष्मीपुरा",
  madhavgarh: "माधवगढ़", kamalpur: "कमलपुर", tulsipur: "तुलसीपुर", sundarpur: "सुंदरपुर", narayanpur: "नारायणपुर",
  bhimpura: "भीमपुरा", kesarpura: "केसरपुरा",
  "chc-ashta": "आष्टा", "chc-ichhawar": "इछावर", "chc-nasrullaganj": "नसरुल्लागंज", "chc-budhni": "बुधनी", "chc-shyampur": "श्यामपुर",
};

/** "सरस्वती पीएचसी" — falls back to the English name for unknown facilities. */
export function facilityHi(f: Pick<Facility, "id" | "name" | "type"> | undefined): string {
  if (!f) return "—";
  if (f.type === "WAREHOUSE") return "जिला औषधि भंडार";
  if (f.type === "DH") return "जिला अस्पताल सीहोर";
  const place = PLACE_HI[f.id];
  if (!place) return f.name;
  return f.type === "CHC" ? `सीएचसी ${place}` : `${place} पीएचसी`;
}

/** Short place name without the facility type, for tight rows. */
export function placeHi(f: Pick<Facility, "id" | "name" | "type"> | undefined): string {
  if (!f) return "—";
  if (f.type === "WAREHOUSE") return "जिला भंडार";
  if (f.type === "DH") return "जिला अस्पताल";
  return PLACE_HI[f.id] ?? f.name.replace(/\s*(PHC|CHC)\s*/g, "");
}

export function medicineHi(m: Pick<Medicine, "name"> | undefined): string {
  if (!m) return "—";
  if (m.name === "IFA") return "आयरन (IFA)";
  return hindiMedicineName(m.name);
}

/** Colloquial counting unit: strips are "पत्ते" at a PHC counter. */
export function unitHi(m: Pick<Medicine, "unit"> | undefined, n = 2): string {
  const u = (m?.unit ?? "").toLowerCase();
  if (u.startsWith("strip")) return n === 1 ? "पत्ता" : "पत्ते";
  if (u.startsWith("sachet")) return "पैकेट";
  if (u.startsWith("inhaler")) return "इनहेलर";
  return "यूनिट";
}

export function unitEn(m: Pick<Medicine, "unit"> | undefined, n = 2): string {
  const u = (m?.unit ?? "units").split(" ")[0];
  return n === 1 ? u : `${u}s`;
}

/** "2 दिन" / "आज" / "खत्म" for big day counts. */
export function daysHi(days: number): { value: string; label: string } {
  if (!Number.isFinite(days)) return { value: "—", label: "खपत नहीं" };
  if (days <= 0) return { value: "0", label: "स्टॉक खत्म" };
  if (days < 1) return { value: "<1", label: "दिन" };
  const v = days < 10 ? Math.floor(days * 10) / 10 : Math.round(days);
  return { value: String(v), label: "दिन" };
}

/** Hours to a rough Hindi duration: "लगभग 3 घंटे", "40 मिनट". */
export function hoursHi(hours: number): string {
  if (hours <= 0) return "अब कभी भी";
  if (hours < 1) return `${Math.max(5, Math.round((hours * 60) / 5) * 5)} मिनट`;
  return `लगभग ${Math.round(hours * 10) / 10} घंटे`.replace(".0 ", " ");
}

export function hoursEn(hours: number): string {
  if (hours <= 0) return "any moment";
  if (hours < 1) return `${Math.max(5, Math.round((hours * 60) / 5) * 5)} min`;
  return `about ${Math.round(hours * 10) / 10} h`;
}

/** Relative time against the simulated clock, Hindi. */
export function agoHi(iso: string, nowIso: string): string {
  const mins = Math.round((Date.parse(nowIso) - Date.parse(iso)) / 60000);
  if (mins < 1) return "अभी";
  if (mins < 60) return `${mins} मिनट पहले`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} घंटे पहले`;
  return `${Math.round(h / 24)} दिन पहले`;
}

export function clockHi(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function dayHi(iso: string): string {
  return new Intl.DateTimeFormat("hi-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", weekday: "short" }).format(new Date(iso));
}
