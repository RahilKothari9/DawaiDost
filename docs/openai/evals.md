# Decision evals

A recommendation engine for public health must show that it picks the right action. Dawai Dost has a labeled evaluation set for the Decisions API. It measures accuracy, calibration, latency, and token use, and it compares the model with the deterministic rules that the product uses as a fallback.

Source: [`lib/evals/cases.ts`](../../lib/evals/cases.ts), [`lib/evals/run.ts`](../../lib/evals/run.ts), [`lib/evals/metrics.ts`](../../lib/evals/metrics.ts), [`lib/evals/report.ts`](../../lib/evals/report.ts), [`scripts/evals/run.ts`](../../scripts/evals/run.ts)

## The case set

The set has **50 synthetic cases**. Each case is a facts-only snapshot in the exact shape the product sends to `/api/decisions/district`. All facilities and numbers are fictional.

| Category | Cases | What it tests |
| --- | ---: | --- |
| Clear transfer | 8 | A verified donor covers the full gap |
| Blocked by donor reserve | 5 | The donor has stock, but none above its reserve |
| Surplus too small | 6 | Local surplus cannot cover the gap |
| Suspicious count | 8 | The target's count is unverified, flagged, stale, or against its trend |
| District-wide shortage | 9 | Upstream supply is delayed or unavailable, or the warehouse is short |
| Near-expiry donor | 4 | A donor holds stock that will expire before it can use it |
| Zero consumption | 3 | The record has no recorded use |
| Unverified donor | 3 | The only surplus is at a donor with an unverified count |
| Partial cover | 4 | One donor covers part of the gap |

Each case has one expected action. 10 cases are marked **ambiguous**: two rules reasonably compete, and the case lists the other actions a reasonable officer would accept.

## The labeling policy

The labels follow a written policy. The rules apply in order. The model never sees this text. It is the answer key.

| Rule | Label |
| --- | --- |
| P1 Data first | Count unverified, flagged, stale, under recount, or against its own trend → `verify_count` |
| P2 Transfer | A verified donor covers the full gap → `transfer_surplus`. Near-expiry donor stock is preferred. |
| P3 | Unverified donors do not count as surplus |
| P4 Escalate | Local surplus cannot cover the gap, and upstream is delayed or unavailable, or the district store holds less than one lead time → `escalate_supply_gap` |
| P5 Indent | Local surplus cannot cover the gap and upstream is normal → `draft_indent` |

## Prompt variants

The runner can send each case in three ways. This shows how much the product's question design adds.

| Variant | What is sent |
| --- | --- |
| `product` | Exactly what `/api/decisions/district` sends: `next_action` plus the urgency, recount, indent-timing, and donor questions in one call |
| `action_only` | The product instructions and choice descriptions, but `next_action` is the only question |
| `minimal` | A one-line instruction ("Choose the next action for the target facility.") and bare choice labels, with the same snapshot |

## Baseline

The runner also grades the product's deterministic fallback (`fallbackDecision()` in [`lib/ai/decide.ts`](../../lib/ai/decide.ts)) on the same cases. This answers a direct question: does the Decisions API do better than the rules the product falls back to?

## Metrics

| Metric | Meaning |
| --- | --- |
| Accuracy | Choice equals the expected action, or an accepted alternative on ambiguous cases |
| Strict accuracy | Choice equals the expected action |
| Unambiguous and ambiguous accuracy | Accuracy on each subset |
| Per-action precision, recall, F1, and macro F1 | Quality for each of the four actions |
| Confusion matrix | Expected action against chosen action |
| Expected calibration error (ECE) and reliability bins | Whether a 0.8 confidence is right about 80% of the time |
| Brier score | Probability error against the expected label (0 is perfect, 2 is worst) |
| High-confidence errors | Wrong answers with high confidence, listed by case |
| Latency mean, p50, p95 | Response time per call |
| Tokens per case | Input and output tokens. Cost is shown only when a price is set in `PRICING`; all prices are empty in the repository. |
| Accuracy by category | Where the model is strong or weak |

## How to run

The command-line runner calls the live Decisions API and writes a results file. It needs `OPENAI_API_KEY` in `.env.local`.

```powershell
node --env-file=.env.local --experimental-transform-types --no-warnings --import ./scripts/evals/register.mjs scripts/evals/run.ts
```

Options:

| Option | Default |
| --- | --- |
| `--configs` | `gpt-6-luna:product,gpt-6-luna:action_only,gpt-6-luna:minimal,gpt-5.4-mini:product,gpt-6-sol:product` |
| `--cases` | All 50 cases, or a list such as `T01,V01` |
| `--concurrency` | 4 |
| `--out` | `data/evals/results-YYYY-MM-DD.json` |

The runner probes one call first. If the key fails, it stops and writes nothing. It retries rate-limit and server errors up to 4 times with backoff, and has a 45-second timeout per call. It never prints the API key.

The results file (`dawai-dost/evals@1`) stores each case, its snapshot, the exact instructions sent for each configuration, every result, and the baseline. Anyone can recompute the metrics from the file.

A smaller balanced subset of 10 cases (`T01`, `N01`, `R01`, `S02`, `V01`, `V05`, `E01`, `E04`, `U01`, `A01`) is defined for a live run during the demo.

## Results

No live results file is committed yet. We will publish the numbers here only after a real run. We do not report accuracy that we have not measured.

## Tests

[`tests/evals/metrics.test.ts`](../../tests/evals/metrics.test.ts) checks the metric math with known inputs. [`tests/evals/cases-and-runner.test.ts`](../../tests/evals/cases-and-runner.test.ts) checks the case set and the runner with a mocked `fetch`, so the tests need no API key.
