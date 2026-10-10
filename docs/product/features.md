# Features

Dawai Dost has one view for each job in the district medicine loop. The officer views share a navigation rail with four groups: **Operate**, **Analyse**, **Record**, and **Other surfaces**. Two surfaces, the pharmacist app and the public Find medicine page, have their own full-page layout but share the same district state.

> All facility data in the app is synthetic. The block names are real blocks of Sehore district, Madhya Pradesh. The facilities, people, and stock counts are fictional.

## Shared across views

| Feature | What it does |
| --- | --- |
| **Simulated clock** | The top bar shows the district time (IST). Buttons advance it 6 hours or one day, or play it forward continuously. Stock is consumed, transfers move, and new alerts appear. |
| **Live or demo label** | The top bar shows whether a live OpenAI key is configured. Every AI result also carries its own `live` or `demo_fallback` label. |
| **Command palette** | Press Ctrl+K (⌘K on a Mac) to jump to any view, facility, or medicine, or to run an action such as "Start a voice check-in" or "Advance the clock 6 hours". |
| **Toasts** | New timeline events, such as an approval or a delivery, appear as short notices. |
| **Synthetic data notice** | A persistent notice states that the data is a fictional demo district. |

---

## Operate

### Command center (`/`)

**What it shows.** One live number: how many clinics run out before resupply, "of 22 clinics in Sehore district". The number changes as the clock moves and transfers land. Below it: the KPI strip, the hero story card, a compact district map, the **AI inbox** (pending Decisions API recommendations), and **Live activity**.

The **story card** runs the full loop for the most urgent clinic in five steps: **Voice check** (Realtime API), **Forecast** (deterministic code), **Decide** (OpenAI Decisions API), **Approve** (district officer), and **Deliver** (the transfer). The officer can start with **Run voice check + Decisions API** or **Use today's count**. After approval, **Dispatch transfer**, **Advance 6 hours**, and **Mark delivered** finish the story, and **Open the record** shows the audit trail.

**Who uses it.** The district health officer, first thing each day.

**Why it matters.** The officer sees the few clinics that need action today, not a table of 230 records. The whole loop, from voice report to delivered medicine, fits on one screen.

### Decisions (`/decisions`)

**What it shows.** The header "Four moves. One choice. Your call." The four actions with a share bar for each. A short explanation of what the probabilities mean. The decision queue and the decision card.

The **decision queue** lists every recommendation, with filters for **Needs action** and **Resolved**. The button **Run Decisions API on all** sends every at-risk record to `/api/decisions/batch` (up to 80) and fills the queue live, with a progress bar. Each row has a quick action: **Approve transfer**, **Request recount**, **Draft indent**, or **Escalate**, plus **Reject** and **Acknowledge**.

The **decision card** shows one recommendation in full:

- the evidence: stock, daily use, days of stock, lead time plus buffer, gap to threshold, inbound, safe surplus, count check, upstream status, district store
- the four action probabilities, with a warning when the top two are within 15 points
- **Signals from the same call**: urgency, **Recount needed**, **Indent arrives in time**, **Transfer bridges gap**, and the chosen donor
- **Why**: a bilingual explanation from the Responses API, with an English and Hindi switch
- **What if**: re-ask the Decisions API with one fact changed (for example "Best donor unavailable"). Nothing is saved.
- a **Rules fallback** label and the rule trace when no live answer is available

**Who uses it.** The district health officer.

**Why it matters.** This is where the OpenAI Decisions API meets an accountable human. The officer sees what the model chose, how sure it is, and why, and the officer makes the call.

### District map (`/map`)

**What it shows.** Every facility in the district, coloured by risk for the selected medicine. Selecting a clinic opens a drawer with its shelf, its forecast, and what the Decisions API recommended. The map draws transfer arcs between clinics. Medicine on the road moves along its arc as the simulated clock runs. Counters show stocked-out, critical, in-transit, and awaiting transfers. **Play week** runs a 7-day time-lapse of stock and transfers. The map uses MapLibre GL, with an offline SVG renderer when WebGL or the basemap is not available.

**Who uses it.** The district health officer and the district store team.

**Why it matters.** The map shows that the medicine is often already in the district, a few kilometres away.

### Transfers (`/transfers`)

**What it shows.** "Medicine that already exists in the district, moved to where it is needed." Transfers grouped by stage: **Drafted from a recommendation, waiting for you**, **Approved, waiting for a vehicle**, **On the road**, and **Received and counted**. Each transfer shows the donor, receiver, quantity, distance, and ETA. A district map sits beside the board. **Show on map** highlights one transfer's route.

**Who uses it.** The district health officer and the district store team.

**Why it matters.** A recommendation is only useful when the medicine arrives. The board tracks each transfer from proposal to delivery.

### Escalations (`/escalations`)

**What it shows.** "Gaps the district cannot close." Headline counts: **Medicines needing state supply**, **Facilities below required cover**, **Earliest district-wide stockout**, **Open escalations**. Then:

- **Supply-gap board**: all medicines, worst first, with district cover in days, need against surplus, the shortfall after local options, facilities and people affected, and the projected district stockout date
- a waterfall chart from facility shelves to the remaining gap
- **Escalation register**: each escalation moves through **Draft**, **Sent to state**, **Acknowledged**, **Supply scheduled**, and **Resolved**
- **Lead-time watch**: "Is supply arriving when planned?" Expected against observed lead time from the ledgers
- **Memo to the state**: a printable office memo with an evidence table, specific requests, and an annexure of facilities below required cover. The prose comes from the Responses API, and every number is checked against the computed facts.

**Who uses it.** The district health officer, when local action is not enough.

**Why it matters.** Dawai Dost does not pretend that a transfer fixes an upstream shortage. It makes the gap visible early and gives the officer an evidence-based memo for the state.

### Voice check-ins (`/voice`)

**What it shows.** "Each week the pharmacist answers one short call in Hindi. No form, no app." The voice console has three modes: **Simulated pharmacist**, **You are the pharmacist**, and **Availability line**. It shows a live transcript with an English gloss, each tool call, and the **Structured report → district store** panel. A **Call roster** lists who has reported and who is overdue, with **Run all due calls**.

**Who uses it.** The district team during the demo. In production, the pharmacist only hears a phone call.

**Why it matters.** Voice removes the reporting form, which is the main reason clinic reporting fails. See [Realtime API](../openai/realtime-api.md).

---

## Analyse

### Stock and forecast (`/stock`)

**What it shows.** A heatmap of days of stock for every clinic and medicine. Selecting a cell shows the projected shelf for the next weeks, with inbound transfers, and the weekly closing stock and dispensing history.

**Who uses it.** The district health officer and the district pharmacist.

**Why it matters.** Every number comes from code. The officer can check any forecast by hand.

### Briefing (`/briefing`)

**What it shows.** Three panels: **Morning briefing** ("Written from the ledger, never from memory"), **Ask the district** ("Answers cite the clinics and counts they used"), and **Indent draft**.

- **Write brief** asks the Responses API for a morning brief from a computed summary, in English and Hindi: a headline, bullets marked as risk, progress, or info, and **Do this morning** actions. The brief can be read aloud with `gpt-4o-mini-tts`; the browser voice is a labeled fallback. Without a key, the panel shows a **Template brief** from the same summary.
- **Ask the district** answers plain-language questions with function tools. Suggested questions include "Which PHCs run out of amlodipine this week?", "Where can Rampur get metformin?", and "What transfers are in transit right now?". The answer streams in, and each tool call appears as a chip.
- The indent draft is a printable requisition to the District Drug Store. Code computes every quantity; the model writes only the justification. The officer can **Approve indent** and **Mark submitted**.

**Who uses it.** The district health officer.

**Why it matters.** The officer gets a clear daily summary and can ask follow-up questions, without the model ever inventing a number.

### Decision evals (`/evals`)

**What it shows.** "Does the model pick the right action?" Results of the Decisions API on 50 labeled synthetic cases against the rules baseline: accuracy, calibration, a confusion matrix, a reliability diagram, and the cases where model and rules disagree. **Run 10 cases live** streams a fresh run. See [Decision evals](../openai/evals.md).

**Who uses it.** Judges, reviewers, and the team.

**Why it matters.** A public health tool must show its quality, not claim it.

---

## Record

### Activity log (`/activity`)

**What it shows.** "Every step has a time and an owner." Reports, count checks, recommendations, approvals, transfers, indents, and escalations, newest first. Filters for event type, actor (**Pharmacists**, **Decisions API**, **District officer**, **System and code**), facility, and medicine, and **Search the log**.

**Who uses it.** The officer, auditors, and the state.

**Why it matters.** Each Decisions API entry keeps the exact snapshot that was sent, so any recommendation can be audited later.

### How it works (`/about`)

**What it shows.** The loop, the four actions ("Four actions, and only four"), who is responsible for what, the OpenAI stack, fallbacks, scope, and the research behind the problem.

---

## Other surfaces

### Pharmacist app (`/pharmacist`)

**What it shows.** A Hindi-first phone app for the PHC pharmacist, shown in a phone frame. The demo can switch between facilities. The home screen lists today's tasks:

- **माल आ रहा है · ARRIVING**: count stock on arrival and confirm the receipt
- **भेजना है · SEND**: pack a transfer and hand it to the vehicle
- **दोबारा गिनें · RECOUNT**: "District asked for a recount", with **Enter count**
- **Call me now** (start the voice check-in) or **Type counts** on a keypad, with the same plausibility check that the voice agent uses

**Who uses it.** The PHC pharmacist.

**Why it matters.** The pharmacist's part is small and clear. Receipts and dispatches update the same district state that the officer sees.

### Find medicine (`/find`)

**What it shows.** A public, Hindi-first page: "Where can I get my medicine?" A patient picks a medicine (by name or illness, for example "sugar medicine" or "BP") and a village or PHC, or uses their location. The answer says **available**, **low**, or **out** at the nearest centre and lists other centres nearby. The person can **Ask by voice** and **Listen** to the answer. An **ASHA** mode checks all of one patient's medicines at once and prepares an SMS. A patient can report "Medicine not given? Tell us", which is marked as not verified.

**Who uses it.** Patients and ASHA workers.

**Why it matters.** A patient can check before a long trip. The page never shows exact counts, only availability bands. See [Audio](../openai/audio.md) and [Responses API](../openai/responses-api.md#find-medicine-question-parsing).
