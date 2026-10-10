# Prompt and choice design

A bounded decision is only as good as its instructions and choice descriptions. This document shows the exact text Dawai Dost sends to OpenAI and explains each part.

Source: [`lib/ai/decide.ts`](../../lib/ai/decide.ts), [`lib/scenario.ts`](../../lib/scenario.ts), [`lib/voice/instructions.ts`](../../lib/voice/instructions.ts)

## Decisions API: `next_action` instructions

This is the text that `/api/decisions/district` and `/api/decisions/batch` send. It is the single source of truth in [`lib/ai/decide.ts`](../../lib/ai/decide.ts); the eval runner imports the same constant.

> Choose the single safest next operational step for the target facility. Apply these checks in order and stop at the first that holds.
> 1) Verify first: if the target's count is unverified, has a reportFlag, is already under recount, or its dailyUse is far from weeklyDispensedTrend divided by 7, choose verify_count.
> 2) Transfer: if one verified donor's transferable units (already net of its own reserve and open transfers) cover the target's gapUnits (coversGapPct 100), or nearly all of it (coversGapPct 75 or more), choose transfer_surplus. A donor that covers only a small part of the gap does not qualify, and unverified donors never count.
> 3) Escalate: if no verified donor qualifies and upstream status is delayed or unavailable, or districtStore.daysOfDistrictDemand is below the medicine's leadTimeDays, choose escalate_supply_gap. Do not treat a transfer as a cure for upstream shortages.
> 4) Otherwise choose draft_indent: resupply arrives in time and local surplus cannot cover the gap.
> If the snapshot contains a counterfactual field, judge that hypothetical scenario as stated. The officer must approve all actions.

| Part | Purpose |
| --- | --- |
| "Apply these checks in order and stop at the first that holds" | Makes the priority explicit: data quality, then local fix, then escalation, then indent |
| Check 1 names `verified`, `reportFlag`, recount, and `weeklyDispensedTrend` | A doubtful count, or a daily-use figure that contradicts the trend, leads to `verify_count` before any stock moves |
| Check 2 uses `coversGapPct` 75 or more | A transfer must close the gap, or nearly all of it. This is the fix for the over-recommended transfers the evals found. |
| "unverified donors never count" | Stock is never moved on a count that nobody has confirmed |
| Check 3 names upstream status and `districtStore.daysOfDistrictDemand` | When the district itself is short, the correct action is escalation |
| "Do not treat a transfer as a cure for upstream shortages" | Keeps the system honest about what local action can fix |
| Check 4 | An indent is the default when resupply can arrive in time |
| "counterfactual field" | Lets what-if re-runs work without a second prompt |
| "The officer must approve all actions" | States the human-in-the-loop policy |

### Why the prompt changed

The first version told the model to "prefer a local transfer when a verified donor has sufficient surplus". In the first live eval run, `gpt-6-luna` read "sufficient" too broadly and chose a transfer on 35 of 50 cases. That prompt scored 64%. A version with the criteria as ordered checks scored 94% on the same model. We moved the product to the ordered checks. The checks mirror the labeling policy, so the eval measures how well the model follows stated criteria. See [Decision evals](evals.md).

The original single-question route (`/api/decisions`) still uses the first, shorter text for the three-clinic scenario.

## Choice descriptions

Each choice has a description that says **when** it applies, not only what it is.

| Choice | Description |
| --- | --- |
| `verify_count` | Request a recount when the latest stock report is uncertain or inconsistent. |
| `transfer_surplus` | District call: "Move surplus from a verified nearby donor, preserving its safety reserve. Applies only when that donor's safe surplus covers the target's gap (or nearly all of it)." The original route uses: "Move available surplus from a nearby clinic while preserving its safety reserve." |
| `draft_indent` | Prepare a consumption-based indent when local transfer cannot cover the risk. |
| `escalate_supply_gap` | Escalate when inventory is insufficient and upstream supply is delayed or unavailable. |

The four choices follow the order of a real district response: check the data, fix it locally, order more, then escalate. Each choice is a real step an officer already takes.

## Supporting questions

The same call asks five more questions. Each is short and names the signals to use.

| Question | Instruction |
| --- | --- |
| `urgency` (score) | How soon must the officer act on the target facility, given days of stock versus lead time, the projected stockout date, and inbound stock? |
| `recount_needed` (predicate) | Is the target's latest stock count doubtful enough that it should be re-verified before any stock is moved or ordered? Consider the verified flag, reportFlag, report age and the dispensing trend. |
| `indent_arrives_in_time` (predicate) | Would a routine district indent placed today arrive before the target runs out? Compare days of stock with the resupply lead time and consider upstream supply status and district store stock. |
| `donor` (choice) | If stock is moved to the target, which donor should send it? Prefer verified donors whose safe surplus (already net of reserve) covers most of the gap at the shortest distance. Choose false when no donor can safely help. |
| `transfer_bridges_gap` (predicate) | Would a transfer from the best donor alone bridge the target's gap until resupply, without pushing that donor below its reserve? |

Each donor choice description is written by code from the snapshot, for example: `Kalyanpur PHC: 45 units transferable after reserve, 14.1 km away, covers 94% of the gap.` An unverified donor gets `, count unverified`.

## Realtime: check-in agent instructions

The `caller_agent` mode gives the Realtime model a fixed flow (see [Realtime API](realtime-api.md)). The key rules:

| Rule | Purpose |
| --- | --- |
| "Speak natural, polite Hindi ... Keep every turn under two short sentences." | Short turns keep the call under a minute |
| "When the pharmacist states a number, call check_count ... Never skip this." | Every count is checked before it is read back |
| "Never reveal or suggest the expected number." | The agent cannot lead the pharmacist to a number |
| "If they repeat the same number, accept it, call confirm_count with pharmacist_insisted=true." | The pharmacist's physical count wins, and the record shows the disagreement |
| "Never invent, guess, or round quantities — only use numbers the pharmacist says." | Stock numbers come from the report, not from the model |
| "Do not give medical advice or promise deliveries." | The voice model stays in its role; decisions belong to the Decisions API and the officer |

The simulated pharmacist mode has the reverse rules: "Facts are fixed. Use only these shelf counts" and "If asked to confirm or recount, repeat the same number."

## Responses API instructions

Each Responses API feature repeats the same three limits:

1. **Use only the given facts.** For example, the memo instructions say: "Use only figures that appear in FACTS, copied exactly. Never compute, round, add or estimate a number."
2. **Do not change the decision.** The explanation instructions say that the Decisions API "has ALREADY chosen the action; you are writing after the fact and must not change, second-guess, or re-rank it."
3. **State the data is synthetic.** Every instruction says the data is a synthetic demo district.

See [Responses API](responses-api.md) for each feature.

## Design rules we followed

1. **Facts in the input, judgment in the model.** All numbers are in the snapshot. The instructions describe how to weigh them.
2. **Name every signal.** The instructions list each snapshot field the model must consider.
3. **Write choices as conditions.** Each description says when the action applies.
4. **Give the model a way out.** The donor question has a `false` choice, so the model is never forced to pick a weak donor.
5. **State the limits.** The instructions say what the model must not do.
6. **Measure the prompt.** The eval set compares the product prompt with an action-only prompt, a minimal prompt, and an explicit-criteria prompt. The first live run showed that the product prompt over-recommends transfers (64%), and that ordered criteria fix most of it (94%). See [Decision evals](evals.md).
