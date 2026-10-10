"use client";
import { useState } from "react";
import { useDistrict } from "@/lib/district/store";
import { CheckinRoster } from "@/components/voice/CheckinRoster";
import { VoiceConsole } from "@/components/voice/VoiceConsole";
import { Panel, Tabs } from "@/components/ui";
import { ViewHeader } from "./parts";

type Mode = "checkin" | "availability";

export function VoiceView() {
  const { state, dispatch } = useDistrict();
  const [mode, setMode] = useState<Mode>("checkin");
  const facility = state.facilities.find((f) => f.id === state.selectedFacilityId) ?? null;

  return (
    <div className="view">
      <ViewHeader
        kicker="OpenAI Realtime API · Hindi over WebRTC"
        title="Voice check-ins"
        lede="Each week the pharmacist answers one short call in Hindi. No form, no app. The count is extracted, checked against last week's ledger and expected use, and a recount is requested when the numbers do not agree."
        actions={
          <Tabs<Mode>
            label="Call type"
            value={mode}
            onChange={setMode}
            items={[
              { value: "checkin", label: "Weekly stock check-in" },
              { value: "availability", label: "Patient availability line" },
            ]}
          />
        }
      />
      <div className="grid-cc">
        <Panel title="This week's calls" kicker="Who has reported, who is overdue" flush>
          <CheckinRoster
            onStartCall={(id) => {
              dispatch({ type: "SELECT_FACILITY", facilityId: id });
              setMode("checkin");
            }}
          />
        </Panel>
        <div className="sticky-col">
          <VoiceConsole key={`${facility?.id ?? "none"}-${mode}`} facilityId={facility?.id} mode={mode} />
        </div>
      </div>
    </div>
  );
}
