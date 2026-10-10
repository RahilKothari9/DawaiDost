import type { Metadata } from "next";
import { MapView } from "@/components/views/MapView";

export const metadata: Metadata = { title: "District map", description: "Every clinic in the district, colored by medicine risk." };

export default function Page() {
  return <MapView />;
}
