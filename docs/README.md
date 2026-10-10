# Dawai Dost documentation

This folder explains what Dawai Dost is, why we built it, and how it works. Start with the overview in the [main README](../README.md). Then use this index to go deeper.

## Sections

### OpenAI platform

Dawai Dost is built on the OpenAI platform. These documents explain how each API is used and why.

| Document | Content |
| --- | --- |
| [OpenAI platform overview](openai/overview.md) | Which OpenAI APIs we use, and the role of each one |
| [Decisions API](openai/decisions-api.md) | The core decision engine: request design, choice design, probabilities, validation |
| [Realtime API](openai/realtime-api.md) | The Hindi voice check-in: ephemeral keys, WebRTC, event flow |
| [Prompt and choice design](openai/prompt-design.md) | The exact instructions and action descriptions, and the reason for each line |

### Research

| Document | Content |
| --- | --- |
| [Problem landscape](research/problem-landscape.md) | Medicine availability data from Indian public facilities |
| [Prior art and precedents](research/prior-art.md) | Systems that proved stock visibility works: SMS for Life, eVIN, IHCI |
| [Why this problem](research/why-this-problem.md) | The reasons this problem is a strong fit for AI and for a hackathon |
| [Users](research/users.md) | The district health officer, the PHC pharmacist, and future users |

### Architecture

| Document | Content |
| --- | --- |
| [System overview](architecture/overview.md) | Components, data flow, and the main design principle |
| [District model and state](architecture/district-model.md) | The synthetic Sehore network, built-in cases, state store, actions, and simulation clock |
| [Stock calculations](architecture/stock-math.md) | Days of stock, risk levels, count check, donor ranking, transfer planner, and indent quantity, with a worked example |
| [Reliability and safety](architecture/reliability-and-safety.md) | Fallbacks, guardrails, key handling, and human approval |
| [Testing](architecture/testing.md) | What the test suite checks and how to run it |

### Product

| Document | Content |
| --- | --- |
| [Demo walkthrough](product/demo-walkthrough.md) | A step-by-step script for the judging demo |
| [Roadmap](product/roadmap.md) | The path from prototype to a district pilot |
| [Impact and pilot design](product/impact-and-pilot.md) | How we will measure the effect of Dawai Dost in the field |
