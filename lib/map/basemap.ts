// OWNER: map agent. Recolours the OpenFreeMap "positron" basemap into the warm-paper palette
// at runtime: mute roads and labels, tint land and water, drop clutter (POIs, buildings, shields).
import type { StyleSpecification } from "maplibre-gl";
import type { MapPalette } from "./palette";

export const BASEMAP_URL = "https://tiles.openfreemap.org/styles/positron";

type LayerSpec = StyleSpecification["layers"][number];

/** Pure transform of a style JSON, used via `transformStyle` so the first paint is already on-brand. */
export function restyleBasemap(style: StyleSpecification, p: MapPalette): StyleSpecification {
  const layers: LayerSpec[] = [];
  for (const src of style.layers) {
    const l = JSON.parse(JSON.stringify(src)) as LayerSpec & { paint?: Record<string, unknown>; layout?: Record<string, unknown> };
    const id = l.id;
    const hide = () => {
      l.layout = { ...(l.layout ?? {}), visibility: "none" };
    };
    l.paint = l.paint ?? {};
    if (l.type === "background") {
      l.paint["background-color"] = p.land;
    } else if (l.type === "fill") {
      if (id === "water") {
        l.paint["fill-color"] = p.water;
        l.paint["fill-opacity"] = 0.9;
      } else if (id === "park" || id.includes("wood")) {
        l.paint["fill-color"] = p.green;
        l.paint["fill-opacity"] = 0.55;
      } else if (id.includes("residential")) {
        l.paint["fill-color"] = p.surface2;
        l.paint["fill-opacity"] = 0.45;
      } else {
        hide();
      }
    } else if (l.type === "line") {
      if (id === "waterway") {
        l.paint["line-color"] = p.waterLine;
        l.paint["line-opacity"] = 0.8;
      } else if (id.startsWith("boundary")) {
        l.paint["line-color"] = p.lineStrong;
        l.paint["line-opacity"] = 0.6;
      } else if (id.includes("casing")) {
        hide();
      } else if (id.startsWith("highway_motorway") || id.startsWith("highway_major") || id.startsWith("tunnel_motorway")) {
        l.paint["line-color"] = p.roadMajor;
        l.paint["line-opacity"] = 0.9;
      } else if (id.startsWith("highway")) {
        l.paint["line-color"] = p.road;
        l.paint["line-opacity"] = 0.7;
      } else if (id.startsWith("railway") && !id.includes("dashline")) {
        l.paint["line-color"] = p.lineStrong;
        l.paint["line-opacity"] = 0.35;
      } else {
        hide();
      }
    } else if (l.type === "symbol") {
      l.layout = l.layout ?? {};
      if (id.startsWith("label_village") || id.startsWith("label_town") || id.startsWith("label_city")) {
        l.paint["text-color"] = p.label;
        l.paint["text-halo-color"] = p.land;
        l.paint["text-halo-width"] = 1.4;
        l.paint["text-opacity"] = id === "label_village" ? 0.6 : 0.85;
        // Hide the default town dot icons; our facilities own the foreground.
        delete l.layout["icon-image"];
      } else if (id.startsWith("water") || id.startsWith("waterway")) {
        l.paint["text-color"] = "#7d918d";
        l.paint["text-halo-color"] = p.land;
        l.paint["text-opacity"] = 0.8;
      } else if (id === "label_state") {
        l.paint["text-color"] = p.lineStrong;
        l.paint["text-halo-color"] = p.land;
      } else {
        hide();
      }
    } else if (l.type === "raster") {
      l.paint = { ...(l.paint ?? {}), "raster-opacity": 0.25 } as typeof l.paint;
    }
    layers.push(l as LayerSpec);
  }
  return { ...style, layers };
}
