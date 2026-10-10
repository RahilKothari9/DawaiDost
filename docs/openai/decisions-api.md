# Decisions API

The OpenAI Decisions API is the decision engine of Dawai Dost. It reads the stock situation of one clinic and one medicine and selects the single best next step. In the same call, it also answers five supporting questions: how urgent the case is, whether the count needs a recount, whether a normal indent will arrive in time, which donor clinic should send stock, and whether that transfer will close the gap.

This document explains how we use the API and why it is the right tool for this task.

Source: [`lib/ai/decide.ts`](../../lib/ai/decide.ts), [`lib/ai/openai.ts`](../../lib/ai/openai.ts), [`lib/ai/facts.ts`](../../lib/ai/facts.ts), [`app/api/decisions/district/route.ts`](../../app/api/decisions/district/route.ts), [`app/api/decisions/batch/route.ts`](../../app/api/decisions/batch/route.ts), [`app/api/decisions/route.ts`](../../app/api/decisions/route.ts)

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/decisions/district` | `POST` | One facility and one medicine. One Decisions API call with up to six questions. |
| `/api/decisions/batch` | `POST` | Up to 80 facility-medicine pairs. Runs them with bounded concurrency and streams each result as it finishes. |
| `/api/decisions` | `POST` | The original single-question route for the three-clinic Metformin scenario. |

All three routes call `POST https://api.openai.com/v1/decisions` with the model from `OPENAI_DECISIONS_MODEL` (default `gpt-6-luna`).

## The decision we ask for

A district officer has many clinics and little time. For each alert, the officer must answer one question: **what do we do next?**

There are four realistic answers in district medicine operations:

| Action | Meaning | When it applies |
| --- | --- | --- |
| `verify_count` | Ask the pharmacist for a recount | The report is uncertain or does not agree with expected use |
| `transfer_surplus` | Move stock from a nearby clinic | A nearby clinic has surplus after it keeps its own reserve |
| `draft_indent` | Prepare a resupply order for the district store | Local transfer cannot cover the gap |
| `escalate_supply_gap` | Report a shortage above the district level | Stock is not available locally and upstream supply is delayed |

The Decisions API selects one of these four. It cannot select anything else.

## Why the Decisions API

We considered three approaches.

| Approach | Problem |
| --- | --- |
| Fixed rules only | Rules cannot weigh all signals together, such as an uncertain count, a small surplus, and a long lead time. Each new case needs a new rule. |
| Chat model with free text | The output is a paragraph. The server must parse it, and the model can suggest an action that does not exist. |
| **Decisions API** | The output is one valid choice with a probability for each choice. It is easy to validate, show, and log. |

The Decisions API gives us the judgment of a large model with the safety of a fixed output. This is the correct shape for a public health operation.

## One call, six questions

The district route asks every question in **one** Decisions API call. The model reads the snapshot once and answers each question against the same facts. This keeps the answers consistent with each other, and it costs one round trip.

| Question | Type | Output | Use in the product |
| --- | --- | --- | --- |
| `next_action` | `choice` | One of the four actions, with a probability for each | The recommendation on the decision card |
| `urgency` | `score` | Probabilities over `monitor`, `this_week`, `today`, plus an expected score from 0 to 2 | Sorts the decision queue, most urgent first |
| `recount_needed` | `predicate` | Probability that the count must be checked before stock moves | Warns the officer about a doubtful count |
| `indent_arrives_in_time` | `predicate` | Probability that a normal indent placed today arrives before the shelf is empty | Shows whether an indent alone is enough |
| `donor` | `choice` | One donor facility id, or `false` for "no suitable donor" | Selects the source clinic for a transfer |
| `transfer_bridges_gap` | `predicate` | Probability that the best donor alone closes the gap without breaking its reserve | Shows if a transfer is a full fix or a partial one |

The server asks `donor` and `transfer_bridges_gap` only when at least one donor has safe surplus. It offers at most three donors. Each donor choice has a description written by code, for example: `Kalyanpur PHC: 45 units transferable after reserve, 14.1 km away, covers 94% of the gap.` The `false` choice lets the model say that no donor can help. This is better than forcing it to pick a weak donor.

### Score levels

| Level | Description sent to the model |
| --- | --- |
| `monitor` | Stock covers the lead time plus buffer, or inbound stock already covers the gap. Review at the next cycle. |
| `this_week` | Stock runs below the lead time plus buffer within the week; act in the next few days. |
| `today` | Stockout has happened or will happen before resupply could arrive; act today. |

## Request

### The decision snapshot

The browser builds a **facts-only snapshot** for one facility and one medicine. Every number in it comes from deterministic code ([`lib/ai/facts.ts`](../../lib/ai/facts.ts), [`lib/district/engine.ts`](../../lib/district/engine.ts)). The model receives facts. It does not calculate them.

The snapshot contains:

- the medicine, its lead time, safety buffer, and donor reserve
- the target facility: stock, daily use, days of stock, threshold, risk level, gap, projected stockout date, report age, verification flag, count-check result, inbound transfers, and the recent weekly dispensing trend
- eligible donors only, as defined by the engine rules (verified, count check clean, above reserve, within 80 km). Each donor has its distance, stock, daily use, transferable units after reserve and open outbound transfers, and the share of the gap it can cover. Donors are ranked by gap cover per kilometre.
- upstream supply status and district warehouse cover
- the decision policy: "Recommend one next action. A district officer approves every transfer, indent, or escalation."

The route accepts a snapshot of up to 40,000 characters. Facility and medicine ids must match a strict pattern.

### The call

```json
{
  "model": "gpt-6-luna",
  "input": "<facts-only snapshot as JSON>",
  "questions": [
    { "type": "choice", "name": "next_action", "instructions": "Choose the single safest next operational step for the target facility. Apply these checks in order ...", "choices": [ "...four actions..." ] },
    { "type": "score", "name": "urgency", "instructions": "How soon must the officer act ...", "levels": [ "...monitor, this_week, today..." ] },
    { "type": "predicate", "name": "recount_needed", "instructions": "Is the target's latest stock count doubtful enough ..." },
    { "type": "predicate", "name": "indent_arrives_in_time", "instructions": "Would a routine district indent placed today arrive before the target runs out? ..." },
    { "type": "choice", "name": "donor", "instructions": "If stock is moved to the target, which donor should send it? ...", "choices": [ "...up to 3 donors...", { "value": false, "description": "No donor: none can safely bridge the gap." } ] },
    { "type": "predicate", "name": "transfer_bridges_gap", "instructions": "Would a transfer from the best donor alone bridge the target's gap ..." }
  ]
}
```

The full `next_action` instructions. They state the decision criteria as ordered checks. We rewrote them this way after the first live eval run (see [Evals drove a prompt fix](#evals-drove-a-prompt-fix)).

> Choose the single safest next operational step for the target facility. Apply these checks in order and stop at the first that holds.
> 1) Verify first: if the target's count is unverified, has a reportFlag, is already under recount, or its dailyUse is far from weeklyDispensedTrend divided by 7, choose verify_count.
> 2) Transfer: if one verified donor's transferable units (already net of its own reserve and open transfers) cover the target's gapUnits (coversGapPct 100), or nearly all of it (coversGapPct 75 or more), choose transfer_surplus. A donor that covers only a small part of the gap does not qualify, and unverified donors never count.
> 3) Escalate: if no verified donor qualifies and upstream status is delayed or unavailable, or districtStore.daysOfDistrictDemand is below the medicine's leadTimeDays, choose escalate_supply_gap. Do not treat a transfer as a cure for upstream shortages.
> 4) Otherwise choose draft_indent: resupply arrives in time and local surplus cannot cover the gap.
> If the snapshot contains a counterfactual field, judge that hypothetical scenario as stated. The officer must approve all actions.

The `transfer_surplus` choice description in this call also states its condition: "Move surplus from a verified nearby donor, preserving its safety reserve. Applies only when that donor's safe surplus covers the target's gap (or nearly all of it)."

See [Prompt and choice design](prompt-design.md) for the reason behind each phrase.

## Response

The server maps the answers into one `DecisionRecord` with an `ai` block. Example shape (values are illustrative):

```json
{
  "action": "transfer_surplus",
  "confidence": 0.82,
  "probabilities": { "verify_count": 0.05, "transfer_surplus": 0.82, "draft_indent": 0.09, "escalate_supply_gap": 0.04 },
  "urgency": 1,
  "source": "live",
  "model": "gpt-6-luna",
  "latencyMs": 1840,
  "ai": {
    "engine": "decisions-api",
    "questions": ["next_action", "urgency", "recount_needed", "indent_arrives_in_time", "donor", "transfer_bridges_gap"],
    "urgencyLevel": "today",
    "urgencyScore": 2,
    "urgencyProbabilities": { "monitor": 0.02, "this_week": 0.08, "today": 0.9 },
    "recountProbability": 0.06,
    "indentInTime": 0.12,
    "transferBridgesGap": 0.71,
    "donor": { "facilityId": "kalyanpur", "confidence": 0.88, "probabilities": [{ "value": "kalyanpur", "probability": 0.88 }, { "value": false, "probability": 0.12 }] },
    "refusals": [],
    "usage": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "cachedTokens": 0 }
  }
}
```

The record keeps the exact snapshot that the server sent. An auditor can see what the model knew when it made the recommendation.

## Batch decisions

`POST /api/decisions/batch` takes up to 80 items. It runs them with a default concurrency of 4 (maximum 8) and streams newline-delimited JSON (NDJSON). The decision queue fills in while the batch runs.

| Event | Content |
| --- | --- |
| `start` | Total items, concurrency, model, and whether live credentials exist |
| `progress` | The item that is now running |
| `decision` | A complete `DecisionRecord` for one item |
| `error` | One item failed; the others continue |
| `done` | Counts of live, fallback, and failed items, total tokens, and elapsed time |

If the officer closes the page, the server stops the remaining work.

## What-if analysis

The snapshot builder can apply a **counterfactual** before the call. The server sends the changed snapshot with a `counterfactual` field, for example `What-if scenario (not real data): Best donor unavailable.` Code recalculates days of stock, gap, risk, and donor cover for the changed facts.

| Counterfactual | Change |
| --- | --- |
| Best donor unavailable | Remove the best donor |
| No donors at all | Remove all donors |
| Count was half | Halve the target's count |
| Count was double | Double the target's count |
| Count unverified | Mark the count as not verified |
| Upstream delayed | Mark upstream supply as delayed |

The officer can see how the recommendation changes when one fact changes. This tests whether the model reacts to the right signals.

## Why probabilities matter

A single answer hides uncertainty. The per-choice probabilities show it.

- A **high** probability for one action tells the officer that the evidence is clear. The officer can approve quickly.
- **Two close** probabilities tell the officer that the case is borderline. For example, `transfer_surplus` at 0.48 and `draft_indent` at 0.41 suggests the officer should do both.
- A **high** `recount_needed` probability tells the officer to trust the count less before acting.
- A **low** `transfer_bridges_gap` probability tells the officer that a transfer is only a bridge, and an indent is still necessary.

## Validation

The server does not trust the response blindly. It checks:

1. The HTTP response is successful and is JSON with an `answers` array.
2. An answer named `next_action` exists and is not a refusal.
3. The `next_action` choice is one of the four defined actions.
4. Each probability belongs to a defined action and is clamped to 0–1. Unknown values are ignored. Missing values are set to 0.
5. The `donor` choice is one of the offered donor ids or `false`. Any other value is ignored.
6. If `confidence` is missing, the server uses the probability of the selected choice.
7. The server records any question that the API declined in `refusals`.

The request has a 20-second timeout.

## Fallback

If the key is missing or any check fails, the server returns a deterministic decision with `source: "demo_fallback"` and a reason (`missing_api_key`, `upstream_unavailable`, `unexpected_response`, or `request_failed`). The fallback follows the same rules as the engine:

1. Count not verified or flagged → `verify_count`
2. The best donor covers at least 75% of the gap, or all donors together cover it → `transfer_surplus`
3. Upstream supply delayed, or the district warehouse holds less than the lead time → `escalate_supply_gap`
4. Otherwise → `draft_indent`

The fallback record includes a `ruleTrace` that lists which rules fired, and `engine: "rules"`. Its probabilities are fixed templates, and the dashboard labels them as demo data. See [Reliability and safety](../architecture/reliability-and-safety.md).

## Evals drove a prompt fix

The first live eval run on 50 labeled cases found a real failure mode before any officer saw it. The original product prompt said "prefer a local transfer when a verified donor has sufficient surplus". `gpt-6-luna` read that too broadly. It chose `transfer_surplus` on 35 of 50 cases, including cases where the donor's safe surplus was real but too small to close the gap. The product prompt scored 64%.

A candidate prompt that stated the decision criteria as ordered checks scored 94% on the same model and snapshots. The product now sends ordered criteria, and the `transfer_surplus` description says when a transfer applies. The fallback rules use the same 75% coverage threshold.

The ordered criteria follow the same written policy that the eval labels follow. So the 94% shows that the model follows stated criteria well. It is not proof of independent judgment. A re-run of the eval with the new product prompt is the measured check; see [Decision evals](evals.md).

## The original single-question route

`POST /api/decisions` is the first version of the integration. It is still used by the original three-clinic flow and its tests. It sends one `choice` question (`next_action`) with the four actions and a fixed snapshot for Saraswati PHC, Kalyanpur PHC, and Rampur PHC. The validation and fallback rules are the same.

## What the model does not do

- It does not create or change stock values.
- It does not calculate surplus, gaps, or days of stock.
- It does not approve the action.
- It does not contact a clinic or move medicine.

The model gives a recommendation. Code supplies the facts. The officer makes the decision.

## How it scales

Each at-risk clinic-medicine pair creates one snapshot and one Decisions API call. The batch route runs a district's alerts in parallel. Most pairs are above the threshold in a normal week, so the number of calls stays small. Each decision is stored with its inputs, probabilities, model, latency, and token use.
