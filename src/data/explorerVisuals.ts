import type { ExplorerCatalogEntry, ExplorerCategoryId } from "./explorerCatalog";

export type ExplorerColorMode = "type" | "constellation" | "white";
export type ExplorerFocusPreset =
  | "object"
  | "orbit"
  | "constellation"
  | "leo"
  | "meo"
  | "geo"
  | "earth-orbit";
export type ExplorerMarkerKind =
  | "satellite"
  | "debris"
  | "rocket-body"
  | "component"
  | "ground-station";

export interface ExplorerMarkerStyle {
  color: string;
  emphasis?: number;
  kind: ExplorerMarkerKind;
}

export const explorerTypeColors: Record<ExplorerCategoryId, string> = {
  payloads: "#68c9ff",
  "rocket-bodies": "#f1b45f",
  components: "#d59be7",
  debris: "#ff7d72",
  "ground-stations": "#77e0a2",
  constellations: "#b39cff",
  missions: "#d8c4ff",
  concepts: "#91d4ff",
};

export function explorerMarkerKind(entry: ExplorerCatalogEntry): ExplorerMarkerKind {
  if (entry.categoryId === "debris") return "debris";
  if (entry.categoryId === "rocket-bodies") return "rocket-body";
  if (entry.categoryId === "components") return "component";
  if (entry.categoryId === "ground-stations") return "ground-station";
  return "satellite";
}

export function explorerMarkerStyle(
  entry: ExplorerCatalogEntry,
  colorMode: ExplorerColorMode,
  constellationColors: ReadonlyMap<string, string>,
): ExplorerMarkerStyle {
  const color =
    colorMode === "white"
      ? "#f4f7fa"
      : colorMode === "constellation"
        ? entry.constellationId
          ? constellationColors.get(entry.constellationId) ?? "#8794a3"
          : "#25313c"
        : explorerTypeColors[entry.categoryId];

  return { color, kind: explorerMarkerKind(entry) };
}
