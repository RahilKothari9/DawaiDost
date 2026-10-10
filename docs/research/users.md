# Users

Dawai Dost is designed around the people who already manage medicine in the district. Each user has one simple task.

## District health officer (primary user)

**Role.** Responsible for medicine availability across the PHCs in the district. Approves transfers, indents, and escalations.

**Current problem.** The officer receives stock information late, in different formats, or not at all. Shortages are often found after patients complain.

**What Dawai Dost gives the officer.**

- One screen with the clinics that need attention now
- The evidence for each alert: verified count, daily use, days of stock, and nearby surplus
- One recommended action from the Decisions API, with probabilities
- One-click approval and an accountability timeline

**Time needed.** A few minutes each week.

## PHC pharmacist (reporting user)

**Role.** Manages the medicine store at a PHC. Dispenses medicine and sends indents to the district.

**Current problem.** Reporting takes time away from patients. Forms and registers are slow. Indents are often based on estimates.

**What Dawai Dost gives the pharmacist.**

- A short phone call in Hindi each week
- No app, form, or smartphone
- A follow-up question only when a count looks wrong
- Faster resupply when the clinic runs low

**Time needed.** Less than one minute each week.

## Future users

**ASHA workers.** Accredited Social Health Activists visit patients in villages. They can ask by voice if a medicine is in stock at the PHC before they refer a patient.

**Patients.** A patient can call a number and ask if their medicine is available before travelling to the clinic.

**State officials.** A state can see the pattern of escalations across districts and use it in procurement planning.

## Design principles from our users

1. **No forms for the pharmacist.** Voice is the only input.
2. **No tables for the officer.** Show decisions, not raw data.
3. **The officer decides.** AI recommends; a person approves.
4. **Show the evidence.** Every recommendation shows the numbers behind it.
5. **Keep a record.** Every report, alert, and approval has a time and an owner.
