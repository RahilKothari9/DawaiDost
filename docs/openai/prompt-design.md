# Prompt and choice design

A bounded decision is only as good as its instructions and choice descriptions. This document shows the exact text Dawai Dost sends to OpenAI and explains each part.

## Decisions API instructions

> Choose the single safest next operational step for the target PHC. Consider report verification, days of stock, the resupply lead time plus safety buffer, donor surplus after its reserve, and whether the action can bridge the gap. Prefer a local transfer when sufficient surplus exists and preserve the donor's 7-day reserve. Do not treat a transfer as a cure for upstream shortages. The officer must approve all actions.

| Phrase | Purpose |
| --- | --- |
| "single safest next operational step" | Asks for one action, and makes safety the first goal |
| "report verification" | Makes data quality part of the decision, so a doubtful count leads to `verify_count` |
| "days of stock, the resupply lead time plus safety buffer" | Names the exact signals that define risk |
| "donor surplus after its reserve" | The model sees surplus that is already safe to move |
| "whether the action can bridge the gap" | Stops a small transfer from being chosen when it cannot cover the risk |
| "Prefer a local transfer when sufficient surplus exists" | A transfer is the fastest and cheapest fix, so it comes first |
| "preserve the donor's 7-day reserve" | A transfer must never create a new stockout |
| "Do not treat a transfer as a cure for upstream shortages" | When the district is short, the correct action is `draft_indent` or `escalate_supply_gap` |
| "The officer must approve all actions" | States the human-in-the-loop policy |

## Choice descriptions

Each choice has a description that says **when** it applies, not only what it is.

| Choice | Description |
| --- | --- |
| `verify_count` | Request a recount when the latest stock report is uncertain or inconsistent. |
| `transfer_surplus` | Move available surplus from a nearby clinic while preserving its safety reserve. |
| `draft_indent` | Prepare a consumption-based indent when local transfer cannot cover the risk. |
| `escalate_supply_gap` | Escalate when inventory is insufficient and upstream supply is delayed or unavailable. |

The four choices follow the order of a real district response: check the data, fix it locally, order more, then escalate. Each choice is a real step an officer already takes.

## Realtime instructions

> Role-play the fictional Saraswati PHC pharmacist in Hindi. Answer each question briefly and warmly. Facts are fixed: 16 strips of Metformin 500 mg, recount confirmed, about 8 strips dispensed daily, and resupply takes about 5 days. Do not invent quantities, recommend medical care, or choose a district action. This is a simulated demo call.

| Phrase | Purpose |
| --- | --- |
| "in Hindi" | The call uses the pharmacist's language |
| "briefly and warmly" | Short answers keep the call under a minute |
| "Facts are fixed" | The voice model repeats only the supplied numbers |
| "Do not invent quantities" | Stock numbers come from the report, not from the model |
| "recommend medical care, or choose a district action" | The voice model stays in its role; decisions belong to the Decisions API and the officer |

## Design rules we followed

1. **Facts in the input, judgment in the model.** All numbers are in the snapshot. The instructions describe how to weigh them.
2. **Name every signal.** The instructions list each signal the model must consider.
3. **Write choices as conditions.** Each description says when the action applies.
4. **State the limits.** The instructions say what the model must not do.
5. **Keep it short.** Short instructions are easier to test and to review.
