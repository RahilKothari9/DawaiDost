import type { Metadata, Viewport } from "next";
import { Noto_Sans_Devanagari } from "next/font/google";

const deva = Noto_Sans_Devanagari({ subsets: ["devanagari", "latin"], weight: ["400", "600", "700"], variable: "--font-deva", display: "swap" });

export const metadata: Metadata = {
  title: "Pharmacist app",
  description: "What a PHC pharmacist sees: weekly Hindi check-in, dispatch requests, receipt confirmation and district messages.",
};

export const viewport: Viewport = {
  themeColor: "#fbfaf6",
};

/** Full-viewport pharmacist surface; the shell renders /pharmacist bare (see components/shell/nav.ts BARE_PREFIXES). */
export default function PharmacistLayout({ children }: { children: React.ReactNode }) {
  return <div className={deva.variable}>{children}</div>;
}
