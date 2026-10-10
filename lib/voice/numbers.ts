// Deterministic number parser for Hindi / English shelf counts. Used as the labeled
// fallback when structured extraction via the Responses API is unavailable.

const HINDI_1_TO_99 = [
  "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ", "दस",
  "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस",
  "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस", "तीस",
  "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस", "चालीस",
  "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास", "पचास",
  "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ", "साठ",
  "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर", "सत्तर",
  "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी", "अस्सी",
  "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी", "नब्बे",
  "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
];

const HINDI_VARIANTS: Record<string, number> = {
  "पांच": 5, "छः": 6, "छ": 6, "छे": 6, "छै": 6, "शून्य": 0, "जीरो": 0, "ज़ीरो": 0, "चवालिस": 44, "पंदरह": 15,
  "अठ्ठाईस": 28, "अठ्ठावन": 58, "अठ्ठासी": 88, "अठ्ठानवे": 98, "उन्नासी": 79, "सौ": 100,
};

const ROMAN_HINDI: Record<string, number> = {
  ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhah: 6, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10,
  gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19, bees: 20,
  pachchis: 25, pachis: 25, tees: 30, chalis: 40, chaalis: 40, pachas: 50, pachaas: 50, sattar: 70, assi: 80, nabbe: 90,
};

const ENGLISH_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const ENGLISH_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** NFD-normalise, drop nukta, fold chandrabindu into anusvara so spelling variants match. */
export function normalizeHindi(text: string): string {
  return text.normalize("NFD").replace(/़/g, "").replace(/ँ/g, "ं").normalize("NFC").toLowerCase();
}

const WORDS = new Map<string, number>();
HINDI_1_TO_99.forEach((w, i) => WORDS.set(normalizeHindi(w), i + 1));
for (const [w, n] of Object.entries(HINDI_VARIANTS)) WORDS.set(normalizeHindi(w), n);
for (const [w, n] of Object.entries(ROMAN_HINDI)) WORDS.set(w, n);
for (const [w, n] of Object.entries(ENGLISH_UNITS)) WORDS.set(w, n);
for (const [w, n] of Object.entries(ENGLISH_TENS)) WORDS.set(w, n);

const HUNDRED = new Set(["सौ", "hundred", "sau"].map(normalizeHindi));
const THOUSAND = new Set(["हजार", "हज़ार", "thousand", "hazar", "hazaar"].map(normalizeHindi));
const FRACTION_HUNDREDS: Record<string, number> = { [normalizeHindi("डेढ़")]: 1.5, [normalizeHindi("ढाई")]: 2.5, dedh: 1.5, dhai: 2.5 };
const DEVANAGARI_DIGITS = "०१२३४५६७८९";

export type NumberToken = { value: number; index: number; end: number; raw: string };

/** Tokenise preserving offsets. Words are runs of letters/marks/digits. */
function tokenize(text: string): { word: string; index: number; end: number }[] {
  const out: { word: string; index: number; end: number }[] = [];
  const re = /[\p{L}\p{M}\p{N}]+/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ word: m[0], index: m.index, end: m.index + m[0].length });
  return out;
}

function digitValue(word: string): number | null {
  const ascii = word.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  return /^\d+$/.test(ascii) ? Number(ascii) : null;
}

/**
 * Extract every number mentioned in `text`, combining compound forms:
 * "दो सौ पचास" → 250, "one hundred twenty three" → 123, "डेढ़ सौ" → 150, "1,200" → 1200, "१६" → 16.
 * Adjacent independent numbers ("बीस पच्चीस") stay separate.
 */
export function parseNumbers(input: string): NumberToken[] {
  const text = normalizeHindi(input).replace(/(\d),(\d{3})/g, "$1$2");
  const tokens = tokenize(text);
  const result: NumberToken[] = [];
  let current: { total: number; small: number; index: number; end: number; lastKind: "digit" | "unit" | "tens" | "hundred" | "thousand" } | null = null;

  const flush = () => {
    if (current) {
      const value = current.total + current.small;
      result.push({ value, index: current.index, end: current.end, raw: input.slice(current.index, current.end) });
    }
    current = null;
  };

  for (const { word, index, end } of tokens) {
    const digits = digitValue(word);
    if (digits !== null) {
      flush();
      current = { total: 0, small: digits, index, end, lastKind: "digit" };
      continue;
    }
    if (word in FRACTION_HUNDREDS) {
      flush();
      current = { total: 0, small: FRACTION_HUNDREDS[word], index, end, lastKind: "unit" };
      continue;
    }
    if (HUNDRED.has(word)) {
      if (current && current.lastKind !== "hundred") {
        current.small = (current.small || 1) * 100;
        current.end = end;
        current.lastKind = "hundred";
      } else {
        flush();
        current = { total: 0, small: 100, index, end, lastKind: "hundred" };
      }
      continue;
    }
    if (THOUSAND.has(word)) {
      if (current) {
        current.total += (current.small || 1) * 1000;
        current.small = 0;
        current.end = end;
        current.lastKind = "thousand";
      } else current = { total: 1000, small: 0, index, end, lastKind: "thousand" };
      continue;
    }
    const n = WORDS.get(word);
    if (n === undefined) {
      flush();
      continue;
    }
    const isTens = Object.values(ENGLISH_TENS).includes(n) && word in ENGLISH_TENS;
    if (current) {
      const c: NonNullable<typeof current> = current;
      const canAddAfterHundred = (c.lastKind === "hundred" || c.lastKind === "thousand") && c.small % 100 === 0;
      const canAddUnitToTens = c.lastKind === "tens" && n < 10;
      if (canAddAfterHundred || canAddUnitToTens) {
        c.small += n;
        c.end = end;
        c.lastKind = isTens ? "tens" : "unit";
        continue;
      }
      flush();
    }
    current = { total: 0, small: n, index, end, lastKind: isTens ? "tens" : "unit" };
  }
  flush();
  return result.map((t) => ({ ...t, value: Math.round(t.value) }));
}

/** Hindi word for 0..100, used for read-backs in scripted calls. */
export function hindiNumberWord(n: number): string {
  if (n === 0) return "शून्य";
  if (n >= 1 && n <= 99) return HINDI_1_TO_99[n - 1];
  if (n === 100) return "सौ";
  return String(n);
}
