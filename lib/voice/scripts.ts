// Scripted, clearly labeled sample calls used when Realtime is unavailable (no key, mic denied, network).
// Built deterministically from the same facts the live session would receive.
import { hindiNumberWord } from "./numbers";
import type { MedicineFact, Speaker, VoiceFacts } from "./types";
import { checkCount } from "./validate";

export type ScriptStep = {
  speaker: Speaker;
  text: string;
  gloss?: string;
  /** Capture-chip side effect when this line plays. */
  capture?: { medicineId: string; state: "asking" | "heard" | "confirmed" | "recount"; count?: number; note?: string };
  delayMs?: number;
};

const say = (n: number) => (n <= 100 ? hindiNumberWord(n) : String(n));
const hi = (m: MedicineFact) => m.hindiName ?? m.name;

/** Caller prompts for the simulated-pharmacist mode (the browser plays the Dawai Dost caller). */
export function callerPrompts(facts: VoiceFacts): { text: string; gloss: string; medicineId: string | null }[] {
  const meds = facts.medicines ?? [];
  const name = facts.facility?.pharmacistName ?? "जी";
  const prompts: { text: string; gloss: string; medicineId: string | null }[] = meds.map((m, i) => ({
    text: i === 0
      ? `नमस्ते ${name} जी, Dawai Dost से साप्ताहिक स्टॉक कॉल है। ${hi(m)} ${m.strength} की कितनी ${m.unit} शेल्फ पर हैं?`
      : `धन्यवाद। अब ${hi(m)} ${m.strength} — कितनी ${m.unit} बची हैं?`,
    gloss: i === 0 ? `Hello ${name}, weekly Dawai Dost stock call. How many ${m.unit} of ${m.name} ${m.strength} are on the shelf?` : `Thanks. Now ${m.name} ${m.strength} — how many ${m.unit} left?`,
    medicineId: m.id,
  }));
  prompts.push({ text: "धन्यवाद, आपकी रिपोर्ट ज़िला कार्यालय में दर्ज हो गई है।", gloss: "Thank you, your report has been recorded at the district office.", medicineId: null });
  return prompts;
}

/** Sample conversation for the simulated-pharmacist mode. */
export function pharmacistSimScript(facts: VoiceFacts): ScriptStep[] {
  const meds = facts.medicines ?? [];
  const steps: ScriptStep[] = [];
  callerPrompts(facts).forEach((p, i) => {
    const m = meds[i];
    steps.push({ speaker: "agent", text: p.text, gloss: p.gloss, capture: m ? { medicineId: m.id, state: "asking" } : undefined });
    if (m) {
      const n = m.shelfCount ?? m.expected;
      steps.push({ speaker: "pharmacist", text: `अभी ${say(n)} ${m.unit} हैं, मैंने गिनती कर ली है।`, gloss: `There are ${n} ${m.unit} now; I have counted.`, capture: { medicineId: m.id, state: "heard", count: n }, delayMs: 1500 });
    } else steps.push({ speaker: "pharmacist", text: "धन्यवाद, नमस्ते।", gloss: "Thank you, goodbye.", delayMs: 1100 });
  });
  return steps;
}

/** Sample conversation for the live-mic check-in mode: agent asks, pharmacist answers, implausible counts get a recount. */
export function callerAgentScript(facts: VoiceFacts): ScriptStep[] {
  const meds = facts.medicines ?? [];
  const name = facts.facility?.pharmacistName ?? "";
  const steps: ScriptStep[] = [];
  meds.forEach((m, i) => {
    const intro = i === 0 ? `नमस्ते ${name} जी, Dawai Dost की साप्ताहिक स्टॉक कॉल है। ` : "ठीक है। ";
    steps.push({ speaker: "agent", text: `${intro}${hi(m)} ${m.strength} की कितनी ${m.unit} हैं?`, gloss: `${i === 0 ? "Hello, weekly stock call. " : ""}How many ${m.unit} of ${m.name}?`, capture: { medicineId: m.id, state: "asking" } });
    const said = m.shelfCount ?? m.expected;
    steps.push({ speaker: "pharmacist", text: `${say(said)} ${m.unit}।`, gloss: `${said} ${m.unit}.`, delayMs: 1600 });
    const check = checkCount(m, said);
    steps.push({ speaker: "tool", text: `check_count(${m.id}, ${said}) → ${check.plausible ? "plausible" : `implausible, expected ${check.expectedRange[0]}–${check.expectedRange[1]}`}`, capture: { medicineId: m.id, state: "heard", count: said }, delayMs: 500 });
    let final = said;
    if (!check.plausible) {
      steps.push({ speaker: "agent", text: `यह संख्या पिछले रिकॉर्ड से काफ़ी अलग है। क्या आप ${hi(m)} की शेल्फ एक बार दोबारा गिन सकते हैं?`, gloss: `That differs a lot from past records. Could you recount the ${m.name} shelf once?`, capture: { medicineId: m.id, state: "recount", count: said, note: "Recount asked on call" } });
      final = m.expected;
      steps.push({ speaker: "pharmacist", text: `माफ़ कीजिए, दोबारा गिना — ${say(final)} ${m.unit} हैं।`, gloss: `Sorry, recounted — ${final} ${m.unit}.`, delayMs: 2200 });
      steps.push({ speaker: "tool", text: `check_count(${m.id}, ${final}) → plausible`, capture: { medicineId: m.id, state: "heard", count: final }, delayMs: 500 });
    }
    steps.push({ speaker: "agent", text: `${hi(m)} — ${say(final)} ${m.unit}, सही?`, gloss: `${m.name} — ${final} ${m.unit}, correct?` });
    steps.push({ speaker: "pharmacist", text: "हाँ जी, सही है।", gloss: "Yes, correct.", delayMs: 1200 });
    steps.push({ speaker: "tool", text: `confirm_count(${m.id}, ${final})`, capture: { medicineId: m.id, state: "confirmed", count: final }, delayMs: 400 });
  });
  steps.push({ speaker: "agent", text: "धन्यवाद, आपकी रिपोर्ट दर्ज हो गई है। नमस्ते।", gloss: "Thank you, your report is recorded. Goodbye." });
  steps.push({ speaker: "tool", text: "end_call()", delayMs: 400 });
  return steps;
}

/** Plain-text transcript ("Agent: …" lines) for extraction. */
export function scriptToTranscript(steps: ScriptStep[]): { speaker: Speaker; text: string }[] {
  return steps.filter((s) => s.speaker !== "tool").map((s) => ({ speaker: s.speaker, text: s.text }));
}

export function recountVoiceNote(facts: VoiceFacts, medicineId: string): string {
  const m = facts.medicines?.find((x) => x.id === medicineId);
  const name = facts.facility?.pharmacistName ?? "";
  return m
    ? `नमस्ते ${name} जी, यह ज़िला स्वास्थ्य कार्यालय से संदेश है। ${hi(m)} ${m.strength} की आपकी पिछली गिनती रिकॉर्ड से मेल नहीं खाती। कृपया आज शाम तक शेल्फ दोबारा गिनकर Dawai Dost पर बताइए। धन्यवाद।`
    : "कृपया अपनी पिछली गिनती दोबारा जाँचें। धन्यवाद।";
}
