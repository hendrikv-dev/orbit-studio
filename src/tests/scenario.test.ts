import { describe, expect, it } from 'vitest';
import { createDefaultScenario } from '../scenario/sample';
import { parseScenarioJson, serializeScenario, validateScenario } from '../scenario/schema';

describe('scenario serialization', () => {
  it('serializes and validates the default scenario', () => {
    const scenario = createDefaultScenario();
    const parsed = parseScenarioJson(serializeScenario(scenario));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.scenario.satellites).toHaveLength(1);
      expect(parsed.scenario.satellites[0].propagationMode).toBe('two-body');
    }
  });

  it('rejects malformed JSON', () => {
    const parsed = parseScenarioJson('{broken');

    expect(parsed.ok).toBe(false);
  });

  it('reports missing scenario fields', () => {
    const result = validateScenario({ scenarioName: 'Nope' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes('appVersion'))).toBe(true);
      expect(result.errors.some((error) => error.includes('satellites'))).toBe(true);
    }
  });
});
