"use client";
import { useDistrict } from "@/lib/district/store";
import { BriefingPanel } from "@/components/ai/BriefingPanel";
import { AskDistrict } from "@/components/ai/AskDistrict";
import { IndentDraft } from "@/components/ai/IndentDraft";
import { Panel } from "@/components/ui";
import { ViewHeader } from "./parts";

export function BriefingView() {
  const { state } = useDistrict();
  const f = state.facilities.find((x) => x.id === state.selectedFacilityId);
  return (
    <div className="view">
      <ViewHeader
        kicker="Written from the ledger, never from memory"
        title="Morning briefing"
        lede="What changed overnight, what needs a decision today, and what to raise with the state. Ask the district a question in plain language, or draft an indent for the district store."
      />
      <div className="grid-cc">
        <div className="stack">
          <BriefingPanel variant="full" />
        </div>
        <div className="stack">
          <Panel title="Ask the district" kicker="Answers cite the clinics and counts they used">
            <AskDistrict variant="panel" />
          </Panel>
          <Panel title="Indent draft" kicker={f ? `For ${f.name}` : "Consumption-based order"}>
            <IndentDraft facilityId={f?.id} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
