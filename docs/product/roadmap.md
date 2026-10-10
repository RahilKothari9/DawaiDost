# Roadmap

The prototype shows the complete decision loop for one medicine at three clinics. The roadmap grows the same loop to a district pilot. The architecture stays the same at each stage.

## Stage 1: Real phone calls

- Connect the OpenAI Realtime API to a phone line over SIP, or use a telephony partner such as ElevenLabs.
- Change roles: the AI calls the pharmacist on a weekly schedule.
- Use structured extraction to turn the spoken answer into a stock record (medicine, count, unit, time).
- Ask for a recount automatically when a count does not agree with the last report and expected use.
- Support a missed-call callback, so a pharmacist can call back at a better time.

## Stage 2: More medicines and languages

- Add a tracer list of essential medicines, starting with diabetes, hypertension, and maternal health medicines.
- Add more Indian languages for other states.
- Calculate consumption from recent reports and lead time from warehouse history.

## Stage 3: District data and records

- Read dispatch data from the state drug distribution system (for example, DVDMS) to compare what was sent with what is on the shelf.
- Store reports, decisions, and approvals in a database with user roles.
- Keep a durable audit log of each decision with its snapshot, probabilities, and approver.

## Stage 4: More actions

- **Expiry matching:** move near-expiry stock to a clinic that will use it first.
- **Indent drafting:** generate a complete, consumption-based indent for the officer to submit.
- **Follow-up agents:** use OpenAI agent workflows to track an approved transfer until the receiving pharmacist confirms it.
- **Officer briefing:** a short voice or WhatsApp summary of the week's decisions.

## Stage 5: Patients and ASHA workers

- ASHA workers ask by voice if a medicine is in stock before they refer a patient.
- Patients call to check availability before they travel.

## Stage 6: District pilot

Run a pilot at a group of PHCs in one district with the district health team. See [Impact and pilot design](impact-and-pilot.md).

## How the OpenAI platform grows with the product

| Stage | OpenAI capability |
| --- | --- |
| Phone calls | Realtime API with SIP |
| Count capture | Structured outputs from the call transcript |
| Next action | Decisions API, with more actions and more context |
| Follow-up | Agent workflows with tools for messages and status checks |
| Briefings | Text and voice generation in local languages |
| Quality | Evaluations of decision accuracy on labeled scenarios |
