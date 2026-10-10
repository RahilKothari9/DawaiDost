# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

District health officers are the primary users. They monitor medicine availability across rural Primary Health Centres (PHCs), decide how to respond to shortages, and need early, actionable signals. PHC pharmacists report shelf counts by voice, without filling out forms. Patients and ASHA health workers are optional future users who may check availability before travelling.

## Product Purpose

Dawai Dost helps district health teams prevent avoidable essential-medicine stockouts by bringing clinic-shelf inventory into view and turning verified reports into timely operational decisions. Success means shortages are surfaced early enough for an officer-approved transfer, reorder, or escalation. The system cannot repair upstream procurement failures; it should make them visible sooner and preserve an accountable record.

## Positioning

The OpenAI Decisions API is a visible, central product capability. It selects among defined supply-chain responses—verify a count, transfer nearby surplus, draft an indent, or escalate a supply gap—using an operational snapshot and explicit evidence. Deterministic code calculates stock-days and transferable quantities; an officer approves every action.

## Operating Context

The workflow starts with a weekly local-language voice stock report from a PHC pharmacist. The report is checked against prior counts and consumption, then used to forecast days of stock and identify response options. District officers review alerts and approve proposed actions. The prototype demonstrates this workflow with fictional PHCs in Sehore district, Madhya Pradesh.

## Capabilities and Constraints

- The current demo focuses on Metformin 500 mg across Saraswati, Kalyanpur, and Rampur PHCs, with synthetic counts, consumption, lead time, and a proposed transfer.
- Forecasting and transferable-surplus calculations are deterministic; the Decisions API chooses among predefined actions and returns confidence/probability information.
- The interface supports a scripted sample call and a browser Realtime voice simulation. ElevenLabs telephony is not integrated.
- Approvals update prototype state only; the app does not contact clinics, submit procurement orders, or dispatch medicine.
- There is no database; the scenario is a resettable in-memory demo.
- Live API credentials are server-side. Deterministic demo responses are clearly identified when credentials or the upstream service are unavailable.
- Patient/ASHA availability checks, real deployments, and integrations remain optional or undecided.

## Brand Commitments

Dawai Dost ("medicine friend") is the product name. The product serves Indian public health operations and should support voice reporting in Hindi or another relevant local language. Do not present synthetic scenario details as real facility data or claim the product resolves upstream procurement failures.

## Evidence on Hand

The repository contains a synthetic Sehore demo scenario and a working prototype workflow; it contains no real facility data, pilot results, customer testimonials, or validated impact measurements. Do not fabricate these as proof.

## Product Principles

- Make clinic-shelf conditions visible before they become patient-facing failures.
- Use AI to choose among constrained, evidence-backed actions rather than inventing stock facts.
- Keep operational authority with a human officer.
- Preserve an accountable timeline of reports, alerts, and decisions.
- Be explicit about synthetic data and limits outside the system's control.

## Accessibility & Inclusion

Voice reporting should work for PHC pharmacists who should not need to complete software forms, and support Hindi or the relevant local language. Exact language coverage and accessibility standards are undecided.
