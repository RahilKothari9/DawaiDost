"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { KpiStrip } from "@/components/analytics/KpiStrip";
import { DistrictMap } from "@/components/map/DistrictMap";
import { DecisionQueue } from "@/components/ai/DecisionQueue";
import { Button, Panel } from "@/components/ui";
import { fmtClock } from "@/components/shell/format";
import { StoryCard } from "./StoryCard";
import { ActivityFeed, DecisionMark } from "./parts";

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export function CommandCenterView() {
  const { state, assessments, dispatch } = useDistrict();
  const router = useRouter();
  const urgent = new Set(assessments.filter((a) => a.risk === "stockout" || a.risk === "critical").map((a) => a.facilityId));
  const pending = state.decisions.filter((d) => d.status === "pending").length;
  const n = urgent.size;
  const word = NUMBER_WORDS[n] ?? String(n);
  const { day } = fmtClock(state.now);
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date(state.now)));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="view">
      <header className="cc-head">
        <h1 className="cc-head__title">
          {n === 0 ? "Every clinic is covered until resupply arrives." : `${word} ${n === 1 ? "clinic runs" : "clinics run"} out before resupply can reach ${n === 1 ? "it" : "them"}.`}
        </h1>
        <div className="cc-head__meta">
          <span>
            {greeting}, <strong>{state.district.officer.name}</strong>
          </span>
          <span>{day} · {state.district.name} district</span>
          <Link href="/decisions">
            <DecisionMark label={pending ? `${pending} recommendation${pending === 1 ? "" : "s"} waiting for you` : "AI inbox is clear"} />
          </Link>
        </div>
      </header>

      <KpiStrip variant="full" />

      <div className="grid-cc">
        <div className="stack">
          <StoryCard />
          <Panel
            title="District map"
            kicker="Clinics by risk, with medicine on the move"
            flush
            actions={
              <Link href="/map">
                <Button size="sm" variant="ghost" trailing={<ArrowRight size={14} />}>Full map</Button>
              </Link>
            }
          >
            <DistrictMap
              variant="compact"
              height={440}
              onSelectFacility={(id) => {
                dispatch({ type: "SELECT_FACILITY", facilityId: id });
                router.push("/map");
              }}
            />
          </Panel>
        </div>

        <div className="stack">
          <Panel
            tone="decision"
            kicker={<DecisionMark label="Decisions API" />}
            title="AI inbox"
            actions={
              <Link href="/decisions">
                <Button size="sm" variant="ghost" trailing={<ArrowRight size={14} />}>All decisions</Button>
              </Link>
            }
          >
            <DecisionQueue variant="compact" />
            <p className="inbox-note">Each item is one bounded choice from four district actions. Nothing moves until you approve it.</p>
          </Panel>
          <Panel title="Live activity" kicker="Reports, decisions and approvals as they happen">
            <ActivityFeed limit={9} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
