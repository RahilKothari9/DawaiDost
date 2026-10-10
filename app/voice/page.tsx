import type { Metadata } from "next";
import { VoiceView } from "@/components/views/VoiceView";

export const metadata: Metadata = { title: "Voice check-ins", description: "Weekly Hindi stock calls with PHC pharmacists over the Realtime API." };

export default function Page() {
  return <VoiceView />;
}
