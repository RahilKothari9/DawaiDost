import type { Metadata } from "next";
import { DecisionsView } from "@/components/views/DecisionsView";

export const metadata: Metadata = { title: "Decisions", description: "OpenAI Decisions API recommendations waiting for officer approval." };

export default function Page() {
  return <DecisionsView />;
}
