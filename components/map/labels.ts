// OWNER: map agent. Label text/visibility rules shared by the WebGL and SVG renderers.
import type { MapFacility, MapFlow } from "@/lib/map/model";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** HTML for a quantity pill at an arc midpoint. */
export function flowLabelText(f: MapFlow, unitShort: string): string {
  const q = f.quantity.toLocaleString("en-IN");
  const u = escapeHtml(unitShort);
  switch (f.status) {
    case "delivered":
      return `<span aria-hidden="true">&#10003;</span> ${q}`;
    case "opportunity":
      return `+${q} <small>${u}</small>`;
    case "in_transit":
      return `<i></i>${q} <small>${u}</small>`;
    default:
      return `${q} <small>${u}</small>`;
  }
}

export function facilityLabelVisible(f: MapFacility, selectedId: string | null, variant: "full" | "compact"): boolean {
  if (f.id === selectedId) return true;
  if (variant === "compact") return f.risk === "stockout";
  return f.type === "WAREHOUSE" || f.type === "DH" || f.risk === "stockout" || f.risk === "critical";
}

/** Short unit for pills: "strip of 10 tablets" -> "strips". */
export function shortUnit(unit: string | undefined): string {
  if (!unit) return "units";
  const first = unit.trim().split(/\s+/)[0].toLowerCase();
  if (!first) return "units";
  if (first.endsWith("s")) return first;
  if (/(x|ch|sh)$/.test(first)) return `${first}es`;
  if (/[^aeiou]y$/.test(first)) return `${first.slice(0, -1)}ies`;
  return `${first}s`;
}
