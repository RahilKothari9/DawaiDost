# Responses API

The Decisions API chooses the action. The OpenAI Responses API writes the words around it: the officer's morning brief, the reason for a recommendation, the indent justification, the escalation memo to the state, and answers to free questions about the district.

Every Responses API feature in Dawai Dost follows the same rule: **code computes every number, the model writes text.** Each feature uses strict structured outputs, so the server receives typed JSON, not free text. Each feature has a labeled template fallback.

Source: [`lib/ai/openai.ts`](../../lib/ai/openai.ts) (`generateStructured()`), and the routes listed below.

## Features

| Feature | Route | Default model | Env override | Output |
| --- | --- | --- | --- | --- |
| Decision explanation | `POST /api/explain` | `gpt-5.4-mini` | `OPENAI_EXPLAIN_MODEL` | 2–3 sentences in English and Hindi, plus 2–4 key facts |
| Morning brief | `POST /api/briefing` | `gpt-6-sol` | `OPENAI_BRIEFING_MODEL` | Headline, 3–5 bullets with a tone, 1–3 actions, in English and Hindi |
| Ask the district | `POST /api/ask` | `gpt-5.5` | `OPENAI_ASK_MODEL` | Streamed answer, grounded in function-tool results |
| Indent drafting | `POST /api/indent` | `gpt-5.4-mini` | `OPENAI_INDENT_MODEL` | One justification sentence per line, plus a covering note |
| Escalation memo | `POST /api/escalations/memo` | `gpt-5.5` | `OPENAI_MEMO_MODEL` | Subject, summary, Hindi summary, specific asks, and evidence remarks |
| Find medicine question parsing | `POST /api/find/ask` | `gpt-5.4-mini` | `OPENAI_FIND_PARSE_MODEL` | Medicine ids, condition, and place id from a Hindi or English question |
| Voice report extraction | `POST /api/voice/extract` | `gpt-5.4-mini` | `OPENAI_VOICE_EXTRACT_MODEL` | One shelf count per medicine from a Hindi call transcript, with confidence and evidence |
| Transcript gloss | `POST /api/voice/gloss` | `gpt-5.4-mini` | none | Plain English translation of each Hindi transcript line |

All calls use `reasoning: { effort: "low" }`.

## Structured outputs

`generateStructured()` wraps `client.responses.parse()` with a zod schema converted by `zodTextFormat()`. The server then checks the parsed result with the same schema. If the output is missing or does not match, the route returns the template fallback with `fallbackReason: "unexpected_response"`.

```ts
const res = await client.responses.parse({
  model,
  instructions,
  input: JSON.stringify(facts),
  reasoning: { effort: "low" },
  text: { format: zodTextFormat(schema, "morning_briefing") },
});
```

Each result carries `source` (`live` or `demo_fallback`), `model`, `latencyMs`, and `generatedAt`, so the interface can label it.

## Decision explanation

**Route:** `POST /api/explain` · Source: [`app/api/explain/route.ts`](../../app/api/explain/route.ts)

The officer sees why the system recommends an action. The route receives the Decisions API result and the same snapshot the model saw. The Responses API writes a short reason in English and Hindi.

The instructions make one point very clear: the Decisions API **already chose** the action. The explanation model must not change, question, or re-rank it. If the Decisions API chose a donor, the explanation must name that donor and no other. If the top two probabilities are within 0.15, the explanation must say that the case is borderline.

## Morning brief

**Route:** `POST /api/briefing` · Source: [`app/api/briefing/route.ts`](../../app/api/briefing/route.ts), [`lib/ai/summary.ts`](../../lib/ai/summary.ts)

The browser builds a compact district summary in code: stockouts, the shortest days of stock, pending decisions, transfers in motion, and escalations. The model writes an 8 a.m. brief from that summary only. The instructions put stockouts first. Each bullet has a tone: `risk`, `progress`, or `info`.

The brief can be read aloud. See [Audio](audio.md).

## Ask the district

**Route:** `POST /api/ask` · Source: [`app/api/ask/route.ts`](../../app/api/ask/route.ts), [`lib/ai/tools.ts`](../../lib/ai/tools.ts)

The officer can ask a question in English or Hindi, for example "Which clinics will run out of Metformin this week?" The model answers by calling function tools. The tools run on the server over a compact copy of the district state that the browser sends.

| Tool | Returns |
| --- | --- |
| `get_stock` | Stock, daily use, days of stock, and risk for a facility, a medicine, or both |
| `list_at_risk` | At-risk records, most urgent first, filtered by medicine, block, or days of stock |
| `find_donors` | Nearby facilities that can safely send a medicine, with transferable units after reserve |
| `get_transfers` | Transfers filtered by facility, medicine, or status |
| `draft_transfer_proposal` | A reserve-safe transfer draft. It does not execute anything. |

The tools use strict JSON schemas. The loop runs up to 5 rounds. It chains rounds with `previous_response_id` and streams the answer.

The instructions require that **every number, date, or facility in the answer comes from a tool result**. If the tools do not return it, the model must say it does not have it. The model cannot approve or execute an action. It gives no clinical advice.

The route streams newline-delimited JSON events to the browser:

| Event | Content |
| --- | --- |
| `meta` | `live` or `demo_fallback`, and the model |
| `tool_call` | The tool name and its arguments |
| `tool_result` | A one-line summary of the result |
| `delta` | A piece of answer text |
| `done` | Source and latency |

The officer sees each tool call as it happens. This shows where each fact came from.

**Fallback.** Without a key, or if the call fails before any text, a keyword planner selects one of the same tools, runs it, and writes a template answer. The answer is labeled as demo data.

## Indent drafting

**Route:** `POST /api/indent` · Source: [`app/api/indent/route.ts`](../../app/api/indent/route.ts), [`lib/ai/indent.ts`](../../lib/ai/indent.ts)

An indent is a resupply request from a facility to the District Drug Store. Code computes every quantity:

```text
required = average daily use × (lead time + safety buffer + review period) − stock − inbound
```

The average daily use comes from the last 8 weeks of the dispensing ledger when at least 3 weeks exist. Otherwise it uses the reported daily use. The default review period is 30 days.

The model writes only one sentence of justification per line and a short covering note. It must not change any quantity. If the model leaves a line empty, the code keeps the template sentence for that line.

## Escalation memo

**Route:** `POST /api/escalations/memo` · Source: [`app/api/escalations/memo/route.ts`](../../app/api/escalations/memo/route.ts), [`lib/escalations/memoServer.ts`](../../lib/escalations/memoServer.ts), [`lib/escalations/memo.ts`](../../lib/escalations/memo.ts)

When the district cannot close a gap locally, the officer writes to the state drug procurement corporation. Code in [`lib/escalations/gap.ts`](../../lib/escalations/gap.ts) computes all the facts: district cover, warehouse stock, facilities at risk, the quantity to request, and the requested delivery date. The model writes the memo in the register of an Indian government office note, with a Hindi summary.

This feature has an extra guard. After the model answers, the server extracts **every number** from the memo text. It compares each one with the numbers in the facts. If the memo contains a number that is not in the facts, the server rejects the memo and returns the template memo with `fallbackReason: "unverified_number"`. A model cannot put an invented quantity or date into a letter to the state.

## Find medicine question parsing

**Route:** `POST /api/find/ask` · Source: [`lib/find/ask.ts`](../../lib/find/ask.ts)

The public Find medicine page takes a short question from a patient or ASHA worker, often in Hindi or Hinglish. The Responses API reads the question and returns only ids: medicine ids, a condition (`sugar`, `bp`, `fever`, `iron`, `diarrhoea`, `infection`, or `breathing`), and a place id. The schema uses enums built from the district catalogue, so the model cannot return an id that does not exist. The instructions say: "Do not answer the question. Do not guess stock."

Code then builds the answer from a public snapshot that contains availability bands (`available`, `low`, `out`), never shelf counts. If the live parse fails, a deterministic parser with a Hindi and English lexicon handles the question. For voice input, see [Audio](audio.md).

## Voice report extraction

**Route:** `POST /api/voice/extract` · Source: [`lib/voice/extract.ts`](../../lib/voice/extract.ts), [`lib/voice/validate.ts`](../../lib/voice/validate.ts)

After a voice check-in, the transcript goes to the Responses API. The model returns one report per medicine for which **the pharmacist** stated a count. The schema limits `medicine_id` to the medicines asked about in the call. Each report has:

| Field | Meaning |
| --- | --- |
| `count` | The final count, in digits. After a recount, the recounted number. |
| `confidence` | 0–1: how clearly the pharmacist stated and confirmed the number |
| `pharmacist_confirmed` | True if the pharmacist confirmed a read-back |
| `evidence` | The pharmacist's exact words |

The instructions convert Hindi number words to digits (सोलह = 16, बयालीस = 42, डेढ़ सौ = 150). They ignore numbers spoken only by the agent, daily use, strengths such as 500 mg, and lead times. They forbid any count that was not said. An unconfirmed count gets 10% less confidence. Code then validates each report, and the store runs the ledger count check. The call uses `store: false`.

**Fallback.** A deterministic parser with a Hindi number-word table ([`lib/voice/numbers.ts`](../../lib/voice/numbers.ts)) extracts the counts, labeled `source: "fallback"`.

## Transcript gloss

**Route:** `POST /api/voice/gloss` · Source: [`lib/voice/gloss.ts`](../../lib/voice/gloss.ts)

Judges and officers who do not read Hindi see an English line under each Hindi transcript line. The Responses API translates up to 12 lines at once with a structured output that must return exactly one translation per line. If the count does not match, or the call fails, a keyword gloss is used and labeled `fallback`.

## Guardrails common to all features

| Guardrail | How |
| --- | --- |
| Facts come from code | Each route sends a computed summary, snapshot, or tool result. The model never receives a task that needs arithmetic. |
| Typed output | Strict JSON schemas through structured outputs, then a second zod check on the server |
| No new numbers | Instructions forbid invented numbers. The escalation memo also checks every number in code. |
| Labeled fallback | Every route returns a template with `source: "demo_fallback"` (or `fallback`) and a reason |
| Key stays on the server | All calls run in Node.js route handlers |
| Input limits | Each route validates its body with zod and limits sizes (for example 2,000 characters per question and 16 messages in Ask) |
| Synthetic data | Each instruction states that the data is a synthetic demo district |
