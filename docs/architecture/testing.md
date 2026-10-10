# Testing

Dawai Dost uses Vitest. The tests check the stock engine, the state store, every OpenAI route, the escalation logic, the public Find medicine feature, and the eval tools. All OpenAI calls are mocked, so the tests run without an API key and at no cost.

## Run the checks

```powershell
npm test
npm run lint
npm run build
```

## Test strategy

- **Deterministic rules have exact tests.** Each formula has a test with known numbers. The hero numbers (Saraswati 16 strips, Kalyanpur 45 safe strips, Rampur 9 strips) are locked by a test.
- **Safety rules are property tests.** The planner tests check that no donor goes below its reserve, in the seed data and across generated scenarios.
- **The model boundary is tested by contract.** Tests mock the OpenAI responses and check that each route maps, validates, and falls back correctly.
- **Every fallback path is visible.** Tests check the `source` and `fallbackReason` fields, so fallback data cannot appear as live data.
- **Models cannot add numbers.** Tests check that indent quantities come from code, that the escalation memo rejects a number not in the facts, and that the public snapshot never carries shelf counts.

## Test files

### Stock engine and state

| File | What it checks |
| --- | --- |
| [`tests/district/engine.test.ts`](../../tests/district/engine.test.ts) | Exact hero numbers; a full facility-medicine grid with 12 weeks of consistent history; risk levels; stockout dates; zero use; distance and ETA; the count check (flags only the engineered suspicious count, large drops, and stale reports); forecasts with inbound stock; donors and the facts-only snapshot; the Amlodipine shortage with no donor; district KPIs |
| [`tests/district/plan-transfers.test.ts`](../../tests/district/plan-transfers.test.ts) | The hero pair is bridged from Kalyanpur without breaking its reserve; the near-expiry donor is preferred; a suspicious count is never a donor; no proposals in the district-wide shortage; open transfers are counted; every donor keeps its reserve across generated scenarios |
| [`tests/district/reducer.test.ts`](../../tests/district/reducer.test.ts) | Voice reports are verified or flagged for recount; low extraction confidence requests a recount; approving or rejecting a decision updates its linked transfer; recount, indent, and escalation approvals log the right events; delivery moves stock exactly once; the clock consumes stock, dispatches, and delivers without drift; reset |
| [`tests/district/receipt.test.ts`](../../tests/district/receipt.test.ts) | Actor attribution; report source (`voice` or `manual`); `CONFIRM_RECEIPT` for full delivery, shortfall (donor asked to recount), correction after auto-delivery, idempotency, and clamping |
| [`tests/district/simulation.test.ts`](../../tests/district/simulation.test.ts) | A week of simulation frames; the autopilot averts stockout-days compared with doing nothing; deterministic seeded scenarios |
| [`tests/scenario.test.ts`](../../tests/scenario.test.ts) | The original three-clinic rules: stock cover, donor reserve, zero use, snapshot content, fallback transfer and indent |

### Voice

| File | What it checks |
| --- | --- |
| [`tests/voice/voice-lib.test.ts`](../../tests/voice/voice-lib.test.ts) | Hindi number words (1–100, hundreds, thousands, spelling variants, Devanagari digits); the count plausibility check; the offline extractor skips daily use and strengths and uses recounted numbers; session configs give the check-in agent its tools and Hindi transcription but **never the expected numbers**; the availability answer suggests the nearest facility with stock |
| [`tests/voice/voice-routes.test.ts`](../../tests/voice/voice-routes.test.ts) | `/api/realtime/session` for each mode, missing credentials, and upstream rejection; `/api/voice/extract` structured outputs, validation, and fallback; `/api/voice/gloss` and `/api/voice/tts` fallbacks |

### Pharmacist app

| File | What it checks |
| --- | --- |
| [`tests/pharmacist/pharmacist.test.ts`](../../tests/pharmacist/pharmacist.test.ts) | Saraswati Metformin is the most urgent row; dispatch requests keep the donor reserve; Hindi inbox messages; dispatch and receipt actions; a short receipt logs a discrepancy and asks the donor to recount; keypad reports are `manual` and flag out-of-range counts |

### Decisions API

| File | What it checks |
| --- | --- |
| [`tests/ai/district-route.test.ts`](../../tests/ai/district-route.test.ts) | `/api/decisions/district`: input validation; labeled rules fallback without a key; one multi-question call with every answer mapped; a donor that was not offered is ignored; refused or invalid `next_action` falls back; upstream and network errors fall back. Fallback rules: verify first, escalate when upstream is delayed, indent otherwise; at most three donors offered; what-if edits recompute derived facts. `/api/decisions/batch`: validation, NDJSON progress and summary, labeled fallbacks without a key |
| [`tests/decisions-route.test.ts`](../../tests/decisions-route.test.ts) | The original `/api/decisions` route: labeled fallback, live mapping with probabilities, malformed requests, upstream rejection |

### Responses API and audio

| File | What it checks |
| --- | --- |
| [`tests/ai/responses-routes.test.ts`](../../tests/ai/responses-routes.test.ts) | `/api/explain`, `/api/briefing`, `/api/briefing/speech`, `/api/indent`, and `/api/ask`: validation, template output without a key, structured output mapping, fallback on bad output or errors, TTS audio streaming, indent quantities computed in code and netted for inbound transfers, the live Ask tool loop (function call, server tool, streamed answer) |
| [`tests/escalations/memo-route.test.ts`](../../tests/escalations/memo-route.test.ts) | `/api/escalations/memo`: template memo without a key; live prose with evidence values from code; rejection of a memo that cites a number not in the facts; the template passes its own number check |
| [`tests/find/ask-route.test.ts`](../../tests/find/ask-route.test.ts) | `/api/find/ask`: a typed Hindi question without a key; asking for a place; a text fallback for audio without a key; fallback to the deterministic parser when the Responses API fails |

### Escalations

| File | What it checks |
| --- | --- |
| [`tests/escalations/gap.test.ts`](../../tests/escalations/gap.test.ts) | Supply-gap detection: safe surplus first, unverified surplus ignored, open transfers netted, warehouse-closable gaps put on watch, no delivery date earlier than the state can dispatch, the seeded Amlodipine shortage ranked first |
| [`tests/escalations/leadtime.test.ts`](../../tests/escalations/leadtime.test.ts) | Observed lead time from the ledgers, overdue state consignments, consignment cycle from warehouse receipts |
| [`tests/escalations/lifecycle.test.ts`](../../tests/escalations/lifecycle.test.ts) | Escalation stages replayed from the timeline; linking of `escalate_supply_gap` decisions |

### Find medicine

| File | What it checks |
| --- | --- |
| [`tests/find/answer.test.ts`](../../tests/find/answer.test.ts) | The public snapshot never carries shelf counts and leaves out the warehouse; availability bands; report freshness; answers that send people elsewhere, mention an inbound transfer, distrust stale reports, and measure distance from a village |
| [`tests/find/match.test.ts`](../../tests/find/match.test.ts) | Hindi and English normalisation; "शुगर की दवा" maps to every diabetes medicine; "BP की दवा" maps to the hypertension medicines; misspelled place names; villages map to their PHC |

### Evals

| File | What it checks |
| --- | --- |
| [`tests/evals/cases-and-runner.test.ts`](../../tests/evals/cases-and-runner.test.ts) | 40–60 unique cases cover every action; ambiguous tags; labels follow the policy; snapshots match the product shape; the runner parses answers, retries server errors, does not retry an exhausted quota, and bounds concurrency |
| [`tests/evals/metrics.test.ts`](../../tests/evals/metrics.test.ts) | Accuracy with accepted alternatives, percentiles, reliability and ECE, Brier score, confusion matrix, per-action precision and recall, high-confidence errors, cost and latency |

## Next tests

- Browser tests for the call, decision, approval, and delivery flow with Playwright (the package is installed)
- Realtime session route tests with a mocked client-secret response
- A published live eval run (see [Decision evals](../openai/evals.md))
