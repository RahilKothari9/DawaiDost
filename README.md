# Dawai Dost

A Decisions API-powered last-mile medicine response demo for fictional primary health centres in Sehore district, Madhya Pradesh.

The demo turns one Hindi pharmacist check-in into an operational decision: verify the count, transfer nearby surplus, draft an indent, or escalate a supply gap. Stock forecasts and transferable quantities are calculated in code; OpenAI Decisions API chooses among the defined response options. An officer approves every action.

## Run locally

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Add an API key to `.env.local` to enable live Decisions and Realtime sessions:

```env
OPENAI_API_KEY=your_api_key
OPENAI_DECISIONS_MODEL=gpt-6-luna
```

Without credentials, the interface uses clearly labeled demo responses and a scripted sample call. The scenario contains synthetic clinic inventory only.

## API routes

- `POST /api/decisions` sends the operational snapshot to the Decisions API and returns the selected action, confidence, and per-option probabilities. It returns a deterministic demo fallback if credentials or the upstream service are unavailable.
- `POST /api/realtime/session` creates a short-lived Realtime client secret. The standard API key remains on the server.

## Demo scenario

- Saraswati PHC: 16 strips of Metformin 500 mg, about 8 strips used daily, count confirmed.
- Kalyanpur PHC: 80 strips, about 5 used daily; 45 remain transferable after a 7-day reserve.
- Rampur PHC: 9 strips, about 6 used daily; no transferable surplus.
- District resupply lead time: 5 days, with a 3-day safety buffer.

Reset the demo to restore the seeded scenario. Approving the transfer only updates the prototype UI; it does not contact a clinic or dispatch medicine.

## Checks

```bash
npm test
npm run lint
npm run build
```

The live call simulation uses the OpenAI Realtime API in the browser via WebRTC and a server-issued ephemeral secret. The ElevenLabs telephony handoff is not integrated in this prototype.
