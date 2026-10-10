# Testing

Dawai Dost uses Vitest. The tests check the stock rules and the Decisions API route. All OpenAI calls are mocked, so the tests run without an API key and at no cost.

## Run the checks

```powershell
npm test
npm run lint
npm run build
```

## What the tests check

### Stock engine: [`tests/scenario.test.ts`](../../tests/scenario.test.ts)

| Test | Rule |
| --- | --- |
| Calculates stock cover from count and daily use | `days of stock = stock / daily use` |
| Preserves the donor reserve when calculating transferable stock | A donor keeps seven days of use |
| Returns no finite stock cover when consumption is zero | Zero use is not a risk |
| Includes a verified target count and nearby clinic evidence | The decision snapshot contains all facts the model needs |
| Selects a transfer when a nearby donor has surplus | Fallback logic chooses `transfer_surplus` |
| Recommends an indent fallback when no donor can spare stock | Fallback logic chooses `draft_indent` |

### Decisions route: [`tests/decisions-route.test.ts`](../../tests/decisions-route.test.ts)

| Test | Behavior |
| --- | --- |
| Returns a labeled demo result when credentials are not configured | `source: demo_fallback`, `fallbackReason: missing_api_key` |
| Maps a live Decisions API choice and its option probabilities | A live answer becomes the dashboard shape with all four probabilities |
| Rejects malformed requests | HTTP 400 for invalid input |
| Falls back transparently when the upstream API rejects the request | `fallbackReason: upstream_unavailable` |

## Test strategy

- **Deterministic rules have exact tests.** Each formula has a test with known numbers.
- **The model boundary is tested by contract.** The tests mock the Decisions API response and check that the route maps, validates, and falls back correctly.
- **Every fallback path is visible.** The tests check that the `source` and `fallbackReason` fields are set, so fallback data cannot appear as live data.

## Next tests

- Decision quality evaluation: a set of labeled stock scenarios with the expected action, run against the live Decisions API to measure agreement
- Realtime session route tests with a mocked client-secret response
- Browser tests for the call, decision, and approval flow
