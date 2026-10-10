// OWNER: map agent. Layer visibility model shared by both renderers and the overlay controls.
export type LayerVisibility = {
  transfers: boolean;
  opportunities: boolean;
  spokes: boolean;
  coverage: boolean;
  allMedicines: boolean;
};

export const DEFAULT_LAYERS: Record<"full" | "compact", LayerVisibility> = {
  full: { transfers: true, opportunities: true, spokes: false, coverage: true, allMedicines: true },
  compact: { transfers: true, opportunities: false, spokes: false, coverage: false, allMedicines: true },
};

export const LAYER_META: { key: keyof LayerVisibility; label: string; hint: string }[] = [
  { key: "transfers", label: "Transfers", hint: "Proposed, approved, moving and delivered consignments" },
  { key: "opportunities", label: "Opportunities", hint: "Safe surplus that could cover a gap — not yet proposed" },
  { key: "coverage", label: "Days-of-stock surface", hint: "Interpolated cover across the district for this medicine" },
  { key: "spokes", label: "Warehouse supply", hint: "Each facility linked to its supplying district store" },
  { key: "allMedicines", label: "All medicines' flows", hint: "Show transfers of other medicines, faded" },
];
