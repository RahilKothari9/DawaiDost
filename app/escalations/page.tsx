import type { Metadata } from "next";
import { EscalationsView } from "@/components/escalations/EscalationsView";

export const metadata: Metadata = {
  title: "Escalations",
  description: "Supply gaps the district cannot close locally, raised to the state with evidence.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ medicine?: string | string[] }> }) {
  const { medicine } = await searchParams;
  return <EscalationsView initialMedicineId={typeof medicine === "string" ? medicine : undefined} />;
}
