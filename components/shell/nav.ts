import { Boxes, FlaskConical, Info, LayoutDashboard, Map, Mic, Newspaper, ScrollText, SearchCheck, Siren, Smartphone, Sparkles, Truck, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  description: string;
  group: "operate" | "analyse" | "record" | "surfaces";
  /** Opens a surface that renders without the officer chrome. */
  external?: boolean;
  /** Show on the compact mobile tab bar. */
  primary?: boolean;
};

export const NAV: NavItem[] = [
  { href: "/", label: "Command center", short: "Today", icon: LayoutDashboard, group: "operate", primary: true, description: "Today's risks, the AI inbox and the live district picture" },
  { href: "/decisions", label: "Decisions", short: "Decide", icon: Sparkles, group: "operate", primary: true, description: "Every Decisions API recommendation, with probabilities, waiting for you" },
  { href: "/map", label: "District map", short: "Map", icon: Map, group: "operate", primary: true, description: "Every clinic in the district, by risk" },
  { href: "/transfers", label: "Transfers", short: "Moves", icon: Truck, group: "operate", primary: true, description: "Medicine moving between clinics, from proposal to delivery" },
  { href: "/escalations", label: "Escalations", short: "Escalate", icon: Siren, group: "operate", description: "Gaps the district cannot close locally, raised to the state with evidence" },
  { href: "/voice", label: "Voice check-ins", short: "Voice", icon: Mic, group: "operate", description: "Weekly Hindi stock calls with pharmacists" },
  { href: "/stock", label: "Stock & forecast", short: "Stock", icon: Boxes, group: "analyse", description: "Days of stock for every clinic and medicine" },
  { href: "/briefing", label: "Briefing", short: "Brief", icon: Newspaper, group: "analyse", description: "The district brief, questions and indents" },
  { href: "/evals", label: "Decision evals", short: "Evals", icon: FlaskConical, group: "analyse", description: "How well the Decisions API picks the right action on known cases" },
  { href: "/activity", label: "Activity log", short: "Log", icon: ScrollText, group: "record", description: "Who did what, and when" },
  { href: "/about", label: "How it works", short: "About", icon: Info, group: "record", description: "The loop, the four actions and the research" },
  { href: "/pharmacist", label: "Pharmacist app", short: "Pharmacist", icon: Smartphone, group: "surfaces", external: true, description: "What the PHC pharmacist sees on their phone" },
  { href: "/find", label: "Find medicine", short: "Find", icon: SearchCheck, group: "surfaces", external: true, description: "Public lookup: is my medicine in stock nearby?" },
];

/** Routes that render full-page, without the officer rail and top bar. */
export const BARE_PREFIXES = ["/pharmacist", "/find"];

export function isBare(pathname: string) {
  return BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const NAV_GROUPS: { id: NavItem["group"]; label: string }[] = [
  { id: "operate", label: "Operate" },
  { id: "analyse", label: "Analyse" },
  { id: "record", label: "Record" },
  { id: "surfaces", label: "Other surfaces" },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
