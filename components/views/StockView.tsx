"use client";
import { useDistrict } from "@/lib/district/store";
import { StockHeatmap } from "@/components/analytics/StockHeatmap";
import { ForecastChart } from "@/components/analytics/ForecastChart";
import { DistrictTrends } from "@/components/analytics/DistrictTrends";
import { Panel } from "@/components/ui";
import { ViewHeader } from "./parts";

export function StockView() {
  const { state, dispatch } = useDistrict();
  const f = state.facilities.find((x) => x.id === state.selectedFacilityId) ?? state.facilities[0];
  const m = state.medicines.find((x) => x.id === state.selectedMedicineId) ?? state.medicines[0];

  return (
    <div className="view">
      <ViewHeader
        kicker={`${state.medicines.length} tracer medicines · ${state.facilities.length} facilities`}
        title="Stock and forecast"
        lede="Days of stock for every clinic and medicine, calculated in code from the last verified count and average daily use. A shelf is at risk when it will empty before resupply plus a safety buffer can arrive."
      />

      <Panel title="Days of stock" kicker="Select a cell to forecast that shelf" flush>
        <StockHeatmap
          onSelect={(facilityId, medicineId) => {
            dispatch({ type: "SELECT_FACILITY", facilityId });
            dispatch({ type: "SELECT_MEDICINE", medicineId });
          }}
        />
      </Panel>

      <div className="grid-2">
        <Panel title={f && m ? `${f.name} · ${m.name} ${m.strength}` : "Forecast"} kicker="Projected shelf, next weeks">
          {f && m ? <ForecastChart facilityId={f.id} medicineId={m.id} height={280} /> : null}
        </Panel>
        <Panel title={m ? `${m.name} across the district` : "District trends"} kicker="Weekly closing stock and dispensing">
          <DistrictTrends medicineId={m?.id} />
        </Panel>
      </div>
    </div>
  );
}
