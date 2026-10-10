# Audio

Dawai Dost uses OpenAI audio in six features:

| Feature | API | Model | Route |
| --- | --- | --- | --- |
| Hindi voice check-in with the pharmacist | Realtime API | `gpt-realtime-2.1` | `POST /api/realtime/session` (see [Realtime API](realtime-api.md)) |
| Live captions during the check-in | Realtime input transcription | `gpt-transcribe` | Inside the Realtime session |
| Hindi voice notes to pharmacists | Text to speech | `gpt-4o-mini-tts` | `POST /api/voice/tts` |
| Morning brief read aloud | Text to speech | `gpt-4o-mini-tts` | `POST /api/briefing/speech` |
| Public "Find medicine" voice question | Speech to text | `gpt-4o-mini-transcribe` | `POST /api/find/ask` |
| Public "Find medicine" spoken answer | Text to speech | `gpt-4o-mini-tts` | `POST /api/find/speak` |

## Briefing speech

**Route:** `POST /api/briefing/speech` · Source: [`app/api/briefing/speech/route.ts`](../../app/api/briefing/speech/route.ts)

| Setting | Value |
| --- | --- |
| Model | `gpt-4o-mini-tts` (override with `OPENAI_TTS_MODEL`) |
| Voice | `marin` |
| Format | MP3, streamed to the browser |
| Input | Up to 3,000 characters of brief text |
| Language | `en` or `hi` |

The route sends a short speaking instruction with each request:

| Language | Instruction |
| --- | --- |
| `hi` | "Speak in clear, warm Hindi at a measured pace, like a calm public-health briefing." |
| `en` | "Speak in clear Indian English at a measured pace, like a calm public-health briefing for a district officer." |

An officer can listen to the brief while travelling between facilities. A Hindi reading also helps staff who prefer Hindi.

### Fallback

If the key is missing or the TTS call fails, the route returns HTTP 503 with `{ "fallback": "browser_speech" }`. The client then falls back to the browser speech engine. The brief text is always on screen, so no information depends on audio.

## Hindi voice notes

**Route:** `POST /api/voice/tts` · Source: [`app/api/voice/tts/route.ts`](../../app/api/voice/tts/route.ts)

When a count needs a recount, the structured report shows a **Hindi voice note** button. It plays a short recount request for the pharmacist. In the sample availability line, the same route speaks the scripted answer.

The route turns up to 600 characters of text into an MP3 voice note with `gpt-4o-mini-tts`. The default voice is `marin`. The default instruction is: "Speak in warm, clear, unhurried Hindi, like a respectful district health office colleague leaving a short voice note for a rural pharmacist." On failure, it returns `{ "fallback": "browser_tts" }`.

## Find medicine: voice question

**Route:** `POST /api/find/ask` · Source: [`app/api/find/ask/route.ts`](../../app/api/find/ask/route.ts), [`lib/find/ask.ts`](../../lib/find/ask.ts)

A patient or ASHA worker can ask by voice, for example "शुगर की दवा सरस्वती में मिलेगी?" ("Is the sugar medicine available at Saraswati?"). The browser records a short clip (up to 4 MB) and sends it with the public availability snapshot.

1. **Transcribe.** `gpt-4o-mini-transcribe` (override with `OPENAI_FIND_TRANSCRIBE_MODEL`) turns the clip into text. The request sets the language (`hi` or `en`) and a **vocabulary prompt**: the Hindi names of the medicines and places in the district. This helps the model spell local medicine and village names the way the matcher expects.
2. **Parse.** The Responses API (`gpt-5.4-mini`, override with `OPENAI_FIND_PARSE_MODEL`) maps the question to medicine ids, a condition (for example `sugar` or `bp`), and a place id, with structured outputs. The schema only allows ids from the district catalogue. See [Responses API](responses-api.md#find-medicine-question-parsing).
3. **Answer.** Code, not a model, builds the answer from the availability snapshot ([`lib/find/answer.ts`](../../lib/find/answer.ts)).

Without a key, typed questions still work with a deterministic Hindi and English parser. A voice clip without a key returns HTTP 503 with `{ "fallback": "text" }`, so the page asks the person to type.

## Find medicine: spoken answer

**Route:** `POST /api/find/speak` · Source: [`app/api/find/speak/route.ts`](../../app/api/find/speak/route.ts)

The answer is read aloud with `gpt-4o-mini-tts` (override with `OPENAI_FIND_TTS_MODEL`), voice `marin`, up to 700 characters. The Hindi instruction asks for "simple, clear Hindi slowly and warmly, like a helpful health worker talking to a village patient. Say numbers clearly." On failure, the route returns `{ "fallback": "browser_tts" }`.

## Why `marin`

The Realtime voice check-in, the briefing, and the Find medicine answers use the same voice. The product sounds like one assistant across features.
