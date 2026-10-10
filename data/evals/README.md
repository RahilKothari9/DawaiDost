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
- **Models.** The default run uses `gpt-6-luna` with all three variants, plus `gpt-5.4-mini` and `gpt-6-sol` with the product variant.
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

## Status

The deterministic baseline was measured from code: it got 45 of 50 cases acceptable (90%) and 35 of 40 unambiguous cases (87.5%). It missed V05 (recorded daily use contradicts the weekly trend) and four cases where only an unverified donor has surplus (Z01, U01, U02, U03). The rules move stock from these unverified donors.

A Decisions API run has not been committed yet. Every attempt on 2026-10-10 returned `HTTP 429 credit_balance_exhausted` for the project key. No model numbers have been estimated or filled in. Run the command above after the key has credit.
