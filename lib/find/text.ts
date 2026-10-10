// OWNER: find agent. Text normalisation and fuzzy matching for Hindi (Devanagari), Hinglish and English.
// Pure functions; no DOM, no React. Shared by the /find page and the /api/find/ask route.

const VIRAMA = "्";
const NUKTA = "़";

const CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  "ळ": "l", "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f", "य़": "y",
};

const MATRAS: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ृ": "ri", "ॉ": "o", "ॅ": "e", "ॆ": "e", "ॊ": "o",
};

const VOWELS: Record<string, string> = {
  "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
  "ऋ": "ri", "ऑ": "o", "ऍ": "e", "ऎ": "e", "ऒ": "o",
};

const SIGNS: Record<string, string> = { "ं": "n", "ँ": "n", "ः": "h" };

const DIGITS: Record<string, string> = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };

const isDevanagari = (ch: string) => ch >= "ऀ" && ch <= "ॿ";

/** Lowercase, NFC, strip nukta, punctuation to spaces, collapse whitespace. Keeps Devanagari and Latin letters and digits. */
export function normalize(input: string): string {
  let s = input.normalize("NFC").toLowerCase().split(NUKTA).join("");
  s = s.replace(/[०-९]/g, (d) => DIGITS[d] ?? d);
  s = s.replace(/[।॥]/g, " "); // danda
  s = s.replace(/[^a-z0-9ऀ-ॿ]+/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Devanagari → rough Latin, with word-final schwa deletion. Latin passes through. */
export function transliterate(word: string): string {
  let out = "";
  const chars = Array.from(word);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (!isDevanagari(ch)) { out += ch; continue; }
    if (CONSONANTS[ch] !== undefined) {
      out += CONSONANTS[ch];
      const next = chars[i + 1];
      if (next === undefined) continue; // word-final schwa deleted
      if (next === VIRAMA) { i++; continue; }
      if (MATRAS[next] !== undefined) { out += MATRAS[next]; i++; continue; }
      // Inherent 'a'. Drop it before a consonant that carries its own vowel when we already have a vowel (schwa syncope).
      const after = chars[i + 2];
      const prevVowel = /[aeiou]$/.test(out.slice(0, -CONSONANTS[ch].length));
      if (CONSONANTS[next] !== undefined && after !== undefined && MATRAS[after] !== undefined && prevVowel) continue;
      out += "a";
      continue;
    }
    if (MATRAS[ch] !== undefined) { out += MATRAS[ch]; continue; }
    if (VOWELS[ch] !== undefined) { out += VOWELS[ch]; continue; }
    if (SIGNS[ch] !== undefined) { out += SIGNS[ch]; continue; }
    // other marks (virama on its own, avagraha...) are dropped
  }
  return out;
}

/** Spelling-insensitive Latin form: merges aspirates, c/k/s, w/v, doubled letters and long vowels. */
export function canonical(word: string): string {
  let s = transliterate(word.toLowerCase());
  s = s.replace(/chh/g, "C").replace(/ch/g, "C");
  s = s.replace(/sh/g, "s").replace(/ph/g, "f").replace(/kh/g, "k").replace(/gh/g, "g").replace(/jh/g, "j")
    .replace(/th/g, "t").replace(/dh/g, "d").replace(/bh/g, "b").replace(/rh/g, "r");
  s = s.replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/C/g, "c");
  s = s.replace(/w/g, "v").replace(/z/g, "j").replace(/q/g, "k").replace(/x/g, "ks");
  s = s.replace(/ee/g, "i").replace(/oo/g, "u").replace(/ai/g, "e").replace(/ae/g, "e").replace(/au/g, "o").replace(/ou/g, "o");
  s = s.replace(/y$/g, "i");
  s = s.replace(/(.)\1+/g, "$1");
  return s;
}

/** Consonant skeleton: first letter plus consonants without vowels or a lone 'h'. */
export function skeleton(canon: string): string {
  if (!canon) return "";
  const rest = canon.slice(1).replace(/[aeiouhy]/g, "");
  return (canon[0] + rest).replace(/(.)\1+/g, "$1");
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

const ratio = (a: string, b: string) => (a === b ? 1 : 1 - editDistance(a, b) / Math.max(a.length, b.length));

export type WordKey = { canon: string; skel: string };

export function wordKey(word: string): WordKey {
  const canon = canonical(word);
  return { canon, skel: skeleton(canon) };
}

/**
 * Similarity of one typed word against one known word, 0..1.
 * Short words (3 letters or fewer) must match exactly; longer ones tolerate typos.
 * `prefix` lets a partially typed word ("metf") match while the user is still typing.
 */
export function wordSimilarity(q: WordKey, t: WordKey, opts: { prefix?: boolean } = {}): number {
  if (!q.canon || !t.canon) return 0;
  if (q.canon === t.canon) return 1;
  if (q.skel.length >= 2 && q.skel === t.skel && Math.min(q.canon.length, t.canon.length) >= 3) return 0.93;
  if (q.canon.length <= 3 || t.canon.length <= 3) {
    if (opts.prefix && q.canon.length >= 2 && t.canon.startsWith(q.canon)) return 0.8;
    return 0;
  }
  if (opts.prefix && q.canon.length >= 3 && t.canon.startsWith(q.canon)) return 0.86 + 0.1 * (q.canon.length / t.canon.length);
  const r = ratio(q.canon, t.canon);
  const rs = q.skel.length >= 3 && t.skel.length >= 3 ? ratio(q.skel, t.skel) * 0.92 : 0;
  return Math.max(r, rs);
}

export function tokens(input: string): string[] {
  const n = normalize(input);
  return n ? n.split(" ") : [];
}
