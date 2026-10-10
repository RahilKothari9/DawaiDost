"use client";
// OWNER: voice agent. Placeholder; the owner replaces the body. Keep the export name and props stable.
export type VoiceConsoleProps = { facilityId?: string; mode?: "checkin" | "availability" };

export function VoiceConsole(_props: VoiceConsoleProps) {
  return <div data-stub="VoiceConsole" style={{ padding: 16, border: "1px dashed var(--line, #ccc)", fontSize: 12 }}>VoiceConsole (building…)</div>;
}
