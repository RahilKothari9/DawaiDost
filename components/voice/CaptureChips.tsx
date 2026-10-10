"use client";
import { CircleCheck, Ear, LoaderCircle, MessageCircleQuestion, RotateCcw } from "lucide-react";
import type { Capture, MedicineFact } from "@/lib/voice/types";
import styles from "./voice.module.css";

const STATE_LABEL: Record<Capture["state"], string> = { pending: "Waiting", asking: "Asking", heard: "Heard", confirmed: "Confirmed", recount: "Recount" };
const STATE_ICON = { pending: LoaderCircle, asking: MessageCircleQuestion, heard: Ear, confirmed: CircleCheck, recount: RotateCcw } as const;

/** Per-medicine capture chips that fill in as counts are heard, checked, and confirmed. */
export function CaptureChips({ facts, captures }: { facts: MedicineFact[]; captures: Record<string, Capture> }) {
  return (
    <ul className={styles.chips} aria-label="Counts captured on this call">
      {facts.map((m) => {
        const c = captures[m.id] ?? { medicineId: m.id, state: "pending" as const };
        const Icon = STATE_ICON[c.state];
        return (
          <li key={m.id} className={styles.chip} data-state={c.state} title={c.note ?? `Expected ${m.expectedMin}–${m.expectedMax} ${m.unit}`}>
            <span className={styles.chipName}>{m.name} <small>{m.strength}</small></span>
            <span className={styles.chipCount}>{c.count ?? "—"}<small> {m.unit}</small></span>
            <span className={styles.chipState}><Icon size={11} aria-hidden="true" className={c.state === "asking" ? styles.pulse : undefined} />{STATE_LABEL[c.state]}</span>
            <span className={styles.chipRange}>exp. {m.expectedMin}–{m.expectedMax}</span>
          </li>
        );
      })}
    </ul>
  );
}
