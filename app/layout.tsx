import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans, Instrument_Serif } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import "./tokens.css";
import "./globals.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dawai Dost · District medicine desk", template: "%s · Dawai Dost" },
  description: "Catch essential-medicine stockouts at rural clinics before patients do. Hindi voice check-ins, deterministic forecasts and the OpenAI Decisions API, with an officer approving every move.",
};

export const viewport: Viewport = {
  themeColor: "#f1eee6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
