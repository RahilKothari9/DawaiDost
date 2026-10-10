"use client";
import { useDistrict } from "@/lib/district/store";
import { CheckinRoster } from "@/components/voice/CheckinRoster";
import { VoiceConsole } from "@/components/voice/VoiceConsole";
import { ViewHeader } from "./parts";

export function VoiceView() {
  const { state, dispatch } = useDistrict();
  const facility = state.facilities.find((f) => f.id === state.selectedFacilityId) ?? null;

  return (
    <div className="view">
      <ViewHeader
        kicker="OpenAI Realtime API · Hindi over WebRTC"
        title="Voice check-ins"
        lede="Each week the pharmacist answers one short call in Hindi. No form, no app. The count is extracted, checked against last week's ledger and expected use, and a recount is requested when the numbers do not agree."
      />
      <div className="grid-voice">
        <CheckinRoster onStartCall={(id) => dispatch({ type: "SELECT_FACILITY", facilityId: id })} />
        <div className="sticky-col">
          <VoiceConsole facilityId={facility?.id} mode="checkin" />
        </div>
      </div>
    </div>
  );
}
