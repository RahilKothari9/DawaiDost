# Decisions API evals

How we check that the OpenAI Decisions API picks the right district action. The report is at `/evals`.

## Method

- **Cases.** `lib/evals/cases.ts` holds 50 synthetic clinic × medicine cases. Each one is a facts-only snapshot in the same shape the product sends (`dawai-dost/decision-snapshot@2`, from `lib/ai/facts.ts`), built with the same derivations: days of stock, gap to lead time plus buffer, donor surplus after its 7-day reserve, upstream and warehouse status.
- **Labels.** Every case has an expected action and a one-line reason. The labels follow the written policy `EVAL_POLICY` (P1 verify first, P2 transfer when a verified donor covers the gap, P3 unverified donors do not count, P4 escalate when local cover fails and upstream is delayed or the warehouse is short, P5 otherwise indent). The labels were fixed before any model was run. Ten cases are tagged **ambiguous** and list the alternative actions an officer would also accept. `tests/evals` checks that every unambiguous label follows from its snapshot under the policy.
- **Categories.** Clear transfer (8), blocked by donor reserve (5), surplus too small (6), suspicious count (8), district-wide shortage (9), near-expiry donor (4), zero consumption (3), unverified donor (3), partial cover (4).
- **Prompt variants.**
  - `product` sends exactly what `/api/decisions/district` sends: `buildQuestions` with `NEXT_ACTION_INSTRUCTIONS` and `DISTRICT_ACTION_CHOICES`, imported from `lib/ai/decide.ts`. The eval never copies prompt text.
  - `action_only` uses the same imported instructions and choices, but asks only `next_action`.
  - `minimal` sends a one-line instruction and bare choice labels with the same snapshot.
  - `product_v1` is **historical**. It is a frozen copy of the pre-fix `next_action` prompt (before commit a1699a5) inside the current question set. It is kept only so the v1 to v2 change can be re-measured.
  - `policy` is an explicit-criteria candidate. It was measured in the first run and became the basis of v2.
- **Models.** `gpt-6-luna`. The default run uses `product`, `action_only`, `minimal` and `product_v1`. Other models can be passed with `--configs model:variant`, but with the project key only `gpt-6-luna` is enabled on `/v1/decisions`.
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

## Results (measured, `gpt-6-luna`)

Only `gpt-6-luna` is enabled on `/v1/decisions` for the project key. `gpt-6-sol`, `gpt-6.1-sol`, `gpt-5.5` and `gpt-5.4-mini` all return `404 model_not_found`. So the runs compare prompts on one model, against the deterministic rules. Each run is a separate file, and `/evals` shows the newest one by `startedAt`.

### Prompt history

| Version | Commit | Accuracy (50) | Unambiguous (40) | Transfer picks (wrong) | Misses |
| --- | --- | --- | --- | --- | --- |
| v1 | d041df4 | 64.0% (32) | 55.0% (22) | 35 (17) | R01-R04, S01-S06, V03, V05, E04, E06, E07, Z01, U01, U03 |
| v2 | a1699a5 | 94.0% (47) | 92.5% (37) | 18 (2) | V05, E04, U03 |

The cases expect 17 transfers. v1 recommended a transfer whenever a donor had any surplus, which accounts for 17 of its 18 misses (E04 went to indent). v2 states the checks in order and allows a transfer only when one verified donor covers the gap, or at least 75% of it. This fixed all ten too-small-surplus and reserve-blocked cases, and V03, E06, E07, Z01 and U01.

### Latest run, `results-2026-10-10-v2.json`

| System | Accuracy | Unambiguous | Strict | Macro F1 | ECE | Brier | p50 / p95 | Tokens / call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6-luna, product (v2) | 94.0% (47) | 92.5% (37) | 84.0% | 0.88 | 0.112 | 0.113 | 169 / 1255 ms | 1666 |
| gpt-6-luna, action only (v2) | 94.0% (47) | 92.5% (37) | 84.0% | 0.88 | 0.112 | 0.113 | 177 / 232 ms | 837 |
| gpt-6-luna, minimal prompt | 62.0% (31) | 52.5% (21) | 56.0% | 0.51 | 0.107 | 0.595 | 190 / 434 ms | 550 |
| gpt-6-luna, product v1 (historical) | 64.0% (32) | 55.0% (22) | 58.0% | 0.57 | 0.117 | 0.581 | 218 / 361 ms | 1528 |
| Rules (`fallbackDecision`) | 100.0% (50) | 100.0% (40) | 94.0% | 0.96 | n/a (fixed templates) | n/a | <1 ms | 0 |

Notes:
- **v1 reproduced exactly.** The re-measured `product_v1` made the same choice as the first run on all 50 cases (64.0%, 32/50).
- **v2 confidence is better aligned.** Mean confidence rose from 69.2% (v1) to 82.8% (v2), against 94% accuracy, and ECE is 0.112. v2 has one high-confidence error.
- **The extra product questions still don't change the action.** `product` and `action_only` chose identical actions on all 50 cases. The extra questions cost 2.0 times the input tokens.
- **The v2 product p95 of 1255 ms comes from four slow calls (S02, A07, A08, A09, 0.6-1.3 s).** p50 is 169 ms.
- **Caveat.** The v2 criteria mirror the labeling policy, and so do the rules. The rules now score 100% after commit 5c176be added the unverified-donor and trend checks. The model has not been right on any case where the rules were wrong. Its three remaining misses are V05, E04 and U03.
- **The first run's baseline is out of date.** That run (`results-2026-10-10.json`) recorded the rules at 98.0%, before 5c176be. It also includes the `policy` candidate at 94.0%.
