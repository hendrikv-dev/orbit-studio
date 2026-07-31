import { beforeAll, describe, expect, it } from "vitest";
import type { SatelliteModel } from "../lib/scenario";
import { propagateSatellite } from "../lib/propagation";
import {
  keplerianToCartesian,
  prepareTwoBodyPropagation,
  propagateKeplerian,
  propagatePreparedTwoBodyAtMs,
} from "../physics/kepler";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { tleToCartesian, type TleData } from "../physics/tle";
import {
  createExplorerScenario,
  currentExplorerSnapshot,
} from "../data/explorerCatalog";
import { eciToThreeVector } from "./coordinates";
import { writeInterpolatedThreePositions } from "./catalogMotion";
import {
  CATALOG_INTERPOLATION_SEGMENT_MS,
  CATALOG_INITIAL_WORKER_LATENCY_MS,
  CATALOG_MAX_WORKER_COUNT,
  CATALOG_REQUEST_LEAD_SEGMENTS,
  CATALOG_SUPPORTED_MAX_TIME_SCALE,
  catalogPropagationHorizonDisposition,
  catalogPropagationHorizonCovers,
  catalogPropagationHorizonNeedsRefresh,
  catalogPropagationHorizonTimestamps,
  catalogPropagationInputsEqual,
  catalogPropagationWorkerCount,
  propagateCatalogHorizon,
  propagateCatalogWindow,
} from "./catalogPropagation";
import {
  normalizedOrbitPathSampleCount,
  propagatedThreePosition,
  samplePropagatedOrbitPath,
} from "./orbitPathSampling";

const VALLADO_VANGUARD_TLE: TleData = {
  name: "VANGUARD 1",
  line1: "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
  line2: "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667",
};

function distance(left: readonly number[], right: readonly number[]): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

describe("catalog population propagation", () => {
  let satellites: SatelliteModel[];
  let representativeSatellites: SatelliteModel[];

  beforeAll(() => {
    satellites = createExplorerScenario(currentExplorerSnapshot).satellites;
    const altitudeKm = (satellite: SatelliteModel) =>
      satellite.keplerian.semiMajorAxisKm - EARTH_RADIUS_KM;
    representativeSatellites = [
      satellites.find((satellite) => satellite.id === "explorer-iss"),
      satellites.find((satellite) => satellite.id === "explorer-hubble"),
      satellites.find(
        (satellite) => satellite.catalogMetadata?.categoryId === "rocket-bodies",
      ),
      satellites.find(
        (satellite) => satellite.catalogMetadata?.categoryId === "debris",
      ),
      satellites.find(
        (satellite) => altitudeKm(satellite) > 15_000 && altitudeKm(satellite) < 30_000,
      ),
      satellites.find(
        (satellite) => Math.abs(altitudeKm(satellite) - 35_786) < 2_000,
      ),
    ].filter((satellite): satellite is SatelliteModel => Boolean(satellite));
    expect(satellites).toHaveLength(33_474);
    expect(representativeSatellites).toHaveLength(6);
  });

  it("matches the independently published Vallado/Python-SGP4 Vanguard example", () => {
    const computed = tleToCartesian(
      VALLADO_VANGUARD_TLE,
      new Date("2000-06-29T12:50:19.000Z"),
    );
    const referencePositionKm = [
      5576.056952400586,
      -3999.371134576452,
      -1521.9571594376037,
    ];
    const referenceVelocityKmS = [
      4.772627303379319,
      5.119817120959591,
      4.275553909172126,
    ];

    expect(distance(computed.positionKm, referencePositionKm)).toBeLessThan(0.01);
    expect(distance(computed.velocityKmS, referenceVelocityKmS)).toBeLessThan(0.00001);
  });

  it("keeps a cross-class release population sample on the same authoritative batch path", () => {
    for (const satellite of representativeSatellites) {
      expect(satellite).toBeDefined();
      expect(satellite.propagationMode).toBe("two-body");
      expect(satellite.tle).toBeUndefined();
      const epochMs = Date.parse(satellite.keplerian.epoch);
      const endMs = epochMs + 160_000;
      const exactStart = propagateSatellite(satellite, new Date(epochMs));
      const exactEnd = propagateSatellite(satellite, new Date(endMs));
      const batch = propagateCatalogWindow([satellite], epochMs, endMs);

      expect(batch.valid[0]).toBe(1);
      expect(distance(batch.startPositions, exactStart.positionKm)).toBeLessThan(0.002);
      expect(distance(batch.startVelocities, exactStart.velocityKmS)).toBeLessThan(0.000002);
      expect(distance(batch.endPositions, exactEnd.positionKm)).toBeLessThan(0.002);
      expect(distance(batch.endVelocities, exactEnd.velocityKmS)).toBeLessThan(0.000002);
    }
  });

  it("keeps prepared worker propagation equivalent to the unprepared Keplerian composition", () => {
    for (const satellite of representativeSatellites) {
      const prepared = prepareTwoBodyPropagation(satellite.keplerian);
      for (const offsetMs of [0, 240_000, 5_000_000]) {
        const targetMs = Date.parse(satellite.keplerian.epoch) + offsetMs;
        const preparedState = propagatePreparedTwoBodyAtMs(prepared, targetMs);
        const referenceState = keplerianToCartesian(
          propagateKeplerian(satellite.keplerian, new Date(targetMs)),
        );
        expect(
          distance(preparedState.positionKm, referenceState.positionKm),
        ).toBeLessThan(1e-9);
        expect(
          distance(preparedState.velocityKmS, referenceState.velocityKmS),
        ).toBeLessThan(1e-12);
      }
    }
  });

  it("maps selected and unselected markers into the same shared scene frame", () => {
    for (const satellite of representativeSatellites) {
      const startMs = Date.parse(satellite.keplerian.epoch);
      const endMs = startMs + 160_000;
      const targetMs = startMs + 80_000;
      const batch = propagateCatalogWindow([satellite], startMs, endMs);
      const rendered = new Float32Array(3);
      writeInterpolatedThreePositions(
        rendered,
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
      const exactState = propagateSatellite(satellite, new Date(targetMs));
      const selectedScenePosition = eciToThreeVector(exactState.positionKm);

      expect(
        distance(rendered, selectedScenePosition.toArray()),
      ).toBeLessThan(0.08);
    }
  });

  it("keeps predictive horizon interpolation on the exact propagation path", () => {
    for (const satellite of representativeSatellites) {
      const centerMs = Date.parse(satellite.keplerian.epoch) + 1_000_000;
      const sampleTimestampsMs = catalogPropagationHorizonTimestamps(centerMs, 2_500, 48);
      const horizon = propagateCatalogHorizon([satellite], sampleTimestampsMs);
      expect(horizon.valid[0]).toBe(1);

      for (let segment = 0; segment < sampleTimestampsMs.length - 1; segment += 1) {
        for (const ratio of [0.25, 0.5, 0.75]) {
          const targetMs = sampleTimestampsMs[segment] +
            CATALOG_INTERPOLATION_SEGMENT_MS * ratio;
          const rendered = new Float32Array(3);
          const startOffset = segment * 3;
          const endOffset = startOffset + 3;
          writeInterpolatedThreePositions(
            rendered,
            0,
            horizon.positions.subarray(startOffset, startOffset + 3),
            horizon.velocities.subarray(startOffset, startOffset + 3),
            horizon.positions.subarray(endOffset, endOffset + 3),
            horizon.velocities.subarray(endOffset, endOffset + 3),
            horizon.valid,
            sampleTimestampsMs[segment],
            sampleTimestampsMs[segment + 1],
            targetMs,
          );
          const exact = eciToThreeVector(
            propagateSatellite(satellite, new Date(targetMs)).positionKm,
          );
          expect(distance(rendered, exact.toArray())).toBeLessThan(0.12);
        }
      }
    }
  });

  it("predicts a horizon that contains worker completion at every supported speed", () => {
    const startMs = Date.parse("2026-07-18T12:00:00.000Z");
    for (const speed of [1, 10, 100, 1_000, 2_500]) {
      const estimatedLatencyMs = 300;
      const timestamps = catalogPropagationHorizonTimestamps(
        startMs,
        speed,
        estimatedLatencyMs,
      );
      const completionMs = startMs + speed * estimatedLatencyMs;
      expect(startMs).toBeGreaterThanOrEqual(timestamps[0]);
      expect(completionMs).toBeGreaterThanOrEqual(timestamps[0]);
      expect(completionMs).toBeLessThanOrEqual(timestamps[timestamps.length - 1]);
      for (let index = 1; index < timestamps.length; index += 1) {
        expect(timestamps[index] - timestamps[index - 1]).toBe(
          CATALOG_INTERPOLATION_SEGMENT_MS,
        );
      }
    }
  });

  it("reserves main-thread capacity for full-population interpolation and GPU commits", () => {
    expect(catalogPropagationWorkerCount(33_474, 8)).toBe(3);
    expect(catalogPropagationWorkerCount(33_474, 16)).toBe(
      CATALOG_MAX_WORKER_COUNT,
    );
    expect(catalogPropagationWorkerCount(1_024, 8)).toBe(2);
    expect(catalogPropagationWorkerCount(33_474, 2)).toBe(1);
    expect(catalogPropagationWorkerCount(33_474, Number.NaN)).toBe(2);
  });

  it("prewarms one horizon for direct transitions across every Explorer speed", () => {
    const startMs = Date.parse("2026-07-18T12:00:00.000Z");
    const timestamps = catalogPropagationHorizonTimestamps(
      startMs,
      CATALOG_SUPPORTED_MAX_TIME_SCALE,
      CATALOG_INITIAL_WORKER_LATENCY_MS,
    );
    for (const speed of [1, 10, 100, 1_000, 2_500]) {
      expect(
        catalogPropagationHorizonNeedsRefresh(
          timestamps,
          startMs,
          speed,
          CATALOG_INITIAL_WORKER_LATENCY_MS,
        ),
      ).toBe(false);
    }
  });

  it("expands a cold-start horizon without increasing interpolation segment length", () => {
    const startMs = Date.parse("2026-07-18T12:00:00.000Z");
    const timestamps = catalogPropagationHorizonTimestamps(
      startMs,
      2_500,
      CATALOG_INITIAL_WORKER_LATENCY_MS,
    );
    const coldCompletionMs =
      startMs + 2_500 * CATALOG_INITIAL_WORKER_LATENCY_MS;

    expect(timestamps[0]).toBeLessThanOrEqual(startMs);
    expect(timestamps[timestamps.length - 1]).toBeGreaterThan(
      coldCompletionMs,
    );
    expect(timestamps.length).toBeGreaterThan(5);
    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index] - timestamps[index - 1]).toBe(
        CATALOG_INTERPOLATION_SEGMENT_MS,
      );
    }
  });

  it("treats propagation horizon boundaries as renderable overlap", () => {
    const timestamps = Float64Array.from([1_000, 2_000, 3_000]);
    expect(catalogPropagationHorizonCovers(timestamps, 1_000)).toBe(true);
    expect(catalogPropagationHorizonCovers(timestamps, 2_500)).toBe(true);
    expect(catalogPropagationHorizonCovers(timestamps, 3_000)).toBe(true);
    expect(catalogPropagationHorizonCovers(timestamps, 999)).toBe(false);
    expect(catalogPropagationHorizonCovers(timestamps, 3_001)).toBe(false);
    expect(catalogPropagationHorizonCovers(null, 2_000)).toBe(false);
  });

  it("activates only covering horizons and never replaces them with expired work", () => {
    expect(
      catalogPropagationHorizonDisposition(
        Float64Array.from([1_000, 4_000]),
        Float64Array.from([2_500, 3_500, 4_500]),
        3_250,
      ),
    ).toBe("activate");
    expect(
      catalogPropagationHorizonDisposition(
        Float64Array.from([1_000, 3_000]),
        Float64Array.from([3_500, 4_500, 5_500]),
        2_500,
      ),
    ).toBe("stage");
    expect(
      catalogPropagationHorizonDisposition(
        Float64Array.from([1_000, 3_000]),
        Float64Array.from([0, 500, 1_000]),
        2_500,
      ),
    ).toBe("discard");
    expect(
      catalogPropagationHorizonDisposition(
        Float64Array.from([4_000, 5_000]),
        Float64Array.from([3_500, 4_500, 5_500]),
        2_500,
      ),
    ).toBe("discard");
  });

  it("discards a staged future horizon after an authoritative backward reset", () => {
    expect(
      catalogPropagationHorizonDisposition(
        Float64Array.from([10_000, 20_000]),
        Float64Array.from([18_000, 28_000]),
        5_000,
      ),
    ).toBe("discard");
  });

  it("reuses worker inputs only when orbital authority is unchanged", () => {
    const source = representativeSatellites[0];
    const cloned = {
      ...source,
      keplerian: { ...source.keplerian },
      tle: source.tle ? { ...source.tle } : undefined,
    };
    expect(catalogPropagationInputsEqual(source, cloned)).toBe(true);
    const twoBodySource = {
      ...cloned,
      propagationMode: "two-body" as const,
      tle: undefined,
    };
    expect(
      catalogPropagationInputsEqual(twoBodySource, {
        ...twoBodySource,
        keplerian: {
          ...twoBodySource.keplerian,
          epoch: new Date(
            Date.parse(twoBodySource.keplerian.epoch) + 1_000,
          ).toISOString(),
        },
      }),
    ).toBe(false);

    if (source.tle) {
      expect(
        catalogPropagationInputsEqual(source, {
          ...cloned,
          tle: { ...source.tle, line2: `${source.tle.line2} ` },
        }),
      ).toBe(false);
    }
  });

  it("refreshes only when measured latency reaches the active horizon runway", () => {
    const playbackMs = 1_000_000;
    const speed = 2_500;
    const latencyMs = 100;
    const requiredEndMs =
      playbackMs +
      speed * latencyMs +
      CATALOG_REQUEST_LEAD_SEGMENTS * CATALOG_INTERPOLATION_SEGMENT_MS;

    expect(
      catalogPropagationHorizonNeedsRefresh(
        Float64Array.from([playbackMs - 1, requiredEndMs]),
        playbackMs,
        speed,
        latencyMs,
      ),
    ).toBe(false);
    expect(
      catalogPropagationHorizonNeedsRefresh(
        Float64Array.from([playbackMs - 1, requiredEndMs - 1]),
        playbackMs,
        speed,
        latencyMs,
      ),
    ).toBe(true);
    expect(
      catalogPropagationHorizonNeedsRefresh(
        Float64Array.from([playbackMs + 1, requiredEndMs + 1]),
        playbackMs,
        speed,
        latencyMs,
      ),
    ).toBe(true);
  });

  it("keeps each marker on the exact center sample of its displayed orbit path", () => {
    for (const satellite of representativeSatellites) {
      const date = new Date(satellite.keplerian.epoch);
      const sampleCount = normalizedOrbitPathSampleCount(48);
      const path = samplePropagatedOrbitPath(satellite, date, sampleCount);
      const marker = propagatedThreePosition(satellite, date);
      expect(path[sampleCount / 2].distanceTo(marker)).toBeLessThan(1e-9);
    }
  });

  it("updates the cross-class population sample for stepping and freezes at a fixed timestamp", () => {
    for (const satellite of representativeSatellites) {
      const startMs = Date.parse(satellite.keplerian.epoch);
      const start = propagateSatellite(satellite, new Date(startMs));
      const paused = propagateSatellite(satellite, new Date(startMs));
      const stepped = propagateSatellite(satellite, new Date(startMs + 10_000));
      expect(distance(start.positionKm, paused.positionKm)).toBe(0);
      expect(distance(start.positionKm, stepped.positionKm)).toBeGreaterThan(0.01);
    }
  });

  it("marks unsupported physical states invalid so the renderer can omit them", () => {
    const satellite = representativeSatellites[0];
    const invalid = propagateCatalogWindow(
      [{
        propagationMode: "sgp4",
        keplerian: satellite.keplerian,
        tle: { name: "invalid", line1: "", line2: "" },
      }],
      Date.parse(satellite.keplerian.epoch),
      Date.parse(satellite.keplerian.epoch) + 1_000,
    );

    expect(invalid.valid[0]).toBe(0);
  });
});
