import type { Metadata } from "next";
import { AboutView } from "@/components/views/AboutView";

export const metadata: Metadata = { title: "How it works", description: "The loop, the four actions, the research and the OpenAI stack." };

export default function Page() {
  return <AboutView />;
}
