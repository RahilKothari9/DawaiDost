# Dawai Dost

**Dawai Dost** ("medicine friend") helps a district health team find a medicine shortage at a rural clinic before a patient finds it.

A clinic pharmacist reports the shelf count in a short voice call in Hindi. The system calculates how many days the stock will last. It finds safe surplus at nearby clinics. The OpenAI Decisions API then selects the best next step from a fixed set of actions. The district health officer approves the step with one click.

The pharmacist does not need to fill in a form. The officer does not need to read a spreadsheet. Each person does one simple task, and the system does the rest.

## Built on OpenAI

| OpenAI API | Model | Role in Dawai Dost |
| --- | --- | --- |
| **Decisions API** | `gpt-6-luna` | The decision engine. One call answers six questions: the next action (one of four, with a probability for each), urgency, recount need, indent timing, best donor, and whether a transfer closes the gap. A batch route streams decisions for the whole district. |
| **Realtime API** | `gpt-realtime-2.1` | The voice check-in. A natural conversation in Hindi over WebRTC, with a short-lived client secret. |
| **Responses API** (structured outputs) | `gpt-5.4-mini`, `gpt-6-sol`, `gpt-5.5` | Extracts shelf counts from the Hindi call transcript. Writes from computed facts: decision explanations and the morning brief in English and Hindi, indent justifications, and the escalation memo to the state. Every memo number is checked against the facts. |
| **Responses API** (function tools, streaming) | `gpt-5.5` | "Ask the district": answers free questions only from tool results, and shows each tool call. |
| **Text to speech** | `gpt-4o-mini-tts` | Reads the brief and public availability answers aloud in Hindi or English. |
| **Speech to text** | `gpt-transcribe`, `gpt-4o-mini-transcribe` | Live captions during the Realtime call, and transcription of a spoken "Is my medicine in stock?" question from a patient or ASHA worker. |
| **Evals** | `gpt-6-luna` and others | 50 labeled cases grade the Decisions API against a written policy and against the rule-based fallback. |

Code calculates every stock number. The models choose and write. The officer approves. Every AI feature has a labeled fallback, so the demo runs without a key.

Full documentation is in [`docs/`](docs/README.md). Start with the [Decisions API design](docs/openai/decisions-api.md) and the [demo walkthrough](docs/product/demo-walkthrough.md).

---

## The problem

India has a strong public supply system for essential medicines. States buy medicines in bulk, store them in district warehouses, and send them to clinics. Warehouse software records what leaves the warehouse.

The data stops at the clinic door. After a box arrives at a Primary Health Centre (PHC), nobody at the district level can see how much remains on the shelf. The first person to find a stockout is often a patient who travelled for a refill.

The research shows how often this happens:

- **ICMR, 2025.** A survey of 415 public and private facilities in 19 districts across seven states examined diabetes and hypertension care. At sub-centres, 35% reported metformin stockouts, with a median duration of **seven months**. Atenolol stockouts were reported at 68.5% of sub-centres. PHCs did better but scored only 66% on medicine availability.[^icmr]
- **Punjab and Haryana.** A PGIMER-led study of 80 public facilities in 12 districts found overall essential-medicine availability of **45.2%** in Punjab and **51.1%** in Haryana.[^pgimer]
- **Chhattisgarh.** Researchers checked 1,290 prescriptions from 100 public facilities. Patients received only about **58%** of prescribed generic medicines at the facility.[^chhattisgarh]
- **Puducherry.** A survey of 10 public facilities found median availability of 76% across 50 key medicines.[^puducherry]

The WHO uses 80% availability as a reference target for its access method.[^who] Many sampled facilities in these studies were below that level.

When a public clinic runs out, the patient buys the medicine at a private pharmacy or stops treatment. For diabetes and hypertension, a missed month of treatment has real health effects.

## Why this is the right problem

We studied the problem from the warehouse to the shelf. Three findings made us choose it.

**1. The medicine is often already in the district.** A stockout at one PHC does not mean the district has no stock. Consumption is different at each clinic, so one clinic can have surplus while a clinic nearby is empty. Often the supply exists. The information to move it does not. This is a coordination problem, and software can solve coordination problems.

**2. Visibility has a proven effect.** The *SMS for Life* pilot in Tanzania asked 129 health facilities to report antimalarial stock by text message each week. The average weekly response rate was **95%**. In 21 weeks, the share of facilities without at least one antimalarial dosage fell from **78% to 26%**. Total artemether-lumefantrine stock in the three districts increased by 64%.[^sms-pilot] In India, the India Hypertension Control Initiative combined forecasting and stock tools with other programme reforms. Participating facilities kept amlodipine stockouts below 5%.[^ihci]

**3. The last mile is the known gap.** Studies of state supply chains, including Uttar Pradesh's supply-chain redesign, describe good warehouse data but weak visibility below the district store.[^up] Dawai Dost works exactly in that gap. It adds to the systems that exist. It does not replace them.

SMS for Life needed staff to type a structured text message. In 2026, a pharmacist can speak naturally in Hindi, and a voice model can understand the answer. This is the change that makes the idea practical at scale today.

## How Dawai Dost works

```
Voice check-in  →  Count check  →  Stock forecast  →  Decisions API  →  Officer approval
 (pharmacist)       (code)           (code)            (one action)      (human)
```

1. **Voice check-in.** Each week, Dawai Dost calls the PHC pharmacist. The pharmacist says the shelf count in Hindi. The call takes less than a minute.
2. **Count check.** The system compares the new count with the previous count and the expected consumption. If the numbers do not agree, it asks for a recount.
3. **Stock forecast.** Code calculates the days of stock left. It compares that value with the resupply lead time plus a safety buffer.
4. **Safe surplus.** Code calculates how much each nearby clinic can give. Each donor clinic always keeps a seven-day reserve.
5. **Decision.** The OpenAI Decisions API selects one of four actions:
   - `verify_count`: ask for a recount
   - `transfer_surplus`: move surplus from a nearby clinic
   - `draft_indent`: prepare a resupply order for the district store
   - `escalate_supply_gap`: report a shortage that local action cannot fix
6. **Approval.** The district officer sees the alert, the evidence, and the recommended action with its probability. The officer approves it. The timeline records each step.

### Demo scenario

The demo uses three fictional PHCs in Sehore district, Madhya Pradesh, and one medicine: Metformin 500 mg.

| PHC | Stock (strips) | Daily use | Days of stock | Role in demo |
| --- | ---: | ---: | ---: | --- |
| Saraswati | 16 | 8 | 2.0 | Needs stock |
| Kalyanpur | 80 | 5 | 16.0 | Has 45 strips of safe surplus |
| Rampur | 9 | 6 | 1.5 | Low stock, no surplus |

Resupply takes five days. With a three-day safety buffer, each clinic needs eight days of stock. Saraswati has two. Kalyanpur can give 45 strips and still keep its seven-day reserve. The Decisions API recommends a transfer from Kalyanpur to Saraswati, and the officer approves it.

In the demo, a shortage is found and solved in less than two minutes, before any patient arrives at an empty shelf.

## Why this solution is realistic

**It uses the people and roles that already exist.** Every PHC has a pharmacist. Every district has a health officer who is responsible for medicine supply. Dawai Dost gives each of them a smaller, clearer task. It does not need new staff.

**It needs no new hardware.** The pharmacist uses a basic phone call. No smartphone, app, or internet connection is necessary at the clinic. The officer uses a web dashboard.

**It speaks the pharmacist's language.** Voice in Hindi removes the largest barrier to frequent reporting: forms. Voice models now support many Indian languages, so the same design can extend to other states.

**It keeps the human in control.** The AI recommends. The officer decides. This matches how public health administration works, and it gives each decision a clear owner.

**It is honest about scope.** Dawai Dost moves medicine that already exists and makes real shortages visible sooner. When the whole district has no stock, the system escalates the gap with evidence and a timestamp. That record helps the district act on procurement faster.

**It is cheap to run.** A short weekly call and one bounded decision per alert cost very little per clinic. The system can start with a few tracer medicines and grow.

## Technical design

The stack is Next.js 16 (App Router), React 19, TypeScript, MapLibre GL, d3, and the official `openai` SDK. Tests use Vitest.

### Design principle: code calculates, the model decides, the human approves

We gave each part of the system the task it does best.

| Part | Responsibility | Reason |
| --- | --- | --- |
| Deterministic code | Days of stock, risk level, count check, safe surplus, donor ranking, transfer plan, indent quantity | Arithmetic must be exact and easy to audit. A language model must not invent stock numbers. |
| Decisions API | Select one action from four defined actions, with urgency and supporting judgments | Choosing the right response needs judgment across many signals. A closed choice set keeps the output safe and machine-readable. |
| Responses API | Explain, brief, draft, and answer, from computed facts | Officers need clear words in English and Hindi. Structured outputs keep the text typed and checkable. |
| District officer | Approve or reject the action | Medicine transfers and orders need an accountable person. |

### OpenAI Decisions API

The Decisions API is the center of the product. For each at-risk clinic and medicine, code builds a facts-only snapshot: stock, daily use, days of stock, threshold, gap, report age, count-check result, inbound transfers, eligible donors with their safe surplus, upstream supply status, and warehouse cover.

`POST /api/decisions/district` sends the snapshot in **one call with six questions**:

| Question | Type | Answer |
| --- | --- | --- |
| `next_action` | choice | `verify_count`, `transfer_surplus`, `draft_indent`, or `escalate_supply_gap`, with a probability for each |
| `urgency` | score | `monitor`, `this_week`, or `today` |
| `recount_needed` | predicate | Probability that the count must be checked first |
| `indent_arrives_in_time` | predicate | Probability that a normal indent arrives before the shelf is empty |
| `donor` | choice | The best donor clinic, or `false` for "no suitable donor" |
| `transfer_bridges_gap` | predicate | Probability that the transfer alone closes the gap |

`POST /api/decisions/batch` runs up to 80 snapshots with bounded concurrency and streams each decision as it finishes. The snapshot builder also supports **what-if** analysis: for example, remove the best donor or mark upstream supply as delayed, and see how the recommendation changes.

We chose the Decisions API instead of a free-text chat model for three reasons:

1. **Bounded output.** The response is always one valid action. There is no free text to parse and no risk of an invented action.
2. **Confidence signal.** Per-choice probabilities give the officer a confidence value they can act on. A 0.82 transfer recommendation and a 0.40 recommendation lead to different conversations.
3. **Validation.** The server accepts a response only if it names one of the four actions and an offered donor. Any other response triggers a labeled fallback.

**Evals drove a measured prompt fix.** We ran 50 labeled synthetic cases against the live Decisions API (`gpt-6-luna`, 200 calls). The eval caught a real failure mode before any officer saw it: the first product prompt over-recommended transfers when donor surplus was too small to close the gap, and scored 64%. A prompt that states the decision criteria as ordered checks scored 94% on the same model, with a median latency of about 150 ms. The product now sends those ordered checks. The criteria mirror the labeling policy, and the rule-based fallback (98% in the run) encodes the same policy, so these numbers show policy-following, not independent judgment. The results file is committed, and the `/evals` page shows every case.

Details: [Decisions API](docs/openai/decisions-api.md). Quality: [Decision evals](docs/openai/evals.md).

### Responses API

The Responses API writes text from facts that code has already computed. Each feature uses strict structured outputs and has a template fallback.

- **Explain** (`/api/explain`): why the Decisions API chose this action, in English and Hindi. It cannot change the decision.
- **Morning brief** (`/api/briefing`): a short brief for the officer, in English and Hindi, with optional speech (`/api/briefing/speech`).
- **Ask the district** (`/api/ask`): free questions answered only from function-tool results (`get_stock`, `list_at_risk`, `find_donors`, `get_transfers`, `draft_transfer_proposal`), streamed with each tool call visible.
- **Indent** (`/api/indent`): code sets every quantity; the model writes one justification per line and a covering note.
- **Escalation memo** (`/api/escalations/memo`): a formal note to the state. The server rejects any memo that contains a number not present in the computed facts.

Details: [Responses API](docs/openai/responses-api.md).

### Realtime voice

`POST /api/realtime/session` creates a short-lived client secret on the server. The browser uses this secret to open a WebRTC connection to the OpenAI Realtime API (`gpt-realtime-2.1`). The standard API key never leaves the server.

The voice session speaks Hindi. Its instructions limit it to the supplied facts, so it does not invent numbers or give medical advice. Details: [Realtime API](docs/openai/realtime-api.md).

### Public availability check

`POST /api/find/ask` lets a patient or ASHA worker ask, by voice or text, if a medicine is in stock nearby. Speech to text (`gpt-4o-mini-transcribe`) uses a vocabulary hint with local medicine and place names. The Responses API maps the question to medicine and place ids. Code builds the answer from availability bands (`available`, `low`, `out`) and never exposes shelf counts. `POST /api/find/speak` reads the answer aloud. Details: [Audio](docs/openai/audio.md).

### Reliability

Every external call has a labeled fallback. If the API key is missing, the upstream service is unavailable, or the response is not valid, the server returns a deterministic result from the same rules. Each response includes a `source` field and a reason. The demo always works, and it never shows fallback data as live data. `GET /api/health` reports whether the app runs in `live` or `demo` mode.

### Tests

Vitest covers the stock engine, the transfer planner, the reducer and simulation clock, the Decisions API routes (district, batch, and the original route), every Responses API route, escalation gap detection and memo checks, the Find medicine matcher and answers, and the eval metrics and runner. All upstream calls are mocked, so the tests run without an API key. Details: [Testing](docs/architecture/testing.md).

### Routes

**Pages**

| Route | Purpose |
| --- | --- |
| `/` | Command center: today's risks, the AI inbox, the district map, and live activity |
| `/decisions` | Every Decisions API recommendation, with probabilities, waiting for approval |
| `/map` | Every clinic in the district by risk, with transfers on the road |
| `/transfers` | Medicine moving between clinics, from proposal to delivery |
| `/escalations` | Gaps the district cannot close locally, with a memo to the state |
| `/voice` | Weekly Hindi stock calls with pharmacists (three Realtime voice modes) |
| `/stock` | Days of stock for every clinic and medicine |
| `/briefing` | The district brief, questions, and indents |
| `/evals` | How well the Decisions API picks the right action on 50 labeled cases |
| `/activity` | Who did what, and when |
| `/about` | How the loop works, the four actions, and the research |
| `/pharmacist` | Hindi-first phone app for the PHC pharmacist: counts, recounts, dispatch, and receipt |
| `/find` | Public page: is my medicine in stock nearby? Hindi voice or text |

**API**

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/decisions/district` | `POST` | One clinic and medicine: one Decisions API call with six questions |
| `/api/decisions/batch` | `POST` | Many decisions, streamed as NDJSON |
| `/api/decisions` | `POST` | Original single-question decision for the three-clinic scenario |
| `/api/explain` | `POST` | Explain a decision in English and Hindi (Responses API) |
| `/api/briefing` | `POST` | Morning brief in English and Hindi (Responses API) |
| `/api/briefing/speech` | `POST` | Brief as MP3 audio (TTS) |
| `/api/ask` | `POST` | Ask the district: Responses API with function tools, streamed as NDJSON |
| `/api/indent` | `POST` | Consumption-based indent with written justifications |
| `/api/escalations/memo` | `POST` | Escalation memo to the state, with a number check |
| `/api/find/ask` | `POST` | Public availability question, by voice or text |
| `/api/find/speak` | `POST` | Public availability answer as MP3 audio (TTS) |
| `/api/realtime/session` | `POST` | Short-lived Realtime client secret for one of three voice modes |
| `/api/voice/extract` | `POST` | Shelf counts from a call transcript (Responses API, structured outputs) |
| `/api/voice/gloss` | `POST` | English gloss of Hindi transcript lines |
| `/api/voice/tts` | `POST` | Hindi voice note as MP3 audio (TTS) |
| `/api/evals/run` | `POST` | Stream a live 10-case eval run against the Decisions API |
| `/api/health` | `GET` | Live or demo mode, and model names |

## Run locally

You need Node.js and npm.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

To use the live OpenAI APIs, add your key to `.env.local`:

```env
OPENAI_API_KEY=your_api_key
OPENAI_DECISIONS_MODEL=gpt-6-luna
```

Each other model has an optional override. See [Configuration](docs/openai/overview.md#configuration). Restart the dev server after you change the environment values. Without a key, the app runs the full workflow with labeled demo responses.

Run the checks:

```powershell
npm test
npm run lint
npm run build
```

Run the Decisions API evals from the command line (needs a key). The results appear on the `/evals` page:

```powershell
node scripts/evals/run.mjs
```

## Prototype scope

This is a hackathon prototype. **All facility data is synthetic.** The block names are real blocks of Sehore district; the facilities, people, phone numbers, and stock counts are fictional. Approval changes the dashboard state only. The prototype does not contact a clinic, submit an order, send a memo, or dispatch medicine. State lives in the browser and resets on reload. A simulation clock moves time forward so a judge can watch a transfer go from approval to delivery. The voice call is a browser simulation of the weekly phone call.

## Roadmap

1. **Phone calls.** Connect the Realtime API to a phone line over SIP, or use a telephony partner, so the system calls each PHC every week on a normal phone line.
2. **More languages.** Support more Indian languages for other states.
3. **District data.** Read dispatch data from the state drug distribution system to improve consumption and lead-time values.
4. **Durable audit trail.** Store reports, decisions, approvals, and escalations in a database with user roles.
5. **Better decisions, measured.** Move the product prompt toward the explicit criteria that scored 94% in the first live eval run, and test on held-out cases that were not used for tuning.
6. **Pilot.** Run a pilot at a group of PHCs in one district. Measure report completion, days of warning before a stockout, time to approved action, transfers completed, and stockout-days per medicine against a baseline period.

## Documentation

| Section | Documents |
| --- | --- |
| OpenAI platform | [Overview](docs/openai/overview.md) · [Decisions API](docs/openai/decisions-api.md) · [Decision evals](docs/openai/evals.md) · [Responses API](docs/openai/responses-api.md) · [Realtime API](docs/openai/realtime-api.md) · [Audio](docs/openai/audio.md) · [Prompt and choice design](docs/openai/prompt-design.md) |
| Research | [Problem landscape](docs/research/problem-landscape.md) · [Prior art](docs/research/prior-art.md) · [Why this problem](docs/research/why-this-problem.md) · [Users](docs/research/users.md) |
| Architecture | [System overview](docs/architecture/overview.md) · [District model and state](docs/architecture/district-model.md) · [Stock calculations](docs/architecture/stock-math.md) · [Reliability and safety](docs/architecture/reliability-and-safety.md) · [Testing](docs/architecture/testing.md) |
| Product | [Features](docs/product/features.md) · [Demo walkthrough](docs/product/demo-walkthrough.md) · [Roadmap](docs/product/roadmap.md) · [Impact and pilot design](docs/product/impact-and-pilot.md) |

## References

### Medicine availability in India

- [ICMR/IJMR: Preparedness of public and private health facilities for diabetes and hypertension in 19 districts](https://pmc.ncbi.nlm.nih.gov/articles/PMC12178186/)
- [PGIMER and collaborators: Availability of medicines in public sector facilities in Punjab and Haryana](https://pubmed.ncbi.nlm.nih.gov/26699711/)
- [Access and availability of essential medicines in public facilities in Chhattisgarh](https://pmc.ncbi.nlm.nih.gov/articles/PMC5958558/)
- [Availability of key essential medicines in public health facilities in Puducherry](https://pmc.ncbi.nlm.nih.gov/articles/PMC8654139/)
- [WHO: Access indicators for essential medicines](https://www.who.int/tools/monitoring-and-evaluation/access-indicators)

### Supply systems and response

- [India Hypertension Control Initiative: availability of antihypertensive medicines](https://pmc.ncbi.nlm.nih.gov/articles/PMC10721057/)
- [Lessons from redesigning Uttar Pradesh's public-medicine supply chain](https://pmc.ncbi.nlm.nih.gov/articles/PMC12333384/)
- [Public drug procurement in five Indian states](https://pmc.ncbi.nlm.nih.gov/articles/PMC3585974/)
- [XKDR Forum: Improving supply chain management of medicines for public healthcare in India](https://papers.xkdr.org/papers/2024Manivannanetal_rp_governmentProcurementDrugsIndia.pdf)
- [NHM Odisha: Rapid assessment of drug availability and stockouts](https://nhmodisha.gov.in/wp-content/uploads/2024/02/12.-Draft-Drug-Stock-Out-Assessment-including-recommendations-for-the-procurement-system-identification-of-issues-arising-and-mitigation-plan-agreed-with-DHFW.pdf)
- [CAG of India: Uttar Pradesh health infrastructure and services audit](https://cag.gov.in/uploads/download_audit_report/2024/Report-No-08-of-2024-English-067640dd5e65066.24454837.pdf)

### Reporting and visibility

- [SMS for Life: Tanzania pilot](https://pmc.ncbi.nlm.nih.gov/articles/PMC2978233/)
- [SMS for Life: national rollout](https://pmc.ncbi.nlm.nih.gov/articles/PMC4030285/)
- [ElevenLabs India](https://elevenlabs.io/india) and [ElevenLabs Agents](https://elevenlabs.io/agents)

[^icmr]: Survey of 415 facilities in 19 districts across seven states, in two phases (September to December 2021, and February to June 2023).
[^pgimer]: Survey of 80 public facilities across 12 districts.
[^chhattisgarh]: Prescription and availability study at 100 public facilities in Chhattisgarh.
[^puducherry]: Survey of 50 key medicines at 10 public facilities. Facility range was 66% to 80%.
[^who]: The WHO 80% value is a reference target for the availability of a defined set of essential medicines.
[^sms-pilot]: 21-week pilot at 129 facilities in three districts, October 2009 to February 2010. The pilot combined weekly reporting with district follow-up action.
[^ihci]: IHCI combined treatment protocols, forecasting, procurement, and stock tools.
[^up]: The study describes the warehouse data model, procurement reforms, and the remaining challenge of last-mile visibility.
