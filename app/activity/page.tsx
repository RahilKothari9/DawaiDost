import type { Metadata } from "next";
import { ActivityView } from "@/components/views/ActivityView";

export const metadata: Metadata = { title: "Activity log", description: "The accountability record: who did what, and when." };

export default function Page() {
  return <ActivityView />;
}
