// Offline keyword gloss (labeled fallback). Safe to import in the browser.
import { HINDI_MEDICINE_NAMES } from "./facts";
import { normalizeHindi, parseNumbers } from "./numbers";

const PHRASES: [string, string][] = [
  ["नमस्ते", "hello"], ["धन्यवाद", "thank you"], ["शुक्रिया", "thanks"], ["हाँ", "yes"], ["जी", "yes"], ["सही", "correct"],
  ["नहीं", "no/not"], ["गिनती", "count"], ["दोबारा", "again"], ["कितनी", "how many"], ["कितने", "how many"], ["स्ट्रिप", "strips"],
  ["उपलब्ध", "available"], ["स्टॉक", "stock"], ["कम", "low"], ["खत्म", "finished"], ["बची", "remaining"], ["दवा", "medicine"],
  ["रिपोर्ट", "report"], ["दर्ज", "recorded"], ["किलोमीटर", "km"], ["रोज़", "daily"], ["सप्लाई", "supply"], ["अगली", "next"],
];

export function fallbackGloss(text: string): string {
  const norm = normalizeHindi(text);
  const bits: string[] = [];
  for (const [en, aliases] of Object.entries(HINDI_MEDICINE_NAMES)) {
    if (aliases.some((a) => norm.includes(normalizeHindi(a)))) bits.push(en.replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  for (const [hi, en] of PHRASES) if (norm.includes(normalizeHindi(hi)) && !bits.includes(en)) bits.push(en);
  for (const n of parseNumbers(text)) bits.push(String(n.value));
  return bits.length ? bits.slice(0, 8).join(" · ") : "";
}
