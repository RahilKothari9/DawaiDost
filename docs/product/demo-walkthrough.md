# Demo walkthrough

This script shows Dawai Dost in three minutes. It uses the exact labels in the interface. All clinics, people, and numbers in the demo are synthetic.

## Before the demo

1. Run `npm run dev` and open `http://localhost:3000`.
2. For live APIs, set `OPENAI_API_KEY` in `.env.local`. Without a key, every AI step runs with a labeled fallback, and the script still works.
3. Check `http://localhost:3000/api/health`. It shows `live` or `demo` mode.
4. Turn on the speakers for the Hindi voice call.
5. Reload the page before you start. Each load starts from the same seeded district.

## Script (3 minutes)

### 0:00 – The problem on one screen (15 s)

Open **Command center** (`/`). The headline says how many clinics run out before resupply can reach them. Point to the KPI strip and the map.

> "This is Dr. Ananya Rao, the district health officer for Sehore. Saraswati PHC has two days of Metformin left. Resupply takes five days. Today she finds out from a patient. With Dawai Dost, she finds out first."

### 0:15 – The voice check-in (35 s)

In the story card, click **Run voice check + Decisions API**. The OpenAI Realtime API connects over WebRTC in **Simulated pharmacist** mode. The pharmacist answers in Hindi: 16 strips of Metformin. The transcript appears live, with an English line under each Hindi line.

> "No form and no app. One short call in Hindi is the whole report. The count is extracted with structured outputs and checked against last week's ledger."

If the call cannot start, the console plays a call labeled **Sample call · scripted**, and the story continues. To save time, click **Skip call, use verified count**.

### 0:50 – The decision (40 s)

The decision card shows the **Decisions API** result.

- The recommended action: **Transfer nearby surplus**, from Kalyanpur PHC.
- The four probabilities. The chosen action and its confidence.
- **Signals from the same call**: urgency, **Recount needed**, **Indent arrives in time**, **Transfer bridges gap**.
- **Why**: a two-sentence reason. Switch the language to Hindi.

> "Code calculated every number: Saraswati has two days, Kalyanpur has 45 strips above its seven-day reserve. One Decisions API call answered six questions: which of four actions, how urgent, is the count doubtful, will an indent arrive in time, which donor, and does the transfer close the gap."

Open **What if** and choose **Best donor unavailable**, then **Re-run**.

> "Remove the donor and the recommendation changes. The model reacts to the facts, not to a script. Nothing is saved."

### 1:30 – Approve and move the medicine (25 s)

Click **Approve transfer**. Then click **Dispatch transfer**, **Advance 6 hours**, and **Mark delivered**. The arc on the map moves from Kalyanpur to Saraswati.

> "The AI recommends. Ananya decides. The transfer never takes Kalyanpur below its reserve. That rule is in code."

Click **Open the record**. The **Activity log** shows the voice report, the count check, the decision with its snapshot, the approval, and the delivery, each with a time and an owner.

### 1:55 – The whole district at once (20 s)

Open **Decisions** (`/decisions`). Click **Run Decisions API on open**. (On a fresh load the button says **Run Decisions API on all**.) The queue fills live as each decision streams in, with a progress bar.

> "The same call runs for every at-risk shelf in the district, in parallel. The most urgent shelves come first."

In the queue, look for Hirapur PHC Telmisartan (a reported 168 strips against about 30 expected, so a recount) and an Amlodipine shortage (an escalation).

### 2:15 – When the district cannot fix it (15 s)

Open **Escalations** (`/escalations`). Show the **Supply-gap board** with Amlodipine first, then **Memo to the state**.

> "The warehouse is empty and the state supplier is late. A transfer cannot fix that, and Dawai Dost does not pretend it can. It drafts the memo. Every number in the memo is checked against the computed facts."

### 2:30 – Proof of quality (15 s)

Open **Decision evals** (`/evals`).

> "Fifty labeled cases, a written labeling policy, four prompt variants, and our own rules as a baseline. The evals caught a real problem: our first product prompt over-recommended transfers and scored 64%. With the decision criteria stated in order, the same model scored 94%, so we shipped that fix. That is what evals are for."

With a working key, click **Run 10 cases live**.

### 2:45 – The people at the edges (15 s)

Open **Find medicine** (`/find`). Ask by voice: "सरस्वती में शुगर की दवा है क्या?"

> "A patient checks before a long trip. The answer is available, low, or out. We never show exact counts."

Close:

> "One call, one forecast, one decision, one approval. Code calculates, the model decides, the human approves. The shortage is found and fixed before a patient meets an empty shelf."

## Points to highlight for judges

- **The Decisions API is the center.** Six questions in one call, per-choice probabilities, a `false` donor option, batch streaming, and what-if re-runs.
- **The full OpenAI stack, each with one job.** Realtime for Hindi voice; Responses API with structured outputs for extraction, explanations, briefs, indents, and memos; function tools for Ask the district; TTS and transcription for audio; evals for quality.
- **Models never invent numbers.** Code computes every stock value. The memo route rejects any number not in the facts.
- **Every AI step has a labeled fallback.** The demo never shows fallback data as live.
- **Human approval.** Nothing moves until the officer approves.
- **Research-based.** The design follows SMS for Life, eVIN, and IHCI. See [Prior art](../research/prior-art.md).

## Backup paths

| If this fails | Do this |
| --- | --- |
| No API key | Run the same script. Point out the **Rules fallback** and template labels. |
| Microphone blocked | Use **Simulated pharmacist** mode, or **Skip call, use verified count**. |
| Map tiles do not load | The map switches to its SVG renderer, or shows **Basemap offline**. |
| State is out of order | Reload the page to return to the seed. |
