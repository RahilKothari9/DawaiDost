# Dawai Dost

**Dawai Dost** ("medicine friend") helps a district health team find a medicine shortage at a rural clinic before a patient finds it.

A clinic pharmacist reports the shelf count in a short voice call in Hindi. The system calculates how many days the stock will last. It finds safe surplus at nearby clinics. The OpenAI Decisions API then selects the best next step from a fixed set of actions. The district health officer approves the step with one click.

The pharmacist does not need to fill in a form. The officer does not need to read a spreadsheet. Each person does one simple task, and the system does the rest.

## Built on OpenAI

| OpenAI API | Role in Dawai Dost |
| --- | --- |
| **Decisions API** (`gpt-6-luna`) | The decision engine. Selects one of four district actions and returns a probability for each. |
| **Realtime API** (`gpt-realtime-2.1`) | The voice check-in. A natural conversation in Hindi over WebRTC, with a short-lived client secret. |

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

The stack is Next.js 16 (App Router), React 19, and TypeScript. Tests use Vitest.

### Design principle: code calculates, the model decides, the human approves

We gave each part of the system the task it does best.

| Part | Responsibility | Reason |
| --- | --- | --- |
| Deterministic code | Days of stock, safe surplus, reserve rules | Arithmetic must be exact and easy to audit. A language model must not invent stock numbers. |
| Decisions API | Select one action from four defined actions | Choosing the right response needs judgment across many signals. A closed choice set keeps the output safe and machine-readable. |
| District officer | Approve or reject the action | Medicine transfers and orders need an accountable person. |

### OpenAI Decisions API

The Decisions API is the center of the product. `POST /api/decisions` builds a compact decision snapshot on the server. The snapshot contains the target clinic, its verified count, daily use, days of stock, lead time, safety buffer, and the safe surplus at each nearby clinic.

The server sends this snapshot to the Decisions API with one `choice` question and the four allowed actions. Each action has a short description of when it applies. The instructions tell the model to prefer a local transfer when enough safe surplus exists, and not to treat a transfer as a fix for an upstream shortage.

The API returns the selected action and a probability for each choice. The dashboard shows these probabilities, so the officer can see how strong the recommendation is. A 0.82 transfer recommendation and a 0.40 recommendation lead to different conversations.

We chose the Decisions API instead of a free-text chat model for three reasons:

1. **Bounded output.** The response is always one valid action. There is no free text to parse and no risk of an invented action.
2. **Confidence signal.** Per-choice probabilities give the officer a confidence value they can act on.
3. **Validation.** The server accepts a response only if it names one of the four actions. Any other response triggers a safe fallback.

### Realtime voice

`POST /api/realtime/session` creates a short-lived client secret on the server. The browser uses this secret to open a WebRTC connection to the OpenAI Realtime API (`gpt-realtime-2.1`). The standard API key never leaves the server.

The voice session plays a pharmacist who answers in Hindi. Its instructions limit it to the supplied facts, so it confirms the count and does not invent numbers or give medical advice.

### Reliability

Every external call has a labeled fallback. If the API key is missing, the upstream service is unavailable, or the response is not valid, the server returns a deterministic recommendation from the same stock rules. The response includes a `source` field (`live` or `demo_fallback`) and a reason. The dashboard shows this label clearly. The demo always works, and it never shows fallback data as live data.

If the browser cannot start live audio, the dashboard plays a scripted sample call and continues the workflow.

### Tests

The test suite covers:

- days-of-stock calculation, including zero consumption
- safe surplus with the donor reserve
- the decision snapshot content
- mapping of a live Decisions API answer and its probabilities
- fallback when credentials are missing or the upstream API rejects the request
- rejection of malformed requests

All upstream calls are mocked, so the tests run without an API key.

### Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/` | `GET` | District medicine dashboard |
| `/api/decisions` | `POST` | Select the next action with the Decisions API |
| `/api/realtime/session` | `POST` | Create a short-lived Realtime client secret |

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

Restart the dev server after you change the environment values. Without a key, the app runs the full workflow with labeled demo responses.

Run the checks:

```powershell
npm test
npm run lint
npm run build
```

## Prototype scope

This is a hackathon prototype. The clinics, counts, and consumption values in the demo are synthetic. Approval changes the dashboard state only. The prototype does not contact a clinic, submit an order, or dispatch medicine. State is in memory and resets when the server restarts. The voice call is a browser simulation of the weekly phone call, and the demo uses the seeded counts after the call. Automatic recount checks against earlier reports are part of the design but are not in this build.

## Roadmap

1. **Phone calls.** Connect a telephony provider such as ElevenLabs so the system calls each PHC every week on a normal phone line.
2. **More medicines and languages.** Add a tracer list of essential medicines and support for more Indian languages.
3. **District data.** Read dispatch data from the state drug distribution system to improve consumption and lead-time values.
4. **Expiry matching.** Move near-expiry stock to clinics that will use it before it expires.
5. **Durable audit trail.** Store reports, alerts, and approvals in a database with user roles.
6. **Patient and ASHA checks.** Let ASHA workers and patients ask by voice if a medicine is in stock before they travel.
7. **Pilot.** Run a pilot at a group of PHCs in one district. Measure report completion, days of warning before a stockout, time to approved action, transfers completed, and stockout-days per medicine against a baseline period.

## Documentation

| Section | Documents |
| --- | --- |
| OpenAI platform | [Overview](docs/openai/overview.md) · [Decisions API](docs/openai/decisions-api.md) · [Realtime API](docs/openai/realtime-api.md) · [Prompt and choice design](docs/openai/prompt-design.md) |
| Research | [Problem landscape](docs/research/problem-landscape.md) · [Prior art](docs/research/prior-art.md) · [Why this problem](docs/research/why-this-problem.md) · [Users](docs/research/users.md) |
| Architecture | [System overview](docs/architecture/overview.md) · [District model and state](docs/architecture/district-model.md) · [Stock calculations](docs/architecture/stock-math.md) · [Reliability and safety](docs/architecture/reliability-and-safety.md) · [Testing](docs/architecture/testing.md) |
| Product | [Demo walkthrough](docs/product/demo-walkthrough.md) · [Roadmap](docs/product/roadmap.md) · [Impact and pilot design](docs/product/impact-and-pilot.md) |

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
