# Impact and pilot design

The research shows that frequent facility-level stock visibility reduces stockouts. SMS for Life cut the share of facilities with an antimalarial gap from 78% to 26% in 21 weeks. eVIN partners report about 80% fewer vaccine stockouts. Dawai Dost brings the same approach to essential medicines at Indian PHCs. A pilot will measure its effect.

## Expected effects

| Effect | Mechanism |
| --- | --- |
| **Earlier warning** | A weekly verified count shows risk days before the shelf is empty. |
| **Faster response** | The officer receives one clear action, not a table to analyse. |
| **Better use of existing stock** | Surplus at one clinic covers a gap at another clinic. |
| **Better indents** | Indents use real consumption, not estimates. |
| **Clear escalation** | District-wide gaps reach the state earlier, with evidence. |
| **Accountability** | Every report, decision, and approval has a time and an owner. |

## Pilot design

**Setting.** One district, a group of PHCs, and a short list of tracer medicines.

**Design.** Compare a baseline period with an intervention period at the same facilities and for the same medicines.

**Partners.** The district health office, PHC pharmacists, and the district drug warehouse.

## Metrics

### Reporting

- Weekly report completion rate
- Time from the call to a confirmed count
- Share of counts corrected after a recount question

### Response

- Days of warning before a projected stockout
- Time from alert to officer approval
- Transfers proposed, approved, completed, and rejected
- Agreement between the Decisions API recommendation and the officer's final action

### Outcome

- Stockout-days per tracer medicine per facility
- Share of patient visits where a prescribed tracer medicine was not available
- Medicine lost to expiry

### Context

Procurement delays and district-wide shortages are recorded separately. They show where the response needs action above the district level.

## Cost

Each clinic needs one short call each week. Each alert needs one Decisions API call. Most clinic-medicine pairs are above the threshold in a normal week, so the number of decisions stays small. The cost per clinic is low compared with the cost of one patient's private-pharmacy purchase or a missed month of treatment.

## Success criteria

- Pharmacists complete most weekly calls.
- Officers act on most alerts within a working day.
- Stockout-days for tracer medicines fall compared with the baseline.
