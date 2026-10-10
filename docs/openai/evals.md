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
| `policy` (Explicit criteria) | The product choices, with the decision criteria spelled out as ordered checks. A candidate prompt. It mirrors the labeling policy. |

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

All numbers below are measured. They come from the committed run [`data/evals/results-2026-10-10.json`](../../data/evals/results-2026-10-10.json) (run `eval-20261010070726`, 200 live calls). The method and full discussion are in [`data/evals/README.md`](../../data/evals/README.md).

Only `gpt-6-luna` is enabled on `/v1/decisions` for the project key. The other models returned `404 model_not_found`. So this run compares **prompt variants on one model**, against the rules baseline.

| System | Accuracy (50) | Unambiguous (40) | Strict | Macro F1 | ECE | Brier | Latency p50 / p95 | Tokens per call |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-6-luna`, product call | 64.0% | 55.0% | 58.0% | 0.57 | 0.117 | 0.581 | 151 / 266 ms | 1528 |
| `gpt-6-luna`, action only | 64.0% | 55.0% | 58.0% | 0.57 | 0.124 | 0.580 | 149 / 269 ms | 699 |
| `gpt-6-luna`, minimal prompt | 62.0% | 52.5% | 56.0% | 0.51 | 0.107 | 0.595 | 148 / 222 ms | 550 |
| `gpt-6-luna`, explicit criteria | **94.0%** | **92.5%** | 82.0% | 0.87 | 0.257 | 0.158 | 148 / 219 ms | 748 |
| Rules (`fallbackDecision`) at run time | 98.0% | 97.5% | 94.0% | 0.95 | n/a | n/a | under 1 ms | 0 |

### What the evals found

This is the point of evals. The harness caught a real failure mode before any officer saw it, and it measured a fix.

- **The product prompt over-recommends transfers.** It chose `transfer_surplus` on 35 of 50 cases, including cases where the donor surplus is real but too small to close the gap. Some of these wrong transfers had confidence of 0.75 or more.
- **Stated criteria fix most of it.** The explicit criteria variant lists the checks in order (verify, then a full-cover transfer, then escalate, else indent). It raises accuracy from 64% to 94% on the same model and the same snapshots. This variant mirrors the labeling policy, so it shows that the model follows stated criteria well. It is not proof of independent judgment.
- **The extra questions do not change the action.** The product call and the action-only call chose the same `next_action` on every case. The extra questions (urgency, recount, indent timing, donor) cost about 2.2 times the input tokens. They add signals for the officer, not accuracy for the action.
- **Latency is low.** The median call took about 150 ms.
- **Calibration.** The product prompt's ECE is 0.117. The explicit criteria variant is underconfident: its mean confidence is 68% against 94% accuracy (ECE 0.257).
- **The rules win on this set, as expected.** The rules and the labels encode the same written policy. No case was right for the model and wrong for the rules.

### The rules baseline changed

On the first pass, the rules scored 90% (45 of 50). They moved stock from donors with unverified counts (Z01, U01, U02, U03), and they missed a daily-use figure that contradicted the weekly trend (V05). The team then fixed `fallbackDecision` to ignore unverified or flagged donors and to verify when daily use contradicts the trend. The run above records 98%. Re-measured on the current code, the rules choose an acceptable action on all 50 cases (96% strict). Because the rules were tuned on this set, the rules baseline is not an independent benchmark.

### The fix in the product

After this run, the product prompt changed (commit `a1699a5`):

- `next_action` now states the criteria as ordered checks: verify, then transfer, then escalate, else indent. See [Prompt and choice design](prompt-design.md).
- A transfer qualifies only when one verified donor covers the gap, or at least 75% of it.
- The `transfer_surplus` choice description says the same thing.
- The fallback rules use the same 75% threshold.

The table above was measured **before** this change. The `product` row is the old prompt.

### Re-measured: the shipped prompt (v2)

After the fix, we ran the full set again with the new product prompt (run file [`data/evals/results-2026-10-10-v2.json`](../../data/evals/results-2026-10-10-v2.json)). The eval now imports `NEXT_ACTION_INSTRUCTIONS` and `DISTRICT_ACTION_CHOICES` from [`lib/ai/decide.ts`](../../lib/ai/decide.ts), so it measures the exact text the product sends. The old prompt stays in the run as a frozen `product_v1` variant.

| System | Accuracy (50) | Unambiguous (40) | Strict | Macro F1 | ECE | Brier | Latency p50 / p95 | Tokens per call |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-6-luna`, product **v2** (shipped) | **94.0%** | **92.5%** | 84.0% | 0.88 | 0.112 | 0.113 | 169 / 1255 ms | 1666 |
| `gpt-6-luna`, action only (v2) | 94.0% | 92.5% | 84.0% | 0.88 | 0.112 | 0.113 | 177 / 232 ms | 837 |
| `gpt-6-luna`, minimal prompt | 62.0% | 52.5% | 56.0% | 0.51 | 0.107 | 0.595 | 190 / 434 ms | 550 |
| `gpt-6-luna`, product v1 (historical) | 64.0% | 55.0% | 58.0% | 0.57 | 0.117 | 0.581 | 218 / 361 ms | 1528 |
| Rules (`fallbackDecision`), current code | 100.0% | 100.0% | 94.0% | 0.96 | n/a | n/a | under 1 ms | 0 |

| Version | Accuracy (50) | Transfer picks (wrong) | Misses |
| --- | ---: | ---: | --- |
| v1 | 64.0% | 35 (17) | 18 cases |
| v2 | 94.0% | 18 (2) | V05, E04, U03 |

- **The fix worked on the shipped prompt.** v2 fixed all ten cases where the donor surplus was too small or blocked by the donor's reserve, and five more.
- **v1 reproduced exactly.** The frozen v1 prompt made the same choice as the first run on all 50 cases.
- **Confidence is better aligned.** Mean confidence rose from 69.2% to 82.8%, against 94% accuracy. v2 has one high-confidence error (V05 at 0.82).
- **The extra questions still do not change the action.** They feed the officer's signals (urgency, recount, donor) and cost about 2 times the input tokens.
- **The p95 of 1255 ms comes from four slow calls.** The median is 169 ms.

The `/evals` page shows both runs and a **Prompt history** section.

### Caveats

- The ordered criteria mirror the labeling policy. A high score shows that the model follows stated criteria. It is not proof of independent judgment.
- The rules baseline (100% on the current code) encodes the same policy, so it is a consistency check, not a competitor. The model has not been right on any case where the rules were wrong.
- The next step is a held-out case set that was not used to tune the prompt or the rules, with mixed-signal cases that no single rule covers. That is where model judgment can add value.

## Tests

[`tests/evals/metrics.test.ts`](../../tests/evals/metrics.test.ts) checks the metric math with known inputs. [`tests/evals/cases-and-runner.test.ts`](../../tests/evals/cases-and-runner.test.ts) checks the case set and the runner with a mocked `fetch`, so the tests need no API key.
