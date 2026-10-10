# Decision evals

A recommendation engine for public health must show that it picks the right action. Dawai Dost has a labeled evaluation set for the Decisions API. It measures accuracy, calibration, latency, and token use, and it compares the model with the deterministic rules that the product uses as a fallback.

Page: **Decision evals** (`/evals`). Source: [`app/evals/page.tsx`](../../app/evals/page.tsx), [`app/api/evals/run/route.ts`](../../app/api/evals/run/route.ts), [`lib/evals/cases.ts`](../../lib/evals/cases.ts), [`lib/evals/run.ts`](../../lib/evals/run.ts), [`lib/evals/metrics.ts`](../../lib/evals/metrics.ts), [`lib/evals/report.ts`](../../lib/evals/report.ts), [`scripts/evals/run.ts`](../../scripts/evals/run.ts)

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

## The /evals page

The **Decision evals** page asks one question: "Does the model pick the right action?" It reads the newest `data/evals/results-*.json` file and shows:

- headline accuracy on unambiguous cases, the rules baseline, calibration error (ECE), and latency p50 / p95
- **Models and prompts**: accuracy, strict accuracy, macro F1, Brier score, tokens per call, cost, and failures for each model and prompt variant, next to the deterministic fallback
- a **Confusion matrix** and a **Reliability** diagram
- **Where model judgment differs from the rules**: cases the model got right and the rules got wrong, and the reverse
- a case explorer with each case's expected action, the rules baseline, the Decisions API probabilities, the rules that fired, and the exact snapshot sent

When no results file exists, the page says "No committed Decisions API results yet." and shows the rules baseline only.

### Run it live

The **Run it live** panel streams a fresh run from the browser. The button **Run 10 cases live** calls `POST /api/evals/run`, which sends the 10-case subset to the live Decisions API with a concurrency of 4 and streams each result as NDJSON, next to the rules baseline for the same case. The officer can pick the model (`gpt-6-luna`, `gpt-6-sol`, `gpt-6.1-sol`, `gpt-5.5`, or `gpt-5.4-mini`) and the prompt variant. Without a key, the route says that a live run is not possible.

## How to run from the command line

The command-line runner calls the live Decisions API and writes a results file. It needs `OPENAI_API_KEY` in `.env.local`.

```powershell
node scripts/evals/run.mjs
```

The launcher runs [`scripts/evals/run.ts`](../../scripts/evals/run.ts) with Node's built-in TypeScript support and loads `.env.local`. It passes all options through.

Options:

| Option | Default |
| --- | --- |
| `--configs` | `gpt-6-luna:product,gpt-6-luna:action_only,gpt-6-luna:minimal,gpt-5.4-mini:product,gpt-6-sol:product` |
| `--cases` | All 50 cases, or a list such as `T01,V01` |
| `--concurrency` | 4 |
| `--out` | `data/evals/results-YYYY-MM-DD.json` |

The runner probes one call first. If the key fails, it stops and writes nothing. It retries rate-limit and server errors up to 4 times with backoff, and has a 45-second timeout per call. It never prints the API key.

The results file (`dawai-dost/evals@1`) stores each case, its snapshot, the exact instructions sent for each configuration, every result, and the baseline. Anyone can recompute the metrics from the file.

A smaller balanced subset of 10 cases (`T01`, `N01`, `R01`, `S02`, `V01`, `V05`, `E01`, `E04`, `U01`, `A01`) is used for the live run on the `/evals` page.

## Results

### Rules baseline (measured)

The deterministic fallback needs no API key, so we can measure it now. On the 50 cases, at the current commit:

| Metric | Value |
| --- | ---: |
| Accuracy (with accepted alternatives) | 90% (45 of 50) |
| Strict accuracy | 86% |
| Unambiguous cases | 87.5% (35 of 40) |
| Ambiguous cases | 100% (10 of 10) |
| Macro F1 | 0.88 |

The rules are perfect on clear transfers, reserve-blocked donors, small surplus, district shortages, near-expiry donors, and partial cover. They miss **all 3 unverified-donor cases**, 1 of 3 zero-consumption cases, and 1 of 8 suspicious-count cases. These are the cases where judgment across several signals matters most, and where the Decisions API must do better to justify its place.

The rules' probabilities are fixed templates, so calibration metrics for the baseline are not meaningful.

### Decisions API (live)

No live results file is committed yet. We will publish the numbers here only after a real run. We do not report accuracy that we have not measured.

## Tests

[`tests/evals/metrics.test.ts`](../../tests/evals/metrics.test.ts) checks the metric math with known inputs. [`tests/evals/cases-and-runner.test.ts`](../../tests/evals/cases-and-runner.test.ts) checks the case set and the runner with a mocked `fetch`, so the tests need no API key.
