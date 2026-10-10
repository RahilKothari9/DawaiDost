"use client";
// OWNER: data agent. React context store for the whole dashboard. Public API: DistrictProvider, useDistrict.
import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { createInitialState } from "./data";
import { assessDistrict } from "./engine";
import type { DistrictAction, DistrictState, StockAssessment } from "./types";

export function districtReducer(state: DistrictState, action: DistrictAction): DistrictState {
  switch (action.type) {
    case "SELECT_FACILITY": return { ...state, selectedFacilityId: action.facilityId };
    case "SELECT_MEDICINE": return { ...state, selectedMedicineId: action.medicineId };
    case "ADD_DECISION": return { ...state, decisions: [action.decision, ...state.decisions] };
    case "ADD_TIMELINE": return { ...state, timeline: [action.event, ...state.timeline] };
    case "RESET": return createInitialState();
    default: return state;
  }
}

type DistrictContextValue = {
  state: DistrictState;
  dispatch: (action: DistrictAction) => void;
  assessments: StockAssessment[];
  getAssessment: (facilityId: string, medicineId: string) => StockAssessment | undefined;
};

const DistrictContext = createContext<DistrictContextValue | null>(null);

export function DistrictProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(districtReducer, undefined, createInitialState);
  const value = useMemo(() => {
    const assessments = assessDistrict(state);
    return { state, dispatch, assessments, getAssessment: (f: string, m: string) => assessments.find((a) => a.facilityId === f && a.medicineId === m) };
  }, [state]);
  return <DistrictContext.Provider value={value}>{children}</DistrictContext.Provider>;
}

export function useDistrict(): DistrictContextValue {
  const ctx = useContext(DistrictContext);
  if (!ctx) throw new Error("useDistrict must be used inside <DistrictProvider>");
  return ctx;
}
