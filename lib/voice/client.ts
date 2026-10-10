"use client";
// Browser helpers for the voice routes. Every call resolves (never throws) with a labeled fallback.
import type { VoiceReport } from "../district/types";
import { fallbackExtract } from "./fallbackExtract";
import { fallbackGloss } from "./gloss-fallback";
import type { ExtractResponse, FacilityRef, MedicineFact, Speaker, VoiceMode } from "./types";

export async function requestExtraction(
  facts: { facility: FacilityRef; medicines: MedicineFact[] },
  transcript: { speaker: Speaker; text: string }[],
): Promise<ExtractResponse> {
  try {
    const res = await fetch("/api/voice/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facts, transcript }) });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as ExtractResponse;
  } catch {
    return { reports: fallbackExtract(facts.facility, facts.medicines, transcript), source: "fallback", fallbackReason: "route_unreachable" };
  }
}

export async function requestGloss(lines: string[]): Promise<{ glosses: string[]; source: "live" | "fallback" }> {
  try {
    const res = await fetch("/api/voice/gloss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return { glosses: lines.map(fallbackGloss), source: "fallback" };
  }
}

let currentAudio: HTMLAudioElement | null = null;

/** Plays a Hindi voice note via gpt-4o-mini-tts; falls back to browser speechSynthesis. Returns which path played. */
export async function playVoiceNote(text: string): Promise<"openai_tts" | "browser_tts" | "unavailable"> {
  currentAudio?.pause();
  try {
    const res = await fetch("/api/voice/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    return "openai_tts";
  } catch {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "hi-IN";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      return "browser_tts";
    }
    return "unavailable";
  }
}

export function stopVoiceNote() {
  currentAudio?.pause();
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Cross-component request to open the voice console on a facility (used by CheckinRoster "Call now"). */
export const VOICE_CALL_EVENT = "dawai:voice-call";
export type VoiceCallRequest = { facilityId: string; mode?: VoiceMode; autoStart?: boolean };

let pendingCall: (VoiceCallRequest & { at: number }) | null = null;

/**
 * Hosts may remount the console when the selected facility changes, so the request is also parked
 * for a few seconds and picked up by a freshly mounted console via takePendingVoiceCall().
 */
export function requestVoiceCall(detail: VoiceCallRequest) {
  pendingCall = { ...detail, at: Date.now() };
  window.dispatchEvent(new CustomEvent<VoiceCallRequest>(VOICE_CALL_EVENT, { detail }));
  window.setTimeout(() => document.getElementById("voice-console")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}

export function peekPendingVoiceCall(): VoiceCallRequest | null {
  return pendingCall && Date.now() - pendingCall.at <= 4000 ? pendingCall : null;
}

export function clearPendingVoiceCall() {
  pendingCall = null;
}

export type { VoiceReport };
