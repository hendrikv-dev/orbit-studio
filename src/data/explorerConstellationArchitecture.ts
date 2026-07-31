export interface ConstellationArchitectureShell {
  id: string;
  label: string;
  altitudeKm: number;
  inclinationDeg: number;
  planeCount: number;
  population: number;
  representativePlanes: number;
  raanOffsetDeg: number;
  planeSpacingDeg: number;
  color: string;
  geometrySource: "published-shell-definition" | "displayed-members";
  geometrySourceLabel: string;
  altitudeToleranceKm: number;
  inclinationToleranceDeg: number;
}

export interface ExplorerConstellationArchitecture {
  id: string;
  shortName: string;
  purpose: string;
  teachingSummary: string;
  orbitalClassification: string;
  operator: string;
  systemPopulation: number;
  semanticTerms: string[];
  shells: ConstellationArchitectureShell[];
}

export const explorerConstellationArchitectures: ExplorerConstellationArchitecture[] = [
  {
    id: "explorer-starlink-constellation",
    shortName: "Starlink",
    purpose: "Global broadband communications",
    teachingSummary:
      "Starlink divides a very large LEO population across several nearby altitude shells and inclination families. The shells spread capacity while serving different latitude bands.",
    orbitalClassification: "Multi-shell low Earth orbit network",
    operator: "SpaceX",
    systemPopulation: 7_500,
    semanticTerms: [
      "communications",
      "broadband",
      "internet",
      "telecommunications",
      "low earth orbit",
      "leo",
      "megaconstellation",
    ],
    shells: [
      {
        id: "starlink-53",
        label: "Primary 53° shell",
        altitudeKm: 550,
        inclinationDeg: 53,
        planeCount: 72,
        population: 1_584,
        representativePlanes: 2,
        raanOffsetDeg: 0,
        planeSpacingDeg: 5,
        color: "#68c5e8",
        geometrySource: "published-shell-definition",
        geometrySourceLabel: "Starlink first-generation shell definition",
        altitudeToleranceKm: 35,
        inclinationToleranceDeg: 0.3,
      },
      {
        id: "starlink-53-2",
        label: "53.2° capacity shell",
        altitudeKm: 540,
        inclinationDeg: 53.2,
        planeCount: 72,
        population: 1_584,
        representativePlanes: 2,
        raanOffsetDeg: 12,
        planeSpacingDeg: 5,
        color: "#9bbcf0",
        geometrySource: "published-shell-definition",
        geometrySourceLabel: "Starlink first-generation shell definition",
        altitudeToleranceKm: 35,
        inclinationToleranceDeg: 0.3,
      },
      {
        id: "starlink-70",
        label: "High-latitude 70° shell",
        altitudeKm: 570,
        inclinationDeg: 70,
        planeCount: 36,
        population: 720,
        representativePlanes: 2,
        raanOffsetDeg: 24,
        planeSpacingDeg: 5,
        color: "#7fd5b5",
        geometrySource: "published-shell-definition",
        geometrySourceLabel: "Starlink first-generation shell definition",
        altitudeToleranceKm: 40,
        inclinationToleranceDeg: 0.5,
      },
      {
        id: "starlink-polar",
        label: "Polar 97.6° shell",
        altitudeKm: 560,
        inclinationDeg: 97.6,
        planeCount: 6,
        population: 348,
        representativePlanes: 2,
        raanOffsetDeg: 42,
        planeSpacingDeg: 30,
        color: "#c2a4ed",
        geometrySource: "published-shell-definition",
        geometrySourceLabel: "Starlink first-generation shell definition",
        altitudeToleranceKm: 40,
        inclinationToleranceDeg: 0.5,
      },
    ],
  },
  {
    id: "explorer-gps-constellation",
    shortName: "GPS",
    purpose: "Global positioning, navigation, and timing",
    teachingSummary:
      "GPS uses six evenly spaced MEO planes. Its altitude gives each spacecraft a wide Earth view, allowing global coverage with a comparatively small population.",
    orbitalClassification: "Six-plane medium Earth orbit architecture",
    operator: "U.S. Space Force",
    systemPopulation: 31,
    semanticTerms: [
      "gps",
      "navigation",
      "positioning",
      "timing",
      "gnss",
      "location",
      "medium earth orbit",
      "meo",
    ],
    shells: [
      {
        id: "gps-meo",
        label: "Navigation MEO shell",
        altitudeKm: 20_180,
        inclinationDeg: 55,
        planeCount: 6,
        population: 31,
        representativePlanes: 6,
        raanOffsetDeg: 0,
        planeSpacingDeg: 60,
        color: "#74d6ad",
        geometrySource: "displayed-members",
        geometrySourceLabel: "Displayed GPS operational catalog members",
        altitudeToleranceKm: 80,
        inclinationToleranceDeg: 3.5,
      },
    ],
  },
  {
    id: "explorer-galileo-constellation",
    shortName: "Galileo",
    purpose: "European global navigation and timing",
    teachingSummary:
      "Galileo arranges its navigation spacecraft in three MEO planes at a slightly higher altitude than GPS. The sparse, symmetric geometry is designed for global ranging coverage.",
    orbitalClassification: "Three-plane medium Earth orbit architecture",
    operator: "European Union / ESA",
    systemPopulation: 30,
    semanticTerms: [
      "navigation",
      "positioning",
      "timing",
      "gnss",
      "europe",
      "medium earth orbit",
      "meo",
    ],
    shells: [
      {
        id: "galileo-meo",
        label: "Galileo MEO shell",
        altitudeKm: 23_222,
        inclinationDeg: 56,
        planeCount: 3,
        population: 30,
        representativePlanes: 3,
        raanOffsetDeg: 0,
        planeSpacingDeg: 120,
        color: "#e4bd76",
        geometrySource: "published-shell-definition",
        geometrySourceLabel: "Galileo nominal constellation definition",
        altitudeToleranceKm: 100,
        inclinationToleranceDeg: 1,
      },
    ],
  },
  {
    id: "explorer-oneweb-constellation",
    shortName: "OneWeb",
    purpose: "Global broadband communications",
    teachingSummary:
      "OneWeb uses a single high-inclination LEO shell with many evenly spaced polar planes. The near-polar architecture emphasizes consistent global and high-latitude coverage.",
    orbitalClassification: "Polar low Earth orbit shell",
    operator: "Eutelsat OneWeb",
    systemPopulation: 648,
    semanticTerms: [
      "communications",
      "broadband",
      "internet",
      "telecommunications",
      "polar",
      "low earth orbit",
      "leo",
    ],
    shells: [
      {
        id: "oneweb-polar",
        label: "Polar broadband shell",
        altitudeKm: 1_200,
        inclinationDeg: 87.9,
        planeCount: 12,
        population: 648,
        representativePlanes: 4,
        raanOffsetDeg: 8,
        planeSpacingDeg: 15,
        color: "#b2a2e8",
        geometrySource: "displayed-members",
        geometrySourceLabel: "Displayed OneWeb catalog members",
        altitudeToleranceKm: 50,
        inclinationToleranceDeg: 0.3,
      },
    ],
  },
  {
    id: "explorer-iridium-constellation",
    shortName: "Iridium",
    purpose: "Global mobile satellite communications",
    teachingSummary:
      "Iridium uses six near-polar LEO planes with tightly coordinated spacing. Cross-linked spacecraft form a compact global communications mesh.",
    orbitalClassification: "Six-plane polar low Earth orbit network",
    operator: "Iridium Communications",
    systemPopulation: 66,
    semanticTerms: [
      "communications",
      "mobile",
      "voice",
      "telecommunications",
      "polar",
      "crosslink",
      "low earth orbit",
      "leo",
    ],
    shells: [
      {
        id: "iridium-polar",
        label: "Iridium polar shell",
        altitudeKm: 780,
        inclinationDeg: 86.4,
        planeCount: 6,
        population: 66,
        representativePlanes: 6,
        raanOffsetDeg: 15,
        planeSpacingDeg: 30,
        color: "#9fc5de",
        geometrySource: "published-shell-definition",
        geometrySourceLabel: "Iridium nominal constellation definition",
        altitudeToleranceKm: 50,
        inclinationToleranceDeg: 0.5,
      },
    ],
  },
  {
    id: "explorer-noaa-constellation",
    shortName: "NOAA",
    purpose: "Weather forecasting and environmental monitoring",
    teachingSummary:
      "NOAA combines polar environmental spacecraft with geostationary observatories. Together they trade global daily coverage for continuous regional weather monitoring.",
    orbitalClassification: "Mixed weather-observation architecture",
    operator: "NOAA",
    systemPopulation: 18,
    semanticTerms: [
      "weather",
      "meteorology",
      "climate",
      "environment",
      "environmental monitoring",
      "earth observation",
      "forecasting",
    ],
    shells: [
      {
        id: "noaa-polar",
        label: "Polar environmental shell",
        altitudeKm: 830,
        inclinationDeg: 98.7,
        planeCount: 4,
        population: 12,
        representativePlanes: 4,
        raanOffsetDeg: 0,
        planeSpacingDeg: 45,
        color: "#72cbd0",
        geometrySource: "published-shell-definition",
        geometrySourceLabel: "NOAA polar reference family",
        altitudeToleranceKm: 120,
        inclinationToleranceDeg: 1.5,
      },
      {
        id: "noaa-geo",
        label: "Geostationary weather ring",
        altitudeKm: 35_786,
        inclinationDeg: 0.1,
        planeCount: 1,
        population: 6,
        representativePlanes: 1,
        raanOffsetDeg: 0,
        planeSpacingDeg: 360,
        color: "#7aa9e6",
        geometrySource: "published-shell-definition",
        geometrySourceLabel: "NOAA geostationary reference family",
        altitudeToleranceKm: 200,
        inclinationToleranceDeg: 2,
      },
    ],
  },
  {
    id: "explorer-sentinel-constellation",
    shortName: "Sentinel",
    purpose: "Earth observation for the Copernicus programme",
    teachingSummary:
      "Sentinel missions use several coordinated orbit families rather than one uniform shell. Their geometry is optimized for repeatable Earth observation and environmental measurement.",
    orbitalClassification: "Coordinated Earth-observation orbit families",
    operator: "ESA / European Commission",
    systemPopulation: 14,
    semanticTerms: [
      "earth observation",
      "remote sensing",
      "copernicus",
      "environment",
      "climate",
      "mapping",
      "radar",
    ],
    shells: [
      {
        id: "sentinel-polar",
        label: "Sun-synchronous observation family",
        altitudeKm: 786,
        inclinationDeg: 98.6,
        planeCount: 4,
        population: 14,
        representativePlanes: 4,
        raanOffsetDeg: 18,
        planeSpacingDeg: 45,
        color: "#a8cf83",
        geometrySource: "published-shell-definition",
        geometrySourceLabel: "Copernicus Sentinel reference family",
        altitudeToleranceKm: 100,
        inclinationToleranceDeg: 1.5,
      },
    ],
  },
];

const architectureById = new Map(
  explorerConstellationArchitectures.map((architecture) => [architecture.id, architecture]),
);

export function explorerConstellationArchitectureFor(
  constellationId: string,
): ExplorerConstellationArchitecture | undefined {
  return architectureById.get(constellationId);
}

export function explorerConstellationSemanticTerms(constellationId: string): string[] {
  return explorerConstellationArchitectureFor(constellationId)?.semanticTerms ?? [];
}
