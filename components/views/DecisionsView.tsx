"use client";
import { useDistrict } from "@/lib/district/store";
import { DecisionQueue } from "@/components/ai/DecisionQueue";
import { DecisionCard } from "@/components/ai/DecisionCard";
import { ApiStatusPill } from "@/components/shell/TopBar";
import { ACTION_LABEL, ACTION_ORDER, ACTION_WHEN } from "@/components/shell/format";
import { EmptyState, Panel } from "@/components/ui";
import { DecisionMark, ViewHeader } from "./parts";

export function DecisionsView() {
  const { state } = useDistrict();
  const total = state.decisions.length;
  const counts = ACTION_ORDER.map((a) => state.decisions.filter((d) => d.action === a).length);
  const live = state.decisions.filter((d) => d.source === "live").length;
  const pending = state.decisions.filter((d) => d.status === "pending").length;
  const f = state.facilities.find((x) => x.id === state.selectedFacilityId);
  const m = state.medicines.find((x) => x.id === state.selectedMedicineId);

  return (
    <div className="view">
      <ViewHeader
        kicker={<DecisionMark label="OpenAI Decisions API" />}
        title="Four moves. One choice. Your call."
        lede="For every at-risk shelf, code builds a facts-only snapshot and the Decisions API chooses exactly one of four district actions, with a probability for each. It cannot invent a fifth action or a stock number. Nothing happens until you approve."
        actions={<ApiStatusPill verbose />}
      />

      <div className="choices" role="list" aria-label="The four actions the Decisions API can choose">
        {ACTION_ORDER.map((a, i) => (
          <div className="choice" role="listitem" key={a}>
            <span className="choice__n">0{i + 1}</span>
            <span className="choice__name">{ACTION_LABEL[a]}</span>
            <code className="choice__code">{a}</code>
            <p className="choice__when">{ACTION_WHEN[a]}</p>
            <div className="choice__share" title={`${counts[i]} of ${total} recommendations`}>
              <span className="choice__bar"><i style={{ width: total ? `${(counts[i] / total) * 100}%` : 0 }} /></span>
              <span className="num">{counts[i]}</span>
            </div>
          </div>
        ))}
      </div>

      <Panel tone="sunken">
        <div className="semantics">
          <p><b>Probabilities sum to one</b>The API returns a probability for each of the four actions. A 0.82 transfer and a 0.41 transfer are different conversations.</p>
          <p><b>Confidence is the chosen action&apos;s share</b>Low confidence or a close second is a signal to look at the evidence, or ask for a recount first.</p>
          <p><b>Live or fallback, always labeled</b>{total ? `${live} of ${total} recommendations came from the live API. ` : ""}Without a key, a deterministic fallback from the same stock rules answers, and says so.</p>
        </div>
      </Panel>

      <div className="decisions-layout">
        <Panel title="Queue" kicker={`${pending} waiting · ${total} total`} flush>
          <DecisionQueue variant="full" />
        </Panel>
        <div className="sticky-col">
          {f && m ? (
            <DecisionCard key={`${f.id}-${m.id}`} facilityId={f.id} medicineId={m.id} />
          ) : (
            <EmptyState title="Pick a recommendation">Select an item in the queue to see the evidence, the four probabilities and the approval controls.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
