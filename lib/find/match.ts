// OWNER: find agent. Fuzzy medicine and place search (Hindi, Hinglish, English, common misspellings).
import { BLOCK_HI, CONDITIONS, MEDICINE_WORDS, PLACE_ALIASES, PLACE_HI, STOPWORDS, VILLAGES, type ConditionId } from "./lexicon";
import { tokens, wordKey, wordSimilarity, type WordKey } from "./text";

type Alias = { text: string; keys: WordKey[]; joined: WordKey };

const aliasOf = (text: string): Alias => {
  const all = tokens(text);
  const kept = all.filter((w) => !STOPWORDS.has(w));
  const t = kept.length ? kept : all;
  return { text, keys: t.map(wordKey), joined: wordKey(t.join("")) };
};

type QueryWord = { key: WordKey; last: boolean };

function queryWords(input: string): QueryWord[] {
  const t = tokens(input).filter((w) => !STOPWORDS.has(w));
  const words: QueryWord[] = t.map((w, i) => ({ key: wordKey(w), last: i === t.length - 1 }));
  // Spelled-out letters and split words: "बी पी", "o r s", "metfor min".
  for (let i = 0; i < t.length - 1; i++) {
    words.push({ key: wordKey(t[i] + t[i + 1]), last: i + 1 === t.length - 1 });
    if (i < t.length - 2) words.push({ key: wordKey(t[i] + t[i + 1] + t[i + 2]), last: i + 2 === t.length - 1 });
  }
  return words;
}

/** 0..1: how well the query contains this alias. */
function aliasScore(words: QueryWord[], alias: Alias, typeahead: boolean): number {
  if (!words.length || !alias.keys.length) return 0;
  const best = (k: WordKey) => words.reduce((m, w) => Math.max(m, wordSimilarity(w.key, k, { prefix: typeahead && w.last })), 0);
  let score: number;
  if (alias.keys.length === 1) {
    score = best(alias.keys[0]);
  } else {
    const parts = alias.keys.map(best);
    const avg = parts.reduce((s, p) => s + p, 0) / parts.length;
    score = parts.some((p) => p < 0.7) ? avg * 0.6 : avg;
    score = Math.max(score, best(alias.joined));
  }
  return score;
}

// ---------- medicines ----------

const MED_ALIASES: { id: string; aliases: Alias[] }[] = Object.entries(MEDICINE_WORDS).map(([id, w]) => ({ id, aliases: w.aliases.map(aliasOf) }));
const COND_ALIASES: { id: ConditionId; aliases: Alias[] }[] = CONDITIONS.map((c) => ({ id: c.id, aliases: c.aliases.map(aliasOf) }));

export type MedicineHit = {
  medicineId: string;
  score: number; // 0..1
  via: "name" | "condition";
  conditionId?: ConditionId;
};

export const MATCH_THRESHOLD = 0.76;

/** Which condition the query names, if any ("शुगर की दवा" → sugar). */
export function matchCondition(query: string, opts: { typeahead?: boolean } = {}): { id: ConditionId; score: number } | null {
  const words = queryWords(query);
  let top: { id: ConditionId; score: number } | null = null;
  for (const c of COND_ALIASES) {
    const s = Math.max(...c.aliases.map((a) => aliasScore(words, a, !!opts.typeahead)));
    if (s >= MATCH_THRESHOLD && (!top || s > top.score)) top = { id: c.id, score: s };
  }
  return top;
}

/**
 * Ranked medicines for a free-text query. Names beat conditions; a condition returns every medicine for it.
 * `typeahead` lets the last word match as a prefix while the user is typing.
 */
export function searchMedicines(query: string, opts: { typeahead?: boolean; medicineIds?: string[] } = {}): MedicineHit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const allowed = opts.medicineIds ? new Set(opts.medicineIds) : null;
  const hits = new Map<string, MedicineHit>();
  const add = (h: MedicineHit) => {
    if (allowed && !allowed.has(h.medicineId)) return;
    const prev = hits.get(h.medicineId);
    if (!prev || h.score > prev.score) hits.set(h.medicineId, h);
  };
  for (const m of MED_ALIASES) {
    const s = Math.max(...m.aliases.map((a) => aliasScore(words, a, !!opts.typeahead)));
    if (s >= MATCH_THRESHOLD) add({ medicineId: m.id, score: s, via: "name" });
  }
  for (const c of COND_ALIASES) {
    const s = Math.max(...c.aliases.map((a) => aliasScore(words, a, !!opts.typeahead)));
    if (s < MATCH_THRESHOLD) continue;
    for (const [id, w] of Object.entries(MEDICINE_WORDS)) {
      if (w.conditions.includes(c.id)) add({ medicineId: id, score: s * 0.96, via: "condition", conditionId: c.id });
    }
  }
  const order = Object.keys(MEDICINE_WORDS);
  return [...hits.values()].sort((a, b) => b.score - a.score || order.indexOf(a.medicineId) - order.indexOf(b.medicineId));
}

// ---------- places ----------

export type PlaceFacility = { id: string; name: string; type: string; block: string; lat: number; lng: number };

export type PlaceHit = {
  kind: "facility" | "village" | "block";
  id: string; // facility id, village id or block name
  facilityId: string | null; // the PHC that serves this place (null for a block)
  block: string;
  score: number;
};

type PlaceEntry = Omit<PlaceHit, "score"> & { aliases: Alias[] };

const coreName = (name: string) => name.replace(/\b(PHC|CHC)\b/g, "").replace(/\s+/g, " ").trim();

const placeIndexCache = new WeakMap<PlaceFacility[], PlaceEntry[]>();

function placeIndex(facilities: PlaceFacility[]): PlaceEntry[] {
  const cached = placeIndexCache.get(facilities);
  if (cached) return cached;
  const entries: PlaceEntry[] = [];
  const blocks = new Set<string>();
  for (const f of facilities) {
    if (f.type === "WAREHOUSE") continue;
    blocks.add(f.block);
    const words = [f.name, coreName(f.name), PLACE_HI[f.id], ...(PLACE_ALIASES[f.id] ?? [])].filter((s): s is string => !!s);
    entries.push({ kind: "facility", id: f.id, facilityId: f.id, block: f.block, aliases: words.map(aliasOf) });
  }
  const byId = new Map(facilities.map((f) => [f.id, f]));
  for (const v of VILLAGES) {
    const phc = byId.get(v.phcId);
    if (!phc) continue;
    entries.push({ kind: "village", id: v.id, facilityId: v.phcId, block: phc.block, aliases: [aliasOf(v.name), aliasOf(v.hi)] });
  }
  for (const b of blocks) {
    entries.push({ kind: "block", id: b, facilityId: null, block: b, aliases: [aliasOf(b), aliasOf(BLOCK_HI[b] ?? b), aliasOf(`${b} block`)] });
  }
  placeIndexCache.set(facilities, entries);
  return entries;
}

const KIND_RANK: Record<PlaceHit["kind"], number> = { village: 0, facility: 1, block: 2 };

/** Villages, PHCs/CHCs and blocks matching the query. A block name that is also a CHC town returns both. */
export function searchPlaces(query: string, facilities: PlaceFacility[], opts: { typeahead?: boolean } = {}): PlaceHit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const hits: PlaceHit[] = [];
  for (const e of placeIndex(facilities)) {
    const s = Math.max(...e.aliases.map((a) => aliasScore(words, a, !!opts.typeahead)));
    if (s >= MATCH_THRESHOLD) hits.push({ kind: e.kind, id: e.id, facilityId: e.facilityId, block: e.block, score: s });
  }
  return hits.sort((a, b) => b.score - a.score || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

// ---------- whole questions ----------

export type ParsedQuestion = {
  medicineIds: string[];
  conditionId: ConditionId | null;
  place: PlaceHit | null;
};

/**
 * Deterministic parse of a spoken or typed question: "सरस्वती में शुगर की दवा है क्या?".
 * Used as the fallback when the Responses API is not available.
 */
export function parseQuestion(text: string, facilities: PlaceFacility[], medicineIds?: string[]): ParsedQuestion {
  const places = searchPlaces(text, facilities).filter((p) => p.score >= 0.84);
  const place = places.find((p) => p.kind !== "block") ?? places[0] ?? null;
  // Remove the words that matched the place so "Rampur" cannot be read as a medicine and vice versa.
  const placeWords = new Set<string>();
  if (place) {
    const placeTokens = tokens(text).filter((w) => searchPlaces(w, facilities).some((p) => p.id === place.id && p.score >= 0.84));
    placeTokens.forEach((w) => placeWords.add(w));
  }
  const rest = tokens(text).filter((w) => !placeWords.has(w)).join(" ");
  const hits = searchMedicines(rest, { medicineIds }).filter((h) => h.score >= 0.82);
  const names = hits.filter((h) => h.via === "name");
  const chosen = names.length ? names : hits;
  const condition = matchCondition(rest);
  return { medicineIds: chosen.map((h) => h.medicineId), conditionId: names.length ? null : condition?.id ?? null, place };
}
