# Decisions API

The OpenAI Decisions API is the decision engine of Dawai Dost. It reads the stock situation of a district and selects the single best next step. This document explains how we use it and why it is the right tool for this task.

Source: [`app/api/decisions/route.ts`](../../app/api/decisions/route.ts), [`lib/scenario.ts`](../../lib/scenario.ts)

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

## Request

The server builds a compact **decision snapshot**. All values in the snapshot come from deterministic code. The model receives facts and does not calculate them.

```json
{
  "medicine": "Metformin 500 mg",
  "unit": "strip of 10 tablets",
  "targetClinic": "Saraswati PHC",
  "targetStockStrips": 16,
  "targetDailyUseStrips": 8,
  "targetDaysOfStock": 2,
  "resupplyLeadTimeDays": 5,
  "safetyBufferDays": 3,
  "reportStatus": "Count confirmed by pharmacist",
  "nearbyClinics": [
    { "clinic": "Kalyanpur PHC", "stock": 80, "dailyUse": 5, "daysOfStock": 16, "transferableStrips": 45 },
    { "clinic": "Rampur PHC", "stock": 9, "dailyUse": 6, "daysOfStock": 1.5, "transferableStrips": 0 }
  ],
  "decisionPolicy": "Recommend one next action. A district officer approves every transfer, indent, or escalation."
}
```

The server sends the snapshot with one `choice` question:

```json
{
  "model": "gpt-6-luna",
  "input": "<decision snapshot as JSON>",
  "questions": [{
    "type": "choice",
    "name": "next_action",
    "instructions": "Choose the single safest next operational step for the target PHC. ...",
    "choices": [
      { "value": "verify_count", "description": "Request a recount when the latest stock report is uncertain or inconsistent." },
      { "value": "transfer_surplus", "description": "Move available surplus from a nearby clinic while preserving its safety reserve." },
      { "value": "draft_indent", "description": "Prepare a consumption-based indent when local transfer cannot cover the risk." },
      { "value": "escalate_supply_gap", "description": "Escalate when inventory is insufficient and upstream supply is delayed or unavailable." }
    ]
  }]
}
```

Each choice has a description. The descriptions tell the model when each action applies, in operational words. The full reasoning behind the instructions is in [Prompt and choice design](prompt-design.md).

## Response

The API returns an answer for the `next_action` question. The values below are an example:

```json
{
  "answers": [{
    "name": "next_action",
    "choice": "transfer_surplus",
    "confidence": 0.82,
    "probabilities": [
      { "value": "verify_count", "probability": 0.05 },
      { "value": "transfer_surplus", "probability": 0.82 },
      { "value": "draft_indent", "probability": 0.09 },
      { "value": "escalate_supply_gap", "probability": 0.04 }
    ]
  }]
}
```

The server maps this into the shape the dashboard uses:

```json
{
  "action": "transfer_surplus",
  "confidence": 0.82,
  "probabilities": { "verify_count": 0.05, "transfer_surplus": 0.82, "draft_indent": 0.09, "escalate_supply_gap": 0.04 },
  "source": "live"
}
```

## Why probabilities matter

A single answer hides uncertainty. The per-choice probabilities show it.

- A **high** probability for one action tells the officer that the evidence is clear. The officer can approve quickly.
- **Two close** probabilities tell the officer that the case is borderline. For example, `transfer_surplus` at 0.48 and `draft_indent` at 0.41 suggests the officer should do both.
- A **high** `verify_count` probability tells the officer to trust the data less before acting.

The dashboard shows all four probabilities next to the recommendation. The officer sees what the model thinks and how sure it is.

## Validation

The server does not trust the response blindly. It checks:

1. The HTTP response is successful.
2. An answer named `next_action` exists.
3. The `choice` is one of the four defined actions.
4. Each probability belongs to a defined action. Unknown values are ignored. Missing values are set to 0.
5. If `confidence` is missing, the server uses the probability of the selected choice.

If any check fails, the server returns a deterministic fallback with a reason (`upstream_unavailable`, `unexpected_response`, or `request_failed`). The dashboard labels it clearly. See [Reliability and safety](../architecture/reliability-and-safety.md).

## What the model does not do

- It does not create or change stock values.
- It does not calculate surplus or days of stock.
- It does not approve the action.
- It does not contact a clinic or move medicine.

The model gives a recommendation. Code supplies the facts. The officer makes the decision.

## How it scales

The same pattern works for any number of medicines and clinics. Each alert creates one snapshot and one Decisions API call. A district with 40 PHCs and 20 tracer medicines creates only a few alerts each week, because most clinic-medicine pairs are above the threshold. The cost and latency stay small, and each decision is logged with its inputs and probabilities.
