// OWNER: find agent. One icon per illness group, so people who read little can still scan the list.
import { Bandage, Droplet, GlassWater, HeartPulse, Pill, Thermometer, Wind, Baby, CircleCheck, CircleAlert, CircleX, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import { MEDICINE_WORDS, type ConditionId } from "@/lib/find/lexicon";
import type { Band } from "@/lib/find/answer";

export const CONDITION_ICON: Record<ConditionId, LucideIcon> = {
  sugar: Droplet, bp: HeartPulse, fever: Thermometer, iron: Baby, diarrhoea: GlassWater, infection: Bandage, breathing: Wind,
};

export function medicineIcon(id: string): LucideIcon {
  const c = MEDICINE_WORDS[id]?.conditions[0];
  return c ? CONDITION_ICON[c] : Pill;
}

export const BAND_ICON: Record<Band, LucideIcon> = { available: CircleCheck, low: CircleAlert, out: CircleX };

export function MedicineIcon({ id, size = 22 }: { id: string; size?: number }) {
  return createElement(medicineIcon(id), { size, "aria-hidden": true });
}
