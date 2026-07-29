import type { Satellite, ScenarioState } from '../state/types';

export type ImportResult =
  | {
      ok: true;
      scenario: ScenarioState;
    }
  | {
      ok: false;
      errors: string[];
    };

export const createScenarioDocument = (input: {
  scenarioName: string;
  simulationEpoch: string;
  currentTimeMs: number;
  timeScale: number;
  playing: boolean;
  renderSettings: ScenarioState['renderSettings'];
  cameraPreset: ScenarioState['cameraSettings']['preset'];
  satellites: Satellite[];
}): ScenarioState => ({
  appVersion: '0.1.0',
  scenarioName: input.scenarioName,
  simulationEpoch: input.simulationEpoch,
  currentTime: new Date(input.currentTimeMs).toISOString(),
  timeScale: input.timeScale,
  renderSettings: input.renderSettings,
  cameraSettings: {
    preset: input.cameraPreset,
    followSatelliteId: null,
  },
  satellites: input.satellites,
  selectedSatelliteId: input.satellites[0]?.id ?? null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isValidDateString = (value: unknown): value is string => isString(value) && Number.isFinite(Date.parse(value));

const validateSatellite = (value: unknown, index: number): string[] => {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return [`Satellite ${index + 1} must be an object.`];
  }

  const requiredStringFields = ['id', 'name', 'color', 'propagationMode', 'editorMode'] as const;
  for (const field of requiredStringFields) {
    if (!isString(value[field])) {
      errors.push(`Satellite ${index + 1} is missing ${field}.`);
    }
  }

  if (!isRecord(value.keplerian)) {
    errors.push(`Satellite ${index + 1} is missing Keplerian elements.`);
  } else {
    const keplerianFields = [
      'semiMajorAxisKm',
      'eccentricity',
      'inclinationDeg',
      'raanDeg',
      'argPeriapsisDeg',
      'trueAnomalyDeg',
    ] as const;
    for (const field of keplerianFields) {
      if (!isFiniteNumber(value.keplerian[field])) {
        errors.push(`Satellite ${index + 1} has an invalid ${field}.`);
      }
    }
    if (!isValidDateString(value.keplerian.epoch)) {
      errors.push(`Satellite ${index + 1} has an invalid Keplerian epoch.`);
    }
  }

  if (!isRecord(value.cartesian) || !isRecord(value.cartesian.positionKm) || !isRecord(value.cartesian.velocityKmS)) {
    errors.push(`Satellite ${index + 1} is missing Cartesian state.`);
  }

  if (!isRecord(value.tle) || !isString(value.tle.name) || !isString(value.tle.line1) || !isString(value.tle.line2)) {
    errors.push(`Satellite ${index + 1} has invalid TLE data.`);
  }

  return errors;
};

export const validateScenario = (value: unknown): ImportResult => {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ['Scenario JSON must be an object.'] };
  }

  if (!isString(value.appVersion)) {
    errors.push('Scenario is missing appVersion.');
  }

  if (!isString(value.scenarioName)) {
    errors.push('Scenario is missing scenarioName.');
  }

  if (!isValidDateString(value.simulationEpoch)) {
    errors.push('Scenario has an invalid simulationEpoch.');
  }

  if (!isValidDateString(value.currentTime)) {
    errors.push('Scenario has an invalid currentTime.');
  }

  if (!isFiniteNumber(value.timeScale)) {
    errors.push('Scenario has an invalid timeScale.');
  }

  if (!isRecord(value.renderSettings)) {
    errors.push('Scenario is missing renderSettings.');
  }

  if (!isRecord(value.cameraSettings)) {
    errors.push('Scenario is missing cameraSettings.');
  }

  if (!Array.isArray(value.satellites)) {
    errors.push('Scenario satellites must be an array.');
  } else {
    value.satellites.forEach((satellite, index) => {
      errors.push(...validateSatellite(satellite, index));
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const scenario = value as ScenarioState;
  const selectedSatelliteId =
    scenario.selectedSatelliteId && scenario.satellites.some((satellite) => satellite.id === scenario.selectedSatelliteId)
      ? scenario.selectedSatelliteId
      : scenario.satellites[0]?.id ?? null;

  return {
    ok: true,
    scenario: {
      ...scenario,
      selectedSatelliteId,
      satellites: scenario.satellites as Satellite[],
    },
  };
};

export const serializeScenario = (scenario: ScenarioState): string =>
  JSON.stringify(
    {
      appVersion: scenario.appVersion,
      scenarioName: scenario.scenarioName,
      simulationEpoch: scenario.simulationEpoch,
      currentTime: scenario.currentTime,
      timeScale: scenario.timeScale,
      renderSettings: scenario.renderSettings,
      cameraSettings: scenario.cameraSettings,
      satellites: scenario.satellites,
      selectedSatelliteId: scenario.selectedSatelliteId,
    },
    null,
    2,
  );

export const parseScenarioJson = (json: string): ImportResult => {
  try {
    return validateScenario(JSON.parse(json));
  } catch {
    return { ok: false, errors: ['Scenario file is not valid JSON.'] };
  }
};
