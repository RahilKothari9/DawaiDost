# Decisions API evals

How we check that the OpenAI Decisions API picks the right district action. The report is at `/evals`.

## Method

- **Cases.** `lib/evals/cases.ts` holds 50 synthetic clinic × medicine cases. Each one is a facts-only snapshot in the same shape the product sends (`dawai-dost/decision-snapshot@2`, from `lib/ai/facts.ts`), built with the same derivations: days of stock, gap to lead time plus buffer, donor surplus after its 7-day reserve, upstream and warehouse status.
- **Labels.** Every case has an expected action and a one-line reason. The labels follow the written policy `EVAL_POLICY` (P1 verify first, P2 transfer when a verified donor covers the gap, P3 unverified donors do not count, P4 escalate when local cover fails and upstream is delayed or the warehouse is short, P5 otherwise indent). The labels were fixed before any model was run. Ten cases are tagged **ambiguous** and list the alternative actions an officer would also accept. `tests/evals` checks that every unambiguous label follows from its snapshot under the policy.
- **Categories.** Clear transfer (8), blocked by donor reserve (5), surplus too small (6), suspicious count (8), district-wide shortage (9), near-expiry donor (4), zero consumption (3), unverified donor (3), partial cover (4).
- **Prompt variants.**
  - `product` sends the exact multi-question call that `/api/decisions/district` makes (`buildQuestions` in `lib/ai/decide.ts`).
  - `action_only` uses the product instructions and choices, but asks only `next_action`.
  - `minimal` sends a one-line instruction and bare choice labels with the same snapshot.
- **Models.** `gpt-6-luna` with four prompt variants: the three above plus `policy` (explicit criteria). Other models can be passed with `--configs model:variant`, but with the project key only `gpt-6-luna` is enabled on `/v1/decisions`.
- **Baseline.** The product's deterministic fallback (`fallbackDecision` in `lib/ai/decide.ts`) runs on the same snapshots.
- **Execution.** Up to 4 calls run at once. A call gets up to 4 attempts with backoff on 429 and 5xx errors. An exhausted quota is not retried. A call that still fails counts as wrong.

## Metrics (`lib/evals/metrics.ts`)

| Metric | Definition |
| --- | --- |
| Accuracy | The chosen action is the expected one, or a listed alternative on an ambiguous case |
| Strict accuracy | The chosen action is the expected one |
| Per-action precision / recall, macro F1 | Precision and recall for each action, and their F1 averaged over actions |
| Confusion matrix | Expected action against chosen action |
| ECE | Expected calibration error over 5 equal-width confidence bins, with a reliability diagram |
| Brier score | Multi-class, against the expected label, on unambiguous cases |
| Latency | Mean, p50 and p95 |
| Tokens | Token totals per call |
| Cost | Calculated only when verified per-token prices are entered in `PRICING` in `lib/evals/report.ts`. These are left empty on purpose. |
| High-confidence errors | Wrong answers with confidence of 0.7 or more |

## Rerun

```sh
node scripts/evals/run.mjs                                    # full matrix, writes data/evals/results-YYYY-MM-DD.json
node scripts/evals/run.mjs --configs gpt-6-luna:product --cases T01,V01,E01
```

The launcher loads `.env.local` and runs `scripts/evals/run.ts` with Node's built-in TypeScript support. This needs Node 22.6 or later, and no `tsx`. The script makes one probe call first. If that call fails with a 4xx error, the script exits and writes nothing. `/evals` reads the newest `results-*.json`.

The **Run live** button on `/evals` streams a fresh run of 10 cases through `POST /api/evals/run` as NDJSON. Results from this button are not saved.

## Results (`results-2026-10-10.json`, measured)

Only `gpt-6-luna` is enabled on `/v1/decisions` for the project key. `gpt-6-sol`, `gpt-6.1-sol`, `gpt-5.5` and `gpt-5.4-mini` all return `404 model_not_found`, so this run compares prompt variants on one model, not models. The deterministic rules are the baseline.

| System | Accuracy (50) | Unambiguous (40) | Strict | Macro F1 | ECE | Brier | p50 / p95 | Tokens / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6-luna, product call | 64.0% (32) | 55.0% (22) | 58.0% | 0.57 | 0.117 | 0.581 | 151 / 266 ms | 1528 |
| gpt-6-luna, action only | 64.0% (32) | 55.0% (22) | 58.0% | 0.57 | 0.124 | 0.580 | 149 / 269 ms | 699 |
| gpt-6-luna, minimal prompt | 62.0% (31) | 52.5% (21) | 56.0% | 0.51 | 0.107 | 0.595 | 148 / 222 ms | 550 |
| gpt-6-luna, explicit criteria | 94.0% (47) | 92.5% (37) | 82.0% | 0.87 | 0.257 | 0.158 | 148 / 219 ms | 748 |
| Rules (`fallbackDecision`) | 98.0% (49) | 97.5% (39) | 94.0% | 0.95 | n/a (fixed templates) | n/a | <1 ms | 0 |

### What the run shows

- **The product prompt over-recommends transfers.** It chose `transfer_surplus` on 35 of 50 cases. That includes all 10 cases where donor surplus is real but too small to bridge the gap, or where the donor's reserve leaves too little to move. The high-confidence wrong transfers are R01 (0.84), S02, S04 and S05, all at 0.75 or more.
- **The product instructions barely beat the minimal prompt.** They score 64% against 62%. Spelling the decision criteria out in order (the explicit criteria variant) raises accuracy to 94%. This variant mirrors the labeling policy, so it shows the model follows stated criteria well. It is not evidence of independent judgment.
- **The extra product questions don't change the action.** Adding the urgency, recount and donor questions changed no `next_action` choice compared with action only, but used 2.2 times the input tokens.
- **The explicit criteria variant is underconfident.** Its mean confidence is 68% against 94% accuracy, which gives ECE 0.257.
- **The rules baseline beats every prompt on this set.** This is expected, because the rules and the labels encode the same policy. The explicit criteria variant still misses E04 (warehouse short while supply status is "available"), U03 (an unverified donor with full cover next to a weak verified one) and V05. The rules miss only V05.
- **No case was right for the model and wrong for the rules.**
- **The rules baseline changed mid-session.** It scored 90% earlier on 2026-10-10. The AI agent then changed `fallbackDecision` to stop counting unverified donors, and the numbers above use the current code.
