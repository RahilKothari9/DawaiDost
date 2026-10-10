"use client";
import { useMemo } from "react";
import { useDistrict } from "@/lib/district/store";
import type { Facility, Medicine } from "@/lib/district/types";

/** Id → entity lookups over the current district state. */
export function useLookups() {
  const { state } = useDistrict();
  return useMemo(() => {
    const fac = new Map<string, Facility>(state.facilities.map((f) => [f.id, f]));
    const med = new Map<string, Medicine>(state.medicines.map((m) => [m.id, m]));
    return {
      facility: (id?: string | null) => (id ? fac.get(id) : undefined),
      medicine: (id?: string | null) => (id ? med.get(id) : undefined),
      facilityName: (id?: string | null) => (id ? fac.get(id)?.name ?? id : "—"),
      medicineName: (id?: string | null) => {
        const m = id ? med.get(id) : undefined;
        return m ? `${m.name} ${m.strength}` : id ?? "—";
      },
    };
  }, [state.facilities, state.medicines]);
}
