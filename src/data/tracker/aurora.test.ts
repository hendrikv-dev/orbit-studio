import { describe, expect, it } from "vitest";
import {
  assessAurora,
  auroraFreshness,
  auroraHorizonFor,
  auroraProbabilityAt,
  auroraRankingStrength,
  compassWord,
  kpNear,
  parseAuroraGrid,
  parseCurrentKp,
  parseKpForecast,
  stormScaleFor,
  strongestNearby,
  type AuroraConditions,
} from "./aurora";

/**
 * Aurora is the one phenomenon Tracker cannot compute, so the tests are mostly
 * about refusal: what the product must decline to say, and when.
 *
 * The parsing tests exist because the shape of NOAA's products is the one part
 * of this that can silently change under us. Everything else asserts that a
 * horizon is respected.
 */

const NOW = new Date("2026-08-21T08:00:00Z");

function gridBody(
  cells: [number, number, number][],
  observation = "2026-08-21T07:59:00Z",
  forecast = "2026-08-21T08:55:00Z",
) {
  return {
    "Observation Time": observation,
    "Forecast Time": forecast,
    "Data Format": "[Longitude, Latitude, Aurora]",
    coordinates: cells,
  };
}

/** A whole `AuroraConditions`, so the freshness cases read as one line each. */
function conditionsWith(
  cells: [number, number, number][],
  observation: string,
  forecast: string,
  currentKp: number | null = 4.3,
): AuroraConditions {
  return {
    grid: parseAuroraGrid(gridBody(cells, observation, forecast)),
    currentKp,
    kpForecast: [],
    fetchedAtUtc: NOW.toISOString(),
    source: {
      id: "noaa-swpc",
      name: "n",
      attribution: "a",
      cost: "public-no-fee",
      coverage: "global",
    },
    failures: [],
  };
}

describe("the OVATION grid", () => {
  it("indexes NOAA's longitude/latitude/probability triples", () => {
    const grid = parseAuroraGrid(gridBody([[212, 65, 37], [0, -90, 5]]));
    // NOAA publishes eastward longitudes 0–359; a western observer arrives as a
    // negative number and must land in the same cell.
    expect(auroraProbabilityAt(grid, 65, -148)).toBe(37);
    expect(auroraProbabilityAt(grid, -90, 0)).toBe(5);
  });

  it("reports zero rather than undefined where NOAA sent no cell", () => {
    const grid = parseAuroraGrid(gridBody([[212, 65, 37]]));
    expect(auroraProbabilityAt(grid, 10, 10)).toBe(0);
  });

  it("refuses a body with no grid or no issue time", () => {
    expect(() => parseAuroraGrid({ coordinates: [] })).toThrow();
    expect(() => parseAuroraGrid({ coordinates: [[0, 0, 1]] })).toThrow(/issue time/i);
  });
});

describe("finding a better place nearby", () => {
  const grid = parseAuroraGrid(
    gridBody([
      [212, 62, 4],
      [212, 65, 40],
      [212, 66, 45],
    ]),
  );

  it("offers a candidate only where the gain is worth the journey", () => {
    const found = strongestNearby(grid, 62, -148, 500, 15);
    expect(found).not.toBeNull();
    expect(found!.probabilityPercent).toBeGreaterThanOrEqual(40);
    expect(found!.distanceKm).toBeLessThanOrEqual(500);
  });

  it("stays silent where nothing near is meaningfully better", () => {
    // Everywhere in range is within the gain threshold of here, so "drive
    // north" would be advice with nothing behind it.
    expect(strongestNearby(grid, 65, -148, 200, 15)).toBeNull();
  });

  it("names a direction a person can act on", () => {
    expect(compassWord(0)).toBe("north");
    expect(compassWord(90)).toBe("east");
    expect(compassWord(315)).toBe("north-west");
  });
});

describe("the planetary K-index", () => {
  it("parses the published forecast rows", () => {
    const points = parseKpForecast([
      { time_tag: "2026-08-21T09:00:00", kp: 5.33, observed: "predicted" },
      { time_tag: "2026-08-21T12:00:00", kp: 2, observed: "observed" },
      { nonsense: true },
    ]);
    expect(points).toHaveLength(2);
    expect(points[0].kp).toBeCloseTo(5.33);
    expect(points[1].observed).toBe("observed");
  });

  it("reads the most recent estimate for the current index", () => {
    expect(
      parseCurrentKp([
        { time_tag: "a", estimated_kp: 2.1 },
        { time_tag: "b", estimated_kp: 4.7 },
      ]),
    ).toBeCloseTo(4.7);
    expect(parseCurrentKp([])).toBeNull();
  });

  it("does not stretch a three-hour bin across the night", () => {
    const points = parseKpForecast([
      { time_tag: "2026-08-21T09:00:00", kp: 6, observed: "predicted" },
    ]);
    expect(kpNear(points, "2026-08-21T10:00:00Z")).not.toBeNull();
    expect(kpNear(points, "2026-08-21T18:00:00Z")).toBeNull();
  });

  it("names the storm scale only at storm level", () => {
    expect(stormScaleFor(4.9)).toBeNull();
    expect(stormScaleFor(5)?.level).toBe(1);
    expect(stormScaleFor(8.1)?.level).toBe(4);
  });
});

describe("which product may speak", () => {
  it("uses the nowcast only for the next couple of hours", () => {
    expect(auroraHorizonFor("2026-08-21T08:30:00Z", NOW)).toBe("nowcast");
    expect(auroraHorizonFor("2026-08-22T08:00:00Z", NOW)).toBe("short-range");
    expect(auroraHorizonFor("2026-09-10T08:00:00Z", NOW)).toBe("beyond-forecast");
  });
});

describe("what Tracker will say about aurora", () => {
  const conditions: AuroraConditions = {
    grid: parseAuroraGrid(gridBody([[212, 65, 34]])),
    currentKp: 4.3,
    kpForecast: parseKpForecast([
      { time_tag: "2026-08-22T06:00:00", kp: 6, observed: "predicted" },
    ]),
    fetchedAtUtc: NOW.toISOString(),
    source: {
      id: "noaa-swpc",
      name: "n",
      attribution: "a",
      cost: "public-no-fee",
      coverage: "global",
    },
    failures: [],
  };

  it("quotes NOAA's own probability inside the nowcast horizon", () => {
    const assessment = assessAurora(conditions, 65, -148, "2026-08-21T08:20:00Z", NOW);
    expect(assessment.horizon).toBe("nowcast");
    expect(assessment.probabilityPercent).toBe(34);
    expect(assessment.statement).toMatch(/34%/);
    expect(assessment.outlook).toBe("plausible-tonight");
  });

  it("drops to the K-index, and says nothing spatial, a day out", () => {
    const assessment = assessAurora(conditions, 65, -148, "2026-08-22T06:00:00Z", NOW);
    expect(assessment.horizon).toBe("short-range");
    expect(assessment.probabilityPercent).toBeNull();
    expect(assessment.kp).toBeCloseTo(6);
    expect(assessment.certainty).toMatch(/not where the oval will sit/i);
  });

  it("refuses entirely beyond the forecast horizon", () => {
    const assessment = assessAurora(conditions, 65, -148, "2026-09-15T06:00:00Z", NOW);
    expect(assessment.outlook).toBe("unknown");
    expect(assessment.probabilityPercent).toBeNull();
    expect(assessment.kp).toBeNull();
    expect(assessment.statement).toMatch(/too far ahead/i);
  });

  it("never invents a probability when the grid is missing", () => {
    const assessment = assessAurora(
      { ...conditions, grid: null },
      65,
      -148,
      "2026-08-21T08:20:00Z",
      NOW,
    );
    expect(assessment.probabilityPercent).toBeNull();
    expect(assessment.outlook).toBe("unknown");
  });

});

/**
 * The freshness matrix.
 *
 * A nowcast carries its own expiry — the forecast time it is predicting for —
 * so these states are read off the product rather than chosen. The defect being
 * regressed is specific: an expired grid used to keep its probability, its
 * outlook and its ranking weight, and merely gained a warning sentence
 * underneath an otherwise confident recommendation.
 */
describe("aurora freshness", () => {
  const cells: [number, number, number][] = [[212, 65, 34]];

  it("classifies against the grid's own forecast time", () => {
    // Valid until 08:55; now is 08:00.
    expect(auroraFreshness(parseAuroraGrid(gridBody(cells)), NOW)).toBe("fresh");
    // Expired 10 minutes ago: inside the grace period.
    expect(
      auroraFreshness(
        parseAuroraGrid(gridBody(cells, "2026-08-21T07:20:00Z", "2026-08-21T07:50:00Z")),
        NOW,
      ),
    ).toBe("aging");
    // Expired well over an hour ago.
    expect(
      auroraFreshness(
        parseAuroraGrid(gridBody(cells, "2026-08-21T05:30:00Z", "2026-08-21T06:00:00Z")),
        NOW,
      ),
    ).toBe("stale");
    expect(auroraFreshness(null, NOW)).toBe("unavailable");
  });

  it("keeps a fresh grid actionable", () => {
    const assessment = assessAurora(
      conditionsWith(cells, "2026-08-21T07:59:00Z", "2026-08-21T08:55:00Z"),
      65,
      -148,
      "2026-08-21T08:20:00Z",
      NOW,
    );
    expect(assessment.freshness).toBe("fresh");
    expect(assessment.probabilityPercent).toBe(34);
    expect(assessment.outlook).toBe("plausible-tonight");
  });

  it("shows an ageing grid but says it has expired", () => {
    const assessment = assessAurora(
      conditionsWith(cells, "2026-08-21T07:20:00Z", "2026-08-21T07:50:00Z"),
      65,
      -148,
      "2026-08-21T08:20:00Z",
      NOW,
    );
    expect(assessment.freshness).toBe("aging");
    expect(assessment.probabilityPercent).toBe(34);
    expect(assessment.certainty).toMatch(/expired/i);
  });

  it("stops concluding from a stale grid entirely", () => {
    const assessment = assessAurora(
      conditionsWith(cells, "2026-08-21T05:30:00Z", "2026-08-21T06:00:00Z"),
      65,
      -148,
      "2026-08-21T08:20:00Z",
      NOW,
    );
    expect(assessment.freshness).toBe("stale");
    // The judgement is withdrawn, not qualified.
    expect(assessment.outlook).toBe("unknown");
    expect(assessment.probabilityPercent).toBeNull();
    expect(assessment.nearby).toBeNull();
    expect(assessment.statement).toMatch(/unavailable/i);
    // What NOAA last said survives, for transparency, in its own field.
    expect(assessment.reportedProbabilityPercent).toBe(34);
  });

  it("gives a stale grid no ranking weight at all", () => {
    const stale = assessAurora(
      conditionsWith(cells, "2026-08-21T05:30:00Z", "2026-08-21T06:00:00Z"),
      65,
      -148,
      "2026-08-21T08:20:00Z",
      NOW,
    );
    const fresh = assessAurora(
      conditionsWith(cells, "2026-08-21T07:59:00Z", "2026-08-21T08:55:00Z"),
      65,
      -148,
      "2026-08-21T08:20:00Z",
      NOW,
    );
    expect(auroraRankingStrength(stale).strength).toBe(0);
    expect(auroraRankingStrength(fresh).strength).toBeGreaterThan(0.2);
  });

  it("reports the interval the nowcast actually covers", () => {
    const assessment = assessAurora(
      conditionsWith(cells, "2026-08-21T07:59:00Z", "2026-08-21T08:55:00Z"),
      65,
      -148,
      "2026-08-21T08:20:00Z",
      NOW,
    );
    expect(assessment.validity).toEqual({
      fromUtc: "2026-08-21T07:59:00.000Z",
      toUtc: "2026-08-21T08:55:00.000Z",
    });
    // Under an hour: the thing that must never be stretched across a night.
    const minutes =
      (Date.parse(assessment.validity!.toUtc) - Date.parse(assessment.validity!.fromUtc)) / 60_000;
    expect(minutes).toBeLessThanOrEqual(120);
  });
});

/**
 * The ranking transformation is Tracker's, and is tested as Tracker's.
 *
 * It replaces an unexplained `probability / 55` that was applied inline while
 * the documentation claimed NOAA's figure was never rescaled into a Tracker
 * judgement.
 */
describe("Tracker's aurora ranking", () => {
  const cells: [number, number, number][] = [[212, 65, 34]];
  const at = (probability: number) =>
    assessAurora(
      conditionsWith([[212, 65, probability]], "2026-08-21T07:59:00Z", "2026-08-21T08:55:00Z"),
      65,
      -148,
      "2026-08-21T08:20:00Z",
      NOW,
    );

  it("declares itself editorial rather than sourced", () => {
    const ranking = auroraRankingStrength(at(34));
    expect(ranking.editorial).toBe(true);
    expect(ranking.basis).toMatch(/Tracker/);
    expect(ranking.basis).toMatch(/NOAA/);
  });

  it("rises monotonically with NOAA's probability", () => {
    const values = [5, 10, 30, 60, 90].map((p) => auroraRankingStrength(at(p)).strength);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1]);
    }
  });

  it("places its stated anchors where the documentation says", () => {
    expect(auroraRankingStrength(at(10)).strength).toBeCloseTo(0.2, 2);
    expect(auroraRankingStrength(at(30)).strength).toBeCloseTo(0.45, 2);
    expect(auroraRankingStrength(at(60)).strength).toBeCloseTo(0.85, 2);
  });

  it("caps a three-day K-index below anything a nowcast can reach", () => {
    const shortRange = assessAurora(
      {
        ...conditionsWith(cells, "2026-08-21T07:59:00Z", "2026-08-21T08:55:00Z"),
        kpForecast: parseKpForecast([
          { time_tag: "2026-08-22T06:00:00", kp: 9, observed: "predicted" },
        ]),
      },
      65,
      -148,
      "2026-08-22T06:00:00Z",
      NOW,
    );
    const strongNowcast = auroraRankingStrength(at(60)).strength;
    expect(auroraRankingStrength(shortRange).strength).toBeLessThan(strongNowcast);
    expect(auroraRankingStrength(shortRange).basis).toMatch(/says nothing about where/i);
  });
});
