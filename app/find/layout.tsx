import type { Metadata, Viewport } from "next";
import { Noto_Sans_Devanagari } from "next/font/google";
import type { ReactNode } from "react";

// Hindi-first public page: a Devanagari face so Hindi renders the same on every phone and laptop.
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-noto-deva", display: "swap" });

export const metadata: Metadata = {
  title: "दवा कहाँ मिलेगी? · Find medicine",
  description: "Is my medicine in stock at a nearby health centre today? Hindi-first lookup for patients and ASHA workers. Demo data.",
};

export const viewport: Viewport = { themeColor: "#f1eee6", width: "device-width", initialScale: 1 };

/** /find is a public surface: the shell renders it bare (no officer rail), this layout only adds the Hindi font. */
export default function FindLayout({ children }: { children: ReactNode }) {
  return <div className={deva.variable}>{children}</div>;
}
