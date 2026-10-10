"use client";
import { useState } from "react";
import { Check, Delete, Pencil, Volume2, AlertTriangle } from "lucide-react";
import { hindiNumberWord } from "@/lib/voice/numbers";
import s from "./phone.module.css";

export type NumberEntryProps = {
  /** Hindi unit, e.g. "पत्ते". */
  unitHi: string;
  unitEn: string;
  prompt: { hi: string; en: string };
  initial?: number | null;
  max?: number;
  /** Returns a Hindi + English warning when the number looks unusual; shown on read-back. */
  warn?: (n: number) => { hi: string; en: string } | null;
  confirmLabel?: { hi: string; en: string };
  onConfirm: (n: number, warned: boolean) => void;
};

function speak(text: string) {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "hi-IN";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is a convenience only */
  }
}

/** Big-number keypad with a spoken + written read-back ("16 पत्ते — सही है?") before anything is saved. */
export function NumberEntry({ unitHi, unitEn, prompt, initial = null, max = 99999, warn, confirmLabel, onConfirm }: NumberEntryProps) {
  const [digits, setDigits] = useState(initial !== null ? String(initial) : "");
  const [step, setStep] = useState<"entry" | "readback">("entry");
  const value = digits === "" ? null : Number(digits);
  const warning = step === "readback" && value !== null && warn ? warn(value) : null;

  const press = (d: string) => setDigits((cur) => {
    const next = cur === "0" ? d : cur + d;
    return Number(next) > max ? cur : next;
  });
  const backspace = () => setDigits((cur) => cur.slice(0, -1));

  const toReadback = () => {
    if (value === null) return;
    setStep("readback");
    speak(`${hindiNumberWord(value)} ${unitHi}. सही है?`);
  };

  if (step === "readback" && value !== null) {
    return (
      <div className={s.entry}>
        <div className={s.readback} role="status" aria-live="polite">
          <div className={s.heroNum}>{value}<small>{unitHi}</small></div>
          <div className={s.readbackQ}>सही है?</div>
          <div className={s.en}>{value} {unitEn}. Is that right?</div>
          <button type="button" className={s.speak} onClick={() => speak(`${hindiNumberWord(value)} ${unitHi}. सही है?`)}>
            <Volume2 aria-hidden /> फिर सुनें <span className={s.en}>Hear again</span>
          </button>
        </div>
        {warning ? (
          <div className={s.note} data-tone="warn">
            <AlertTriangle aria-hidden />
            <div>{warning.hi}<div className={s.en}>{warning.en}</div></div>
          </div>
        ) : null}
        <button type="button" className={`${s.btn} ${s.go} ${s.block} ${s.big}`} onClick={() => onConfirm(value, Boolean(warning))}>
          <Check aria-hidden />
          <span className={s.btnStack}>{confirmLabel?.hi ?? "हाँ, सही है"}<small>{confirmLabel?.en ?? "Yes, that's right"}</small></span>
        </button>
        <button type="button" className={`${s.btn} ${s.block}`} onClick={() => setStep("entry")}>
          <Pencil aria-hidden />
          <span className={s.btnStack}>बदलें<small>Change</small></span>
        </button>
      </div>
    );
  }

  return (
    <div className={s.entry}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{prompt.hi}</div>
        <div className={s.en}>{prompt.en}</div>
      </div>
      <div className={s.display} aria-live="polite" aria-label={`${value ?? 0} ${unitEn}`}>
        <b data-empty={value === null}>{value ?? 0}</b>
        <span>{unitHi}</span>
      </div>
      <div className={s.keys} role="group" aria-label="Number keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className={s.key} onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className={s.key} onClick={backspace} aria-label="Delete last digit"><Delete aria-hidden /></button>
        <button type="button" className={s.key} onClick={() => press("0")}>0</button>
        <button type="button" className={`${s.key} ${s.keyGo}`} onClick={toReadback} disabled={value === null} aria-label="Next: read back">
          <span>आगे<small>Next</small></span>
        </button>
      </div>
    </div>
  );
}
