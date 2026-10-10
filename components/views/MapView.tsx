"use client";
import { useCallback, useState } from "react";
import { useDistrict } from "@/lib/district/store";
import { DistrictMap } from "@/components/map/DistrictMap";
import { FacilityDetail } from "@/components/analytics/FacilityDetail";
import { Drawer } from "@/components/ui";
import { ViewHeader } from "./parts";

export function MapView() {
  const { state, dispatch, assessments } = useDistrict();
  const [open, setOpen] = useState(false);
  const facility = state.facilities.find((f) => f.id === state.selectedFacilityId) ?? null;
  const close = useCallback(() => setOpen(false), []);
  const urgent = new Set(assessments.filter((a) => a.risk === "stockout" || a.risk === "critical").map((a) => a.facilityId)).size;

  return (
    <div className="view">
      <ViewHeader
        kicker={`${state.facilities.length} facilities across ${new Set(state.facilities.map((f) => f.block)).size} blocks`}
        title="District map"
        lede={`${urgent} ${urgent === 1 ? "clinic is" : "clinics are"} below lead time for at least one medicine. Select a clinic to see its shelf, its forecast and what the Decisions API recommended.`}
      />
      <div className="mapview__frame">
        <DistrictMap
          variant="full"
          height="calc(100dvh - var(--topbar-h) - 210px)"
          onSelectFacility={(id) => {
            dispatch({ type: "SELECT_FACILITY", facilityId: id });
            setOpen(true);
          }}
        />
      </div>
      <Drawer
        open={open && !!facility}
        onClose={close}
        modeless
        width={480}
        title={facility?.name ?? ""}
        subtitle={facility ? `${facility.type} · ${facility.block} block · pharmacist ${facility.pharmacist.name}` : undefined}
      >
        {facility ? <FacilityDetail facilityId={facility.id} /> : null}
      </Drawer>
    </div>
  );
}
