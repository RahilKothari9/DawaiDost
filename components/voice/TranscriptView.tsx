"use client";
import { useEffect, useRef } from "react";
import type { TranscriptLine, VoiceMode } from "@/lib/voice/types";
import styles from "./voice.module.css";

type Props = { lines: TranscriptLine[]; mode: VoiceMode; pharmacistName?: string; emptyText: string };

function speakerLabel(line: TranscriptLine, mode: VoiceMode, pharmacistName?: string) {
  switch (line.speaker) {
    case "agent": return "Dawai Dost";
    case "pharmacist": return mode === "caller_agent" ? "You · pharmacist" : `${pharmacistName ?? "Pharmacist"} · AI`;
    case "caller": return "ASHA / caller";
    case "tool": return "Tool call";
    default: return "System";
  }
}

export function TranscriptView({ lines, mode, pharmacistName, emptyText }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className={styles.transcript} ref={scrollRef} aria-live="polite" aria-relevant="additions">
      {lines.length === 0 && <p className={styles.empty}>{emptyText}</p>}
      {lines.map((line) => (
        <div key={line.id} className={styles.line} data-speaker={line.speaker} data-final={line.final ? "1" : "0"}>
          <span className={styles.speaker}>{speakerLabel(line, mode, pharmacistName)}</span>
          <p className={styles.lineText} lang={line.speaker === "tool" ? "en" : "hi"}>
            {line.text}
            {!line.final && <span className={styles.caret} aria-hidden="true" />}
          </p>
          {line.gloss && <p className={styles.gloss} lang="en">{line.gloss}</p>}
        </div>
      ))}
    </div>
  );
}
