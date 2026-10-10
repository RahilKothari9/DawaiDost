"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { KpiStrip } from "@/components/analytics/KpiStrip";
import { DistrictMap } from "@/components/map/DistrictMap";
import { DecisionQueue } from "@/components/ai/DecisionQueue";
import { Button, Panel } from "@/components/ui";
import { StoryCard } from "./StoryCard";
import { HeroCount } from "./HeroCount";
import { ActivityFeed, DecisionMark } from "./parts";

export function CommandCenterView() {
  const { dispatch } = useDistrict();
  const router = useRouter();
  return (
    <div className="view">
      <HeroCount />

      <KpiStrip variant="full" />

      <div className="cc-grid">
        <StoryCard />
        <div className="cc-inbox-slot">
        <Panel
          className="cc-inbox"
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
        </Panel>
        </div>
        <Panel
          className="cc-map"
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
            height="100%"
            onSelectFacility={(id) => {
              dispatch({ type: "SELECT_FACILITY", facilityId: id });
              router.push("/map");
            }}
          />
        </Panel>
        <Panel title="Live activity" kicker="Reports, decisions and approvals as they happen">
          <ActivityFeed limit={8} />
        </Panel>
      </div>
    </div>
  );
}
