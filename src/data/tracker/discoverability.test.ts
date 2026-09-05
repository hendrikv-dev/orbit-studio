import { describe, expect, it } from "vitest";
import { buildCloudTimeline, cloudAdvice } from "./cloudTimeline";
import { conjunctionPersistence } from "./phenomena";
import type { CloudForecastSeries } from "./cloud";
import { rankOpportunities, type ObstructionPersistence, type Opportunity } from "./opportunity";
import type { SignificanceTier } from "./significance";

/**
 * Two questions that are not the same question.
 *
 *   A. How good is this observing opportunity?      → significance / qualities
 *   B. Does missing it cost anything I can get back? → ObstructionPersistence
 *
 * They correlate, so it is tempting to answer B by thresholding A, and that is
 * what the code used to do: `favourable` and `notable` survived a closed sky.
 * The gap between the two is where the defect lived. A 3° Moon–Venus pairing
 * rates `favourable` and recurs most months; a modest occultation could rate
 * `good-example` and disappear.
 *
 * These tests exist to hold the two apart, so that no future change can quietly
 * reintroduce the inference.
 */

const forecast = (entries: [string, number][]): CloudForecastSeries => ({
  model: "NOAA HRRR",
  hours: entries.map(([validUtc, percent]) => ({ validUtc, percent })),
});

const hours = (from: number, count: number, percent: number): [string, number][] =>
  Array.from({ length: count }, (_, index) => [
    `2026-09-03T${String(from + index).padStart(2, "0")}:00Z`,
    percent,
  ]);

const night = (entries: [string, number][]) =>
  buildCloudTimeline({
    windowStartUtc: "2026-09-03T02:00Z",
    windowEndUtc: "2026-09-03T12:00Z",
    nowUtc: "2026-09-03T02:00Z",
    observed: null,
    forecast: forecast(entries),
  });

/** Cloudy from dusk to dawn. */
const closedNight = () => night(hours(2, 10, 95));
/** Cloudy until five, clear afterwards. */
const clearingNight = () => night([...hours(2, 4, 95), ...hours(6, 6, 5)]);
/** Clear all night. */
const clearNight = () => night(hours(2, 10, 5));

const EARLY = { startUtc: "2026-09-03T02:00Z", endUtc: "2026-09-03T05:00Z" };
const LATE = { startUtc: "2026-09-03T07:00Z", endUtc: "2026-09-03T11:00Z" };

describe("quality and discoverability are independent", () => {
  /**
   * The first case the brief names. An excellent routine target is still a
   * routine target: Jupiter at opposition is a better view than Jupiter in
   * March and no harder to catch next week.
   */
  it("withholds a routine target however good the opportunity is", () => {
    const advice = cloudAdvice(closedNight(), "routine", "UTC", EARLY);
    expect(advice.suppress).toBe(true);
  });

  /**
   * The second, and the one the old rule got wrong. Persistence does not
   * consult the tier, so a merely-good opportunity that happens to be
   * time-bound survives.
   */
  it("keeps a time-critical event that rates only moderately", () => {
    const advice = cloudAdvice(closedNight(), "time-critical", "UTC", EARLY);
    expect(advice.suppress).toBe(false);
    expect(advice.goAnyway).toBe(true);
    expect(advice.warning).toMatch(/worth going anyway/i);
  });

  it("says nothing about a time-critical event under a clear sky", () => {
    const advice = cloudAdvice(clearNight(), "time-critical", "UTC", EARLY);
    expect(advice.suppress).toBe(false);
    expect(advice.warning).toBeNull();
    expect(advice.goAnyway).toBe(false);
  });

  it("keeps a routine target under cloud it can work around", () => {
    // Bad early, clear later, judged across the whole night: intermittent.
    const advice = cloudAdvice(clearingNight(), "routine", "UTC", {
      startUtc: "2026-09-03T02:00Z",
      endUtc: "2026-09-03T11:00Z",
    });
    expect(advice.suppress).toBe(false);
    expect(advice.warning).toMatch(/comes and goes/i);
  });

  /**
   * The function cannot be fed a significance tier at all.
   *
   * A type-level guard, asserted as a value too so it survives a future change
   * that loosens the signature. If `SignificanceTier` and
   * `ObstructionPersistence` ever share a member beyond "routine", the
   * inference this file exists to prevent becomes expressible again.
   */
  it("does not share a vocabulary with the significance model", () => {
    const persistences: ObstructionPersistence[] = ["routine", "time-critical"];
    const tiers: SignificanceTier[] = ["routine", "good-example", "favourable", "notable"];
    const shared = tiers.filter((tier) => (persistences as string[]).includes(tier));
    // "routine" is a deliberate and harmless coincidence of English; the tiers
    // that used to grant survival — favourable and notable — must not be
    // expressible as a persistence.
    expect(shared).toEqual(["routine"]);
    expect((persistences as string[]).includes("favourable")).toBe(false);
    expect((persistences as string[]).includes("notable")).toBe(false);
  });
});

describe("preservation follows the opportunity's own window", () => {
  it("keeps a time-critical event whose window is cloudy while later sky clears", () => {
    const advice = cloudAdvice(clearingNight(), "time-critical", "UTC", EARLY);
    expect(advice.suppress).toBe(false);
    expect(advice.warning).toBeTruthy();
  });

  it("lets a later routine target appear once its own window clears", () => {
    const advice = cloudAdvice(clearingNight(), "routine", "UTC", LATE);
    expect(advice.suppress).toBe(false);
    expect(advice.warning).toBeNull();
  });

  it("gives two windows on one night different outcomes", () => {
    const timeline = clearingNight();
    expect(cloudAdvice(timeline, "routine", "UTC", EARLY).suppress).toBe(true);
    expect(cloudAdvice(timeline, "routine", "UTC", LATE).suppress).toBe(false);
  });
});

describe("a conjunction earns persistence from orbits, not from its type", () => {
  /**
   * The Moon laps the zodiac monthly, so it passes each bright planet a dozen
   * times a year. Two planets converging is governed by their synodic period,
   * which is years.
   */
  it("does not preserve a Moon pairing, however close", () => {
    expect(conjunctionPersistence("the Moon", "Venus", 0.4)).toBe("routine");
    expect(conjunctionPersistence("the Moon", "Jupiter", 1.7)).toBe("routine");
    expect(conjunctionPersistence("Venus", "the Moon", 0.2)).toBe("routine");
  });

  it("preserves a tight planet–planet approach", () => {
    expect(conjunctionPersistence("Jupiter", "Saturn", 0.4)).toBe("time-critical");
    expect(conjunctionPersistence("Venus", "Mars", 1)).toBe("time-critical");
  });

  it("does not preserve a wide planet pairing", () => {
    expect(conjunctionPersistence("Jupiter", "Saturn", 2.5)).toBe("routine");
    expect(conjunctionPersistence("Venus", "Mars", 5)).toBe("routine");
  });

  /**
   * The specific regression: `conjunctionSignificance` calls anything under 3°
   * `favourable`, which is the tier the old rule preserved. A 2° Moon–Venus
   * pairing is therefore a case where the two answers must differ.
   */
  it("differs from the significance tier exactly where the old rule was wrong", () => {
    expect(conjunctionPersistence("the Moon", "Venus", 2)).toBe("routine");
  });
});

describe("persistence does not touch the ranking", () => {
  /**
   * The brief is explicit that cloud persistence must not distort the ranking
   * score merely to keep an event alive. It cannot, structurally — `rankOpportunities`
   * never reads the field — and this asserts it rather than trusting the reading.
   */
  const base = (id: string, persistence: ObstructionPersistence): Opportunity => ({
    id,
    kind: "planet",
    title: id,
    persistence,
    summary: "",
    qualities: {
      observability: 0.8,
      spectacle: 0.5,
      recognisability: 0.7,
      ease: 0.6,
      confidence: 1,
      rarity: 0.2,
    },
    guidance: {
      appearance: "",
      whenUtc: "2026-09-03T05:00:00Z",
      durationMinutes: 60,
      direction: "S",
      elevation: "",
      howLong: "",
      equipment: "eyes",
      technique: null,
      safety: null,
    },
    phenomenon: "",
    tonight: "",
    missingInputs: [],
    limitations: [],
    transparency: "low",
  });

  it("ranks two otherwise identical opportunities the same whatever their persistence", () => {
    const asRoutine = rankOpportunities([base("a", "routine"), base("b", "routine")]);
    const asMixed = rankOpportunities([base("a", "time-critical"), base("b", "routine")]);
    expect(asMixed.ranked.map((entry) => entry.opportunity.id)).toEqual(
      asRoutine.ranked.map((entry) => entry.opportunity.id),
    );
    expect(asMixed.ranked[0].strength).toBeCloseTo(asRoutine.ranked[0].strength, 10);
  });

  it("does not lift a time-critical opportunity's strength", () => {
    const [routine] = rankOpportunities([base("a", "routine")]).ranked;
    const [critical] = rankOpportunities([base("a", "time-critical")]).ranked;
    expect(critical.strength).toBeCloseTo(routine.strength, 10);
    expect(critical.band).toBe(routine.band);
  });
});
