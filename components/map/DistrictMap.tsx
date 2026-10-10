"use client";
// OWNER: map agent. Placeholder; the owner replaces the body. Keep the export name and props stable.
export type DistrictMapProps = { height?: number | string; variant?: "full" | "compact"; onSelectFacility?: (facilityId: string) => void };

export function DistrictMap(_props: DistrictMapProps) {
  return <div data-stub="DistrictMap" style={{ padding: 16, border: "1px dashed var(--line, #ccc)", fontSize: 12 }}>DistrictMap (building…)</div>;
}
