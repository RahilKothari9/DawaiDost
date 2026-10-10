import type { Metadata } from "next";
import { TransfersView } from "@/components/views/TransfersView";

export const metadata: Metadata = { title: "Transfers", description: "Medicine moving between clinics, from proposal to delivery." };

export default function Page() {
  return <TransfersView />;
}
