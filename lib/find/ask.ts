// OWNER: find agent. Server-only: voice question → transcript → (medicine, place) → answer text.
// Every OpenAI step has a deterministic fallback; the answer itself is always computed by lib/find/answer.
import { z } from "zod";
import { fallbackReasonOf, generateStructured, openaiClient } from "../ai/openai";
import { answerFor, originForFacility, originForVillage, type FindSnapshot, type Origin } from "./answer";
import { speakText, type Lang } from "./copy";
import { MEDICINE_WORDS, PLACE_HI, VILLAGES } from "./lexicon";
import { parseQuestion, type PlaceHit } from "./match";
import type { AskFields, AskResponse } from "./schema";

export const FIND_MODELS = {
  transcribe: () => process.env.OPENAI_FIND_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
  parse: () => process.env.OPENAI_FIND_PARSE_MODEL || "gpt-5.4-mini",
  tts: () => process.env.OPENAI_FIND_TTS_MODEL || "gpt-4o-mini-tts",
};

const MAX_SPOKEN_ANSWERS = 3;

/** Vocabulary hint so the transcriber spells medicine and place names the way our matcher expects. */
export function transcriptionPrompt(snapshot: FindSnapshot): string {
  const meds = Object.values(MEDICINE_WORDS).map((w) => w.hi).join(", ");
  const places = snapshot.facilities.map((f) => PLACE_HI[f.id] ?? f.name).join(", ");
  return `दवा का सवाल। दवाएँ: ${meds}, शुगर, BP। जगहें: ${places}।`;
}

export async function transcribe(key: string, audio: File, snapshot: FindSnapshot, lang: Lang): Promise<string> {
  const client = openaiClient(key);
  const res = await client.audio.transcriptions.create({
    file: audio,
    model: FIND_MODELS.transcribe(),
    language: lang === "hi" ? "hi" : "en",
    prompt: transcriptionPrompt(snapshot),
  });
  return (res.text ?? "").trim();
}

const PARSE_INSTRUCTIONS = `You read one short question from a patient or ASHA worker in rural Sehore district, India, usually in Hindi or Hinglish.
Pick the medicines they ask about and the place (village, PHC or CHC) they mention.
Rules:
- Only choose ids from the lists given. Never invent ids.
- If they name a condition ("शुगर की दवा", "BP की गोली") and no specific medicine, return every medicine listed for that condition and set condition.
- If no place is named, place_id is null. If no medicine can be identified, medicine_ids is empty.
- Do not answer the question. Do not guess stock.`;

function parseSchema(medicineIds: string[], placeIds: string[]) {
  return z.object({
    medicine_ids: z.array(z.enum(medicineIds as [string, ...string[]])),
    condition: z.enum(["sugar", "bp", "fever", "iron", "diarrhoea", "infection", "breathing"]).nullable(),
    place_id: z.enum(placeIds as [string, ...string[]]).nullable(),
  });
}

export async function parseLive(key: string, transcript: string, snapshot: FindSnapshot) {
  const medicineIds = [...new Set(snapshot.rows.map((r) => r.m))].filter((id) => MEDICINE_WORDS[id]);
  const facilityIds = new Set(snapshot.facilities.map((f) => f.id));
  const villages = VILLAGES.filter((v) => facilityIds.has(v.phcId));
  const placeIds = [...snapshot.facilities.map((f) => f.id), ...villages.map((v) => v.id)];
  const catalogue = {
    medicines: medicineIds.map((id) => ({ id, hindi: MEDICINE_WORDS[id].hi, also_called: MEDICINE_WORDS[id].aliases.slice(0, 5), for: MEDICINE_WORDS[id].conditions })),
    places: [
      ...snapshot.facilities.map((f) => ({ id: f.id, name: f.name, hindi: PLACE_HI[f.id] ?? null, block: f.block })),
      ...villages.map((v) => ({ id: v.id, name: `${v.name} village`, hindi: v.hi, block: null })),
    ],
  };
  const { data } = await generateStructured({
    key,
    model: FIND_MODELS.parse(),
    instructions: PARSE_INSTRUCTIONS,
    input: `Catalogue:\n${JSON.stringify(catalogue)}\n\nQuestion:\n${transcript}`,
    schema: parseSchema(medicineIds, placeIds),
    name: "find_question",
    effort: "low",
  });
  return data;
}

function originFromPlace(snapshot: FindSnapshot, place: PlaceHit | { kind: "facility" | "village" | "block"; id: string } | null): Origin | null {
  if (!place) return null;
  if (place.kind === "facility") return originForFacility(snapshot.facilities, place.id);
  if (place.kind === "village") return originForVillage(snapshot.facilities, place.id);
  return null;
}

/** Full ask pipeline given an already-known transcript. `key` null → deterministic parse only. */
export async function answerQuestion(fields: AskFields, transcript: string, key: string | null, transcribed: boolean): Promise<AskResponse> {
  const { snapshot, lang } = fields;
  const fallback = parseQuestion(transcript, snapshot.facilities, [...new Set(snapshot.rows.map((r) => r.m))]);
  let medicineIds = fallback.medicineIds;
  let conditionId: string | null = fallback.conditionId;
  let place: AskResponse["place"] = fallback.place ? { kind: fallback.place.kind, id: fallback.place.id } : null;
  let parse: "live" | "fallback" = "fallback";
  let fallbackReason: string | undefined = key ? undefined : "missing_api_key";

  if (key && transcript) {
    try {
      const live = await parseLive(key, transcript, snapshot);
      parse = "live";
      if (live.medicine_ids.length) { medicineIds = [...new Set(live.medicine_ids)]; conditionId = live.condition; }
      if (live.place_id) place = { kind: live.place_id.startsWith("v-") ? "village" : "facility", id: live.place_id };
    } catch (error) {
      fallbackReason = fallbackReasonOf(error);
    }
  }

  const origin = originFromPlace(snapshot, place) ?? (fields.origin ? (fields.origin as Origin) : null);
  const needs: AskResponse["needs"] = !medicineIds.length ? "medicine" : !origin ? "place" : null;
  const answerText = needs ? null : medicineIds.slice(0, MAX_SPOKEN_ANSWERS).map((m) => speakText(answerFor(snapshot, origin!, m), lang)).join(" ");
  return {
    transcript,
    medicineIds,
    conditionId,
    place,
    answerText,
    needs,
    source: { transcribe: transcribed ? "live" : "typed", parse },
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}
