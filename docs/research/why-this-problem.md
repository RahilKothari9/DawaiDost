# Why this problem

We chose this problem because it is large, it is well documented, and it is solvable now with OpenAI models. This document explains the selection.

## Selection criteria

| Criterion | How medicine stockouts meet it |
| --- | --- |
| **The problem is real and measured** | Multiple peer-reviewed studies document low availability and long stockouts in Indian public facilities. See [Problem landscape](problem-landscape.md). |
| **The solution has precedent** | SMS for Life, eVIN, and IHCI show that facility-level visibility reduces stockouts. See [Prior art](prior-art.md). |
| **The root cause is information** | Medicine often exists in the district. The missing part is knowing where it is and acting in time. |
| **AI adds a step change** | Voice AI removes the reporting form. Bounded AI decisions turn data into one clear action. |
| **The users and roles exist** | Every PHC has a pharmacist. Every district has a health officer responsible for medicine supply. |
| **It can start small** | One district, a few tracer medicines, and a weekly call. No new hardware. |

## Why it is an information problem

A stockout at one PHC and a surplus at another PHC can exist at the same time in the same district. Clinics use medicine at different rates. Supplies arrive in batches. Without shelf-level data, the district cannot see the imbalance.

When the district can see it, the fix is often simple: move 24 strips from one clinic to a nearby clinic. This fix needs no new money and no new procurement. It needs information at the right time and a person who can approve the move.

## Why AI is the right tool now

Earlier systems had two limits.

**Reporting was hard.** Typed SMS codes and app forms need training and attention. Response falls when staff are busy.

The OpenAI Realtime API changes this. A pharmacist can say "सोलह पत्ते बचे हैं" ("sixteen strips are left") in a normal phone call. The model understands, confirms, and asks a follow-up question when needed.

**Data did not become action.** A dashboard with 40 clinics and 20 medicines is a large table. An officer must find the risk and decide what to do.

The OpenAI Decisions API changes this. For each risk, it selects one action from the four that a district can take, with a probability for each. The officer receives a short list of clear decisions, not a table.

## Why it fits a hackathon and beyond

The core loop is small enough to build and demonstrate in a hackathon: one call, one forecast, one decision, one approval. The same loop is the complete product. To scale it, we add clinics, medicines, and languages. The architecture does not change.

## What success looks like

A pharmacist spends one minute each week on a phone call. A district officer spends a few minutes each week approving clear actions. Patients find their medicine on the shelf.
