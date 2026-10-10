# Stock calculations

All stock numbers in Dawai Dost come from deterministic code. The AI models never calculate or change them. You can check every number by hand.

Source: [`lib/district/engine.ts`](../../lib/district/engine.ts). The original single-scenario rules are in [`lib/scenario.ts`](../../lib/scenario.ts) and use the same formulas.

## Inputs

Each medicine has four planning values. Each stock record holds the shelf count and the daily use for one facility and one medicine.

| Value | Where | Example (Metformin 500 mg) |
| --- | --- | ---: |
| `leadTimeDays` | Medicine | 5 |
| `safetyBufferDays` | Medicine | 3 |
| `reserveDays` | Medicine | 7 |
| `stock` | Stock record | 16 strips |
| `dailyUse` | Stock record | 8 strips per day |

## Formulas

### Days of stock

```text
days of stock = stock / daily use
```

If daily use is zero, days of stock is infinite. The record is not at risk.

### Threshold

```text
threshold = lead time + safety buffer
```

For Metformin, the threshold is 5 + 3 = 8 days. A clinic below the threshold cannot wait for a normal resupply.

### Safe surplus

```text
transferable = max(0, floor(stock − daily use × reserve days))
```

A donor clinic always keeps `reserveDays` of its own use. Only the amount above that reserve can move. When the donor already has open outbound transfers, the planner subtracts them first.

### Gap

```text
gap units = max(0, ceil(threshold × daily use − stock))
```

The gap is the number of units the clinic needs to reach the threshold.

### Risk level

`assessStock()` gives each record one of five levels. The first rule that matches wins.

| Level | Rule |
| --- | --- |
| `stockout` | Stock is 0 and daily use is above 0 |
| `critical` | Days of stock < lead time |
| `low` | Days of stock < threshold |
| `surplus` | Days of stock ≥ threshold + reserve days, and transferable > 0 |
| `ok` | All other records |

`stockout`, `critical`, and `low` are "at risk". The engine also gives a projected stockout date: today plus the days of stock.

## Worked example

These are the three hero clinics of the demo. All data is synthetic.

| PHC | Stock | Daily use | Days of stock | Risk | Safe surplus | Gap |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Saraswati | 16 | 8 | 16 / 8 = **2.0** | `critical` (2 < 5) | 0 | 8 × 8 − 16 = **48** |
| Kalyanpur | 80 | 5 | 80 / 5 = **16.0** | `surplus` (16 ≥ 8 + 7) | 80 − 5 × 7 = **45** | 0 |
| Rampur | 9 | 6 | 9 / 6 = **1.5** | `critical` (1.5 < 5) | 0 | 8 × 6 − 9 = **39** |

Kalyanpur is the only eligible donor for Metformin near these clinics. The transfer planner (below) splits its 45 safe strips:

| From | To | Strips | Distance | ETA |
| --- | --- | ---: | ---: | ---: |
| Kalyanpur PHC | Rampur PHC | 21 | 13.7 km | 1.6 h |
| Kalyanpur PHC | Saraswati PHC | 24 | 14.1 km | 1.6 h |

Each transfer brings the clinic to its 5-day lead time. Saraswati goes from 16 to 40 strips (5 days). Rampur goes from 9 to 30 strips (5 days). Kalyanpur keeps 35 strips, exactly its 7-day reserve. No clinic reaches the full 8-day threshold from local stock, so a district indent is still necessary.

## Count check

`detectAnomaly()` compares each new count with the weekly ledger.

```text
expected = last week's closing stock + units received this week − daily use × days since the week began
tolerance = max(3, daily use × 3.5, expected × 0.25)
```

| Result | Rule |
| --- | --- |
| `unexplained_increase` | Count − expected > tolerance |
| `unexplained_drop` | Expected − count > 1.5 × tolerance |
| `stale_report` | No report for more than 8 days |
| Not flagged | All other counts |

A flagged count is not verified. The store requests a recount. The record cannot act as a donor or receive a planned transfer until a new count passes the check. A voice report with extraction confidence below 0.6 also triggers a recount.

Example from the seed data: Hirapur PHC reports 168 strips of Telmisartan. The ledger expects about 30. The check flags an unexplained increase.

## Donor ranking

`donorCandidates()` lists every facility that holds the medicine within 80 km. The district warehouse is not a donor. A donor is **eligible** only when all of these are true:

- its risk level is `surplus`
- its count is verified
- its count check is not flagged
- no recount is open
- it has transferable stock after open outbound transfers

Eligible donors come first. Then the list sorts by effective distance. A donor that holds near-expiry stock it cannot use in time counts as half as far. This moves stock that would otherwise expire (first-expiry, first-out).

Seed example: Anandpur PHC holds 150 strips of Amoxicillin that expire on 2026-10-28. The ranking prefers Anandpur over the nearer CHC Ashta.

## Transfer planner

`planTransfers()` makes reserve-safe transfer proposals for one medicine. It is greedy and has two passes:

1. **Bridge to lead time.** For each at-risk clinic, most urgent first, fill the gap up to the lead time.
2. **Top up to the threshold.** With the surplus that remains, fill each clinic up to lead time plus buffer.

The planner skips clinics with an open recount or a flagged count. It never takes a donor below its reserve. Each proposal has status `proposed`, a distance, an ETA, and a short reason.

## Transport time

```text
ETA hours = straight-line km × 1.3 (road factor) / 30 km/h + 1 hour handling
```

An approved transfer leaves 2 hours after approval. These values are planning estimates, not measured road times.

## Indent quantity

```text
indent = ceil(daily use × (30 + threshold) − stock − inbound units)
```

The indent covers one month of use plus the lead time and the buffer. It subtracts the stock on the shelf and any open inbound transfers.

## Stockout-days averted

```text
averted days = min(transfer quantity / receiver daily use, lead time)
```

The KPI strip adds this value for each approved, in-transit, or delivered transfer. The cap at the lead time stops a large transfer from claiming more days than a normal resupply would cover. This is a model estimate on synthetic data. It is not a measured outcome.

## Why deterministic

| Reason | Explanation |
| --- | --- |
| **Exact** | Arithmetic in code is always correct. |
| **Auditable** | An officer or auditor can check each number with a calculator. |
| **Safe** | The reserve rule is enforced in code. A model cannot move a donor below its reserve. |
| **Testable** | Each rule can have a unit test with known numbers. |

The Decisions API receives the results of these calculations in the decision snapshot. It uses them to make a judgment. It does not repeat them.

## Future calculations

- Lead time per medicine from warehouse dispatch history
- Road distance and transport cost from a routing service
- Seasonal demand, for example ORS in the monsoon
