# Stock calculations

All stock numbers in Dawai Dost come from deterministic code. The AI models never calculate or change them. This makes every number easy to check by hand.

Source: [`lib/scenario.ts`](../../lib/scenario.ts)

## Formulas

### Days of stock

```text
days of stock = stock on shelf / daily use
```

If daily use is zero, days of stock is infinite. The clinic is not at risk.

### Safe surplus

```text
transferable = max(0, floor(stock − daily use × reserve days))
reserve days = 7
```

A donor clinic always keeps seven days of its own use. Only the amount above that reserve can move. The result is rounded down to whole strips and is never negative.

### Planning threshold

```text
threshold = resupply lead time + safety buffer = 5 + 3 = 8 days
```

A clinic with fewer days of stock than the threshold is at risk. A new delivery cannot arrive before the shelf is empty.

## Worked example

| PHC | Stock | Daily use | Days of stock | Below 8-day threshold? | Safe surplus |
| --- | ---: | ---: | ---: | --- | ---: |
| Saraswati | 16 | 8 | 16 / 8 = **2.0** | Yes | 0 |
| Kalyanpur | 80 | 5 | 80 / 5 = **16.0** | No | 80 − 5 × 7 = **45** |
| Rampur | 9 | 6 | 9 / 6 = **1.5** | Yes | 9 − 42 < 0 → **0** |

Saraswati needs 8 days × 8 strips = 64 strips to reach the threshold. It has 16. The gap is 48 strips.

Kalyanpur can safely give 45 strips. The demo proposes a transfer of 24 strips, which gives Saraswati three more days of cover (16 + 24 = 40 strips, 5 days). This covers the 5-day lead time while a district indent arrives. Kalyanpur keeps 56 strips, more than 11 days of its own use.

Rampur is also at risk, with no surplus of its own. Its alert is the next case in the queue. After the Saraswati transfer, Kalyanpur still has 21 strips of safe surplus. If that is not enough for Rampur, the correct action is `draft_indent` or `escalate_supply_gap`.

## Why deterministic

| Reason | Explanation |
| --- | --- |
| **Exact** | Arithmetic in code is always correct. |
| **Auditable** | An officer or auditor can check each number with a calculator. |
| **Safe** | The reserve rule is enforced in code. A model cannot move a donor below seven days. |
| **Testable** | Each rule has a unit test. |

The Decisions API receives the results of these calculations. It uses them to make a judgment. It does not repeat them.

## Future calculations

- Consumption from the average of recent weekly reports, not a fixed value
- Lead time per medicine from warehouse dispatch history
- Expiry-aware surplus: move stock that will expire before the donor can use it
- Distance and transport cost between clinics
