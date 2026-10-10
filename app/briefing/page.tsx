import type { Metadata } from "next";
import { BriefingView } from "@/components/views/BriefingView";

export const metadata: Metadata = { title: "Briefing", description: "The district morning brief, questions and indents." };

export default function Page() {
  return <BriefingView />;
}
