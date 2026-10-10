# Roadmap

The prototype runs the complete loop for a synthetic district: 23 facilities, 10 tracer medicines, voice reports, count checks, Decisions API recommendations, transfers, indents, escalations, and a public availability page. The roadmap takes the same loop to a real district pilot. The architecture stays the same at each stage.

## Already in the prototype

These items were on the original roadmap. They now exist in code, on synthetic data.

| Item | Where |
| --- | --- |
| Structured extraction of counts from the call transcript | `/api/voice/extract` ([Responses API](../openai/responses-api.md#voice-report-extraction)) |
| Automatic recount when a count does not agree with the ledger | Count check in the engine and the `check_count` tool in the voice agent ([Realtime API](../openai/realtime-api.md)) |
| A tracer list of medicines for diabetes, hypertension, maternal health, and more | 10 medicines in [`lib/district/data.ts`](../../lib/district/data.ts) |
| Consumption from recent reports | The weekly ledger feeds forecasts and indents |
| Expiry matching | Donor ranking prefers stock that would expire unused ([Stock calculations](../architecture/stock-math.md#donor-ranking)) |
| Indent drafting | `/api/indent`: code sets quantities, the model writes the justification |
| Officer briefing in English and Hindi, with audio | `/api/briefing` and `/api/briefing/speech` |
| Escalation memo to the state, with evidence | `/api/escalations/memo` with a number check |
| Patient and ASHA availability check | `/find` page and the voice **Availability line** |
| Pharmacist task app | `/pharmacist` |
| Decision quality evaluation, with a measured live run | 50 labeled cases, 200 live calls, `/evals` ([Decision evals](../openai/evals.md)) |

## Stage 1: Real phone calls

- Connect the Realtime API to a phone line over SIP, or use a telephony partner.
- The AI calls each pharmacist on a weekly schedule with the existing `caller_agent` instructions and tools.
- Support a missed-call callback, so a pharmacist can call back at a better time.

## Stage 2: Measured quality

- Done: the product prompt now states the decision criteria in order. Re-measured on the shipped prompt, accuracy rose from 64% to 94%.
- Add a held-out case set that was not used to tune the prompt or the rules, including mixed-signal cases that no single rule covers.
- Run the other models when they are enabled on `/v1/decisions` for the project.
- Add labeled cases from officer decisions in a pilot, with consent.
- Track the agreement between recommendations and the officer's final action.

## Stage 3: District data and records

- Read dispatch data from the state drug distribution system (for example, DVDMS) to compare what was sent with what is on the shelf.
- Calculate lead time per medicine from warehouse history.
- Store reports, decisions, approvals, and escalations in a database with user roles.
- Keep a durable audit log of each decision with its snapshot, probabilities, and approver.

## Stage 4: More languages and states

- Add more Indian languages to the voice agent, the brief, and the Find medicine page.
- Configure medicines, lead times, and reserve rules per state.

## Stage 5: Follow-up automation

- Use agent workflows to track an approved transfer until the receiving pharmacist confirms it.
- Send the brief and recount requests through the channels officers and pharmacists already use, such as WhatsApp or SMS.

## Stage 6: District pilot

Run a pilot at a group of PHCs in one district with the district health team. See [Impact and pilot design](impact-and-pilot.md).

## How the OpenAI platform grows with the product

| Stage | OpenAI capability |
| --- | --- |
| Phone calls | Realtime API with SIP |
| Measured quality | Evals on labeled scenarios, with prompt variants and a rules baseline |
| Next action | Decisions API, with more questions and more context per call |
| Follow-up | Agent workflows with tools for messages and status checks |
| More languages | Realtime, TTS, transcription, and Responses API in more Indian languages |
