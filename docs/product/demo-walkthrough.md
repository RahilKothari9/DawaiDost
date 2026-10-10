# Demo walkthrough

This script shows the full Dawai Dost loop in about two minutes. All clinics and numbers in the demo are fictional.

## Before the demo

1. Run `npm run dev`.
2. Open `http://localhost:3000`.
3. For live APIs, set `OPENAI_API_KEY` in `.env.local`. Without a key, the demo runs with labeled sample responses.
4. Turn on the laptop speakers for the Hindi voice call.

## Script

### 1. The alert (15 seconds)

The dashboard opens for Ananya, the district health officer. One clinic needs a plan: **Saraswati PHC has two days of Metformin left.** Resupply takes five days.

> "Without Dawai Dost, Ananya learns about this when patients complain. Here, she sees it before the shelf is empty."

### 2. The voice check-in (45 seconds)

Click **Start call**. The OpenAI Realtime API connects over WebRTC. The pharmacist answers in Hindi and confirms the count: 16 strips, about 8 used each day. The transcript appears live.

> "The pharmacist does not fill in a form. One short call in Hindi is the complete report."

### 3. The decision (20 seconds)

When the call ends, the dashboard calls the OpenAI Decisions API. The card shows:

- the recommendation: **Transfer nearby surplus**
- the probability of each of the four actions
- the badge **LIVE API RESULT** or **DEMO FALLBACK**

> "Code calculated the stock: Saraswati has two days, Kalyanpur has 45 strips of safe surplus. The Decisions API selected one of four real district actions, and it shows how confident it is."

### 4. The transfer plan (15 seconds)

The transfer card shows 24 strips from Kalyanpur PHC to Saraswati PHC. Kalyanpur keeps more than its seven-day reserve.

> "The transfer can never create a new stockout. The reserve rule is in code."

### 5. Approval (10 seconds)

Click **Review & approve**. The accountability timeline records the voice report, the confirmed count, the decision, and the approval.

> "The AI recommends. Ananya decides. Every step has a time and an owner."

### 6. Close (15 seconds)

> "One call, one forecast, one decision, one approval. A shortage is found and solved before a patient sees an empty shelf. The same loop scales to every PHC and every essential medicine in the district."

## Points to highlight for judges

- **Two OpenAI APIs in one loop:** Realtime for Hindi voice, Decisions for the next action.
- **Bounded AI:** the Decisions API selects from four actions, with probabilities.
- **Deterministic facts:** the model never calculates or invents stock.
- **Human approval:** every action needs the officer.
- **Research-based:** the design follows SMS for Life, eVIN, and IHCI.
