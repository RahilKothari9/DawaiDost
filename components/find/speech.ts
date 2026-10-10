"use client";
// OWNER: find agent. Speak an answer: server TTS (gpt-4o-mini-tts) first, browser speechSynthesis as the fallback.
import type { Lang } from "@/lib/find/copy";

let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  current?.pause();
  current = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

function browserSpeak(text: string, lang: Lang): Promise<"browser" | "none"> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve("none");
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
    u.rate = 0.92;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang === "hi" ? "hi" : "en-in"));
    if (voice) u.voice = voice;
    u.onend = () => resolve("browser");
    u.onerror = () => resolve("none");
    window.speechSynthesis.speak(u);
  });
}

/** Resolves when playback ends. Returns which engine spoke. */
export async function speak(text: string, lang: Lang, onStart?: () => void): Promise<"live" | "browser" | "none"> {
  stopSpeaking();
  try {
    const res = await fetch("/api/find/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang }) });
    if (res.ok && res.headers.get("content-type")?.includes("audio")) {
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      current = audio;
      onStart?.();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.onpause = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      return "live";
    }
  } catch {
    // fall through to the browser voice
  }
  onStart?.();
  return browserSpeak(text, lang);
}
