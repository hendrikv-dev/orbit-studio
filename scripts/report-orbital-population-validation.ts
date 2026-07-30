import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import type { SatelliteModel } from "../src/lib/scenario";
import { propagateSatellite } from "../src/lib/propagation";
import { EARTH_RADIUS_KM } from "../src/physics/constants";
import { tleToCartesian, type TleData } from "../src/physics/tle";
import {
  createExplorerScenario,
  currentExplorerSnapshot,
} from "../src/data/explorerCatalog";
import { eciToThreeVector } from "../src/rendering/coordinates";
import { writeInterpolatedThreePositions } from "../src/rendering/catalogMotion";
import { propagateCatalogWindow } from "../src/rendering/catalogPropagation";

const outputDirectory = resolve("evidence/orbital-population/reports");

const vanguardTle: TleData = {
  name: "VANGUARD 1",
  line1: "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
  line2: "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667",
};

function distance(left: ArrayLike<number>, right: ArrayLike<number>): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function sampleRecords(satellites: SatelliteModel[]) {
  const selected = new Set<string>();
  const take = (
    label: string,
    predicate: (satellite: SatelliteModel) => boolean,
  ): readonly [string, SatelliteModel] => {
    const satellite = satellites.find(
      (candidate) => !selected.has(candidate.id) && predicate(candidate),
    );
    if (!satellite) {
      throw new Error(`Release population validation could not select ${label}.`);
    }
    selected.add(satellite.id);
    return [label, satellite] as const;
  };

  return [
    take("ISS reconstructed state", (satellite) => satellite.id === "explorer-iss"),
    take("Hubble reconstructed state", (satellite) => satellite.id === "explorer-hubble"),
    take(
      "payload reconstructed state",
      (satellite) => satellite.catalogMetadata?.categoryId === "payloads",
    ),
    take(
      "rocket-body reconstructed state",
      (satellite) => satellite.catalogMetadata?.categoryId === "rocket-bodies",
    ),
    take(
      "debris reconstructed state",
      (satellite) => satellite.catalogMetadata?.categoryId === "debris",
    ),
    take(
      "medium-Earth-orbit reconstructed state",
      (satellite) => {
        const altitudeKm = satellite.keplerian.semiMajorAxisKm - EARTH_RADIUS_KM;
        return altitudeKm > 15_000 && altitudeKm < 30_000;
      },
    ),
  ] as const;
}

const scenario = createExplorerScenario(currentExplorerSnapshot);
const samples = sampleRecords(scenario.satellites);
const comparisons = samples.map(([label, satellite]) => {
  const startMs = Date.parse(satellite.keplerian.epoch);
  const endMs = startMs + 160_000;
  const targetMs = startMs + 80_000;
  const exact = propagateSatellite(satellite, new Date(targetMs));
  const batch = propagateCatalogWindow([satellite], startMs, endMs);
  const interpolatedScene = new Float32Array(3);
  writeInterpolatedThreePositions(
    interpolatedScene,
    0,
    batch.startPositions,
    batch.startVelocities,
    batch.endPositions,
    batch.endVelocities,
    batch.valid,
    startMs,
    endMs,
    targetMs,
  );
  const exactScene = eciToThreeVector(exact.positionKm).toArray();

  return {
    label,
    id: satellite.id,
    catalogNumber: satellite.catalogMetadata?.catalogNumber,
    category: satellite.catalogMetadata?.categoryId,
    sourceEpoch: satellite.keplerian.epoch,
    testTimestamp: new Date(targetMs).toISOString(),
    sourceFrame:
      "GCAT orbital-envelope constraints with deterministic educational orientation and phase",
    orbitStateProvenance: satellite.catalogMetadata?.orbitStateProvenance,
    applicationPositionKm: exact.positionKm,
    applicationVelocityKmS: exact.velocityKmS,
    batchInterpolationScenePositionKm: [...interpolatedScene],
    exactScenePositionKm: exactScene,
    selectedUnselectedSceneErrorKm: distance(interpolatedScene, exactScene),
    acceptedSelectedUnselectedToleranceKm: 0.08,
    pass: distance(interpolatedScene, exactScene) < 0.08,
    validationKind: "same-model path agreement; not an independent real-world ephemeris",
  };
});

const vanguardComputed = tleToCartesian(
  vanguardTle,
  new Date("2000-06-29T12:50:19.000Z"),
);
const vanguardReferencePositionKm = [
  5576.056952400586,
  -3999.371134576452,
  -1521.9571594376037,
];
const vanguardReferenceVelocityKmS = [
  4.772627303379319,
  5.119817120959591,
  4.275553909172126,
];

const propagationSatellites = scenario.satellites.map((satellite) => ({
  propagationMode: satellite.propagationMode,
  keplerian: satellite.keplerian,
  tle: satellite.tle,
}));
const performanceDurationsMs: number[] = [];
for (let run = 0; run < 3; run += 1) {
  const startedAt = performance.now();
  propagateCatalogWindow(
    propagationSatellites,
    Date.parse(currentExplorerSnapshot.timestampIso),
    Date.parse(currentExplorerSnapshot.timestampIso) + 120_000,
  );
  performanceDurationsMs.push(performance.now() - startedAt);
}

const report = {
  generatedAtUtc: new Date().toISOString(),
  catalogSnapshotUtc: currentExplorerSnapshot.timestampIso,
  visiblePhysicalObjectCount: scenario.satellites.length,
  independentModelVerification: {
    object: "Vanguard 1 / NORAD 00005",
    source: "Vallado AIAA-2006-6753 example as reproduced by the independent Python-SGP4 package metadata bundled with satellite.js",
    timestamp: "2000-06-29T12:50:19.000Z",
    referencePositionKm: vanguardReferencePositionKm,
    computedPositionKm: vanguardComputed.positionKm,
    positionErrorKm: distance(vanguardReferencePositionKm, vanguardComputed.positionKm),
    acceptedPositionToleranceKm: 0.01,
    referenceVelocityKmS: vanguardReferenceVelocityKmS,
    computedVelocityKmS: vanguardComputed.velocityKmS,
    velocityErrorKmS: distance(vanguardReferenceVelocityKmS, vanguardComputed.velocityKmS),
    acceptedVelocityToleranceKmS: 0.00001,
  },
  releasePopulationPathComparisons: comparisons,
  performance: {
    execution:
      "single-threaded Node reference for two exact two-body samples per release-safe reconstructed catalog object; browser uses up to eight workers",
    objectCount: scenario.satellites.length,
    durationMs: performanceDurationsMs,
    averageDurationMs: performanceDurationsMs.reduce((sum, value) => sum + value, 0) / performanceDurationsMs.length,
    configuredWorkerCountMaximum: 8,
    configuredCadenceBySpeed: {
      "1x": 80,
      "10x": 80,
      "100x": 80,
      "1000x": 40,
      "2500x": 16,
    },
    comparisonInterpolationWindowSimulationSeconds: 160,
  },
  limitations: [
    "Release-population comparisons prove worker/selected/orbit-path implementation agreement, not independent measured ephemerides.",
    "The public release membership is the complete supported-class Earth population in the dated GCAT package snapshot; reconstructed positions are neither live nor exact.",
    "The independent Vanguard vector proves named-model SGP4 conformance only.",
  ],
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  resolve(outputDirectory, "numerical-comparison.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(
  resolve(outputDirectory, "performance.json"),
  `${JSON.stringify(report.performance, null, 2)}\n`,
);

console.log(JSON.stringify(report, null, 2));
