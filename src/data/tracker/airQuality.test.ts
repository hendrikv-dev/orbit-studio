import { describe, expect, it } from "vitest";
import {
  AQI_ADVISORY_FLOOR,
  NOWCAST_MINIMUM_WEIGHT,
  aerosolExtinctionMagnitudes,
  airQualityIndex,
  nowCastPm25,
  parseAerosolSamples,
  readAerosol,
  readAirQuality,
  withAerosol,
} from "./airQuality";
import { skyAccess, type ConditionSnapshot } from "./conditions";
import { conditionCards } from "./conditionCards";

/**
 * The smoke card was a permanently empty slot in the most valuable row on the
 * page. These tests are about the two ways backing it could go wrong: reporting
 * a clean sky on no evidence, and letting a health measurement stand in for a
 * transparency one.
 */

const NOW = new Date("2026-08-21T08:00:00Z");
const PORTLAND = { latitudeDeg: 45.5152, longitudeDeg: -122.6784 };

function snapshot(overrides: Partial<ConditionSnapshot> = {}): ConditionSnapshot {
  return {
    atUtc: "2026-08-21T09:00:00Z",
    cloudCoverPercent: 10,
    temperatureC: 14,
    issuedUtc: "2026-08-21T06:00:00Z",
    precipitating: false,
    visibilityM: null,
    lowCloudPercent: null,
    midCloudPercent: null,
    highCloudPercent: null,
    relativeHumidityPercent: null,
    smokeColumnMgM2: null,
    surfacePm25: null,
    source: "test",
    ...overrides,
  };
}

describe("reading the aerosol model", () => {
  it("parses Open-Meteo's hourly arrays into instants", () => {
    const samples = parseAerosolSamples({
      hourly: {
        time: ["2026-08-21T08:00", "2026-08-21T09:00"],
        pm2_5: [6, null],
        aerosol_optical_depth: [0.14, 0.31],
      },
    });
    expect(samples).toHaveLength(2);
    expect(samples[0].atUtc).toBe("2026-08-21T08:00:00.000Z");
    expect(samples[0].aerosolOpticalDepth).toBeCloseTo(0.14);
    expect(samples[1].surfacePm25).toBeNull();
  });

  it("returns nothing rather than guessing from an unusable body", () => {
    expect(parseAerosolSamples({})).toHaveLength(0);
    expect(parseAerosolSamples({ hourly: { time: [] } })).toHaveLength(0);
  });

  it("converts optical depth into the magnitudes an observer loses", () => {
    // Transmission is e^-tau, and a magnitude is -2.5 log10 of a flux ratio.
    expect(aerosolExtinctionMagnitudes(0)).toBeCloseTo(0, 6);
    expect(aerosolExtinctionMagnitudes(1)).toBeCloseTo(1.0857, 3);
    expect(aerosolExtinctionMagnitudes(0.4)).toBeCloseTo(0.434, 3);
  });

  it("names the ranges in ascending order", () => {
    expect(readAerosol(0.03)).toBe("clean");
    expect(readAerosol(0.14)).toBe("slight");
    expect(readAerosol(0.3)).toBe("hazy");
    expect(readAerosol(0.6)).toBe("smoky");
    expect(readAerosol(1.4)).toBe("heavy");
  });
});

describe("folding aerosol into the forecast", () => {
  it("matches by time rather than by position", () => {
    const merged = withAerosol(
      [snapshot({ atUtc: "2026-08-21T09:00:00Z" })],
      [
        { atUtc: "2026-08-21T03:00:00Z", aerosolOpticalDepth: 0.9, surfacePm25: 60 },
        { atUtc: "2026-08-21T09:00:00Z", aerosolOpticalDepth: 0.12, surfacePm25: 5 },
      ],
    );
    expect(merged[0].aerosolOpticalDepth).toBeCloseTo(0.12);
  });

  it("leaves a snapshot untouched when nothing is near it in time", () => {
    const merged = withAerosol(
      [snapshot({ atUtc: "2026-08-21T09:00:00Z" })],
      [{ atUtc: "2026-08-19T09:00:00Z", aerosolOpticalDepth: 0.9, surfacePm25: 60 }],
    );
    // Not "clean" — unmeasured. The distinction is the whole point.
    expect(merged[0].aerosolOpticalDepth).toBeUndefined();
  });

  it("returns the snapshots unchanged when the model returned nothing", () => {
    const base = [snapshot()];
    expect(withAerosol(base, [])).toBe(base);
  });
});

describe("what the atmospheric slot says", () => {
  /**
   * ## Three rewrites, and where this settled
   *
   * A permanent smoke card, then no card when there was nothing to report,
   * then a permanent card again, and now this. The reason it kept moving is
   * that one slot was being asked to answer two questions: how transparent the
   * sky is, and whether the air is safe to stand in for an hour. They are
   * measured by different instruments, they disagree in both directions, and a
   * single label could not honestly cover both.
   *
   * So the slot below is only ever about the sky. The health question has its
   * own card and its own tests, and the pair of them is what the assertions
   * here are really protecting: neither may quietly answer for the other.
   */
  const transparencyFor = (overrides: Partial<ConditionSnapshot>) =>
    conditionCards({
      ...PORTLAND,
      atUtc: "2026-08-21T09:00:00Z",
      snapshots: [snapshot(overrides)],
      evidenceStatus: "available",
      now: NOW,
      pending: false,
    }).find((card) => card.id === "smoke");

  it("quotes the cost in magnitudes rather than an index", () => {
    const card = transparencyFor({ aerosolOpticalDepth: 0.45 });
    expect(card?.interpretation).toMatch(/0\.5 mag/);
    expect(card?.tone).toBe("poor");
  });

  it("does not call thick aerosol smoke, because it cannot tell", () => {
    // Optical depth measures dust, sea salt, pollution and smoke together.
    const card = transparencyFor({ aerosolOpticalDepth: 0.45 });
    expect(card?.label).toBe("Transparency");
    expect(`${card?.value} ${card?.interpretation}`).not.toMatch(/smok/i);
    expect(card?.provenance?.detail).toMatch(/cannot identify smoke/i);
  });

  it("says smoke only when a smoke model says smoke", () => {
    const card = transparencyFor({ smokeColumnMgM2: 60, aerosolOpticalDepth: 0.5 });
    expect(card?.label).toBe("Smoke");
    expect(card?.provenance?.detail).toMatch(/smoke model/i);
  });

  it("says the sky was measured and is clean, rather than going quiet", () => {
    const card = transparencyFor({ aerosolOpticalDepth: 0.05 });
    expect(card?.value).toBe("Clear");
    expect(card?.tone).toBe("good");
  });

  it("has no slot at all where nothing measures the sky", () => {
    // The state that used to read "Not reported · No model covers this
    // location" on every page in the region. An absent measurement is not a
    // fact about tonight, and printing it on every page is the clutter the
    // brief asks to remove.
    expect(transparencyFor({})).toBeUndefined();
  });

  it("never lets a ground reading become a claim about the sky", () => {
    // PM2.5 says what the air is like to stand in and nothing whatever about
    // transparency overhead. With no aerosol model there is no transparency
    // card, however much particulate is being reported at head height.
    expect(transparencyFor({ surfacePm25: 8 })).toBeUndefined();
    expect(transparencyFor({ surfacePm25: 90 })).toBeUndefined();
  });
});

/**
 * ## The defect these exist to make impossible
 *
 * Tracker took the single hourly PM2.5 value nearest an event and ran it
 * through the AQI's breakpoints. Those breakpoints are defined against a
 * 24-hour average, so a brief modelled plume produced "AQI 175 · Unhealthy" on
 * the strength of one hour — a number and a category name with nothing behind
 * them.
 *
 * The index is now derived only from an EPA NowCast, and the type system is
 * arranged so there is no other route to one. The regression test at the end of
 * this block asserts exactly the old behaviour is unreachable.
 */

/** A flat series of `hours` values ending at `endUtc`, most recent last. */
const series = (endUtc: string, values: (number | null)[]) =>
  values.map((pm25, index) => ({
    atUtc: new Date(Date.parse(endUtc) - (values.length - 1 - index) * 3_600_000).toISOString(),
    pm25,
  }));

/** The hour the snapshot fixture above describes, so the two line up. */
const AT = "2026-08-21T09:00:00.000Z";
const LATER = new Date("2026-08-21T10:00:00.000Z");

describe("the NowCast, which is what makes an AQI computable", () => {
  it("averages a flat twelve hours to about that level", () => {
    const reading = nowCastPm25(series(AT, Array(12).fill(30)), AT, LATER);
    expect(reading?.hoursUsed).toBe(12);
    // A flat window has no rate of change, so the weight is 1 and the answer is
    // the plain mean.
    expect(reading?.weight).toBe(1);
    expect(reading?.value).toBeCloseTo(30, 1);
  });

  it("refuses to be dragged all the way up by one bad hour", () => {
    // The defect, in numbers. Eleven quiet hours and one at 200: the raw hour
    // would be AQI 250, and the NowCast is less than half of it.
    const spike = nowCastPm25(series(AT, [...Array(11).fill(4), 200]), AT, LATER);
    expect(spike).not.toBeNull();
    expect(spike!.value).toBeLessThan(110);
    expect(spike!.value).toBeGreaterThan(90);
    // The weight is at its floor, which is what bounds the single hour's pull.
    expect(spike!.weight).toBe(NOWCAST_MINIMUM_WEIGHT);
    expect(airQualityIndex(spike!.value).aqi).toBeLessThan(airQualityIndex(200).aqi);
  });

  it("stays high when the pollution is sustained rather than a spike", () => {
    const sustained = nowCastPm25(series(AT, Array(12).fill(120)), AT, LATER);
    expect(sustained!.value).toBeCloseTo(120, 0);
    // 120 µg/m³ sits in the 55.5–125.4 band, which is "Unhealthy".
    expect(airQualityIndex(sustained!.value).category).toBe("unhealthy");
    // And the two cases are far apart, which is the whole point of the method.
    const spike = nowCastPm25(series(AT, [...Array(11).fill(4), 120]), AT, LATER);
    expect(sustained!.value).toBeGreaterThan(spike!.value * 1.8);
  });

  it("tracks a genuine rise rather than lagging behind it", () => {
    // Six clean hours then six increasingly bad ones. A 24-hour average would
    // barely move; the NowCast has to notice.
    const rising = nowCastPm25(series(AT, [3, 3, 4, 4, 5, 6, 20, 40, 60, 80, 95, 110]), AT, LATER);
    expect(rising!.value).toBeGreaterThan(60);
    expect(rising!.value).toBeLessThan(110);
  });

  it("returns nothing when the recent hours are missing", () => {
    // EPA's validity rule: two of the three most recent hours. One is not two.
    expect(nowCastPm25(series(AT, [...Array(9).fill(30), 30, null, null]), AT, LATER)).toBeNull();
    expect(nowCastPm25(series(AT, Array(12).fill(null)), AT, LATER)).toBeNull();
  });

  it("computes from a short history when the recent hours are there", () => {
    // Three hours is thin and is still valid under the rule, so the answer is
    // given — with `hoursUsed` carrying how thin it was.
    const reading = nowCastPm25(series(AT, [null, null, null, null, null, null, null, null, null, 20, 22, 24]), AT, LATER);
    expect(reading?.hoursUsed).toBe(3);
    expect(reading?.value).toBeGreaterThan(19);
  });

  it("drops holes rather than filling them", () => {
    // A gap contributes nothing to either sum. Nothing is forward-filled: the
    // source publishes no value for that hour and inventing one would be
    // fabricating the evidence the index rests on.
    const withHoles = nowCastPm25(series(AT, [40, null, 40, null, 40, null, 40, null, 40, 40, 40, 40]), AT, LATER);
    expect(withHoles?.hoursUsed).toBe(8);
    expect(withHoles?.value).toBeCloseTo(40, 0);
  });

  it("ignores hours outside the twelve-hour window", () => {
    const long = series(AT, Array(30).fill(5));
    // A day-old catastrophe is not part of this NowCast.
    long[0] = { ...long[0], pm25: 900 };
    const reading = nowCastPm25(long, AT, LATER);
    expect(reading?.hoursUsed).toBe(12);
    expect(reading?.value).toBeCloseTo(5, 1);
  });

  it("says whether the window is analysis or forecast", () => {
    const past = nowCastPm25(series(AT, Array(12).fill(20)), AT, LATER);
    expect(past?.basis).toBe("analysis");
    // The same window asked about before it has happened is a projection, and
    // the difference is a claim about evidence rather than about arithmetic.
    const ahead = nowCastPm25(series(AT, Array(12).fill(20)), AT, new Date("2026-08-21T06:00:00.000Z"));
    expect(ahead?.basis).toBe("forecast");
  });

  it("survives a window of zeroes without dividing by zero", () => {
    const reading = nowCastPm25(series(AT, Array(12).fill(0)), AT, LATER);
    expect(reading?.value).toBe(0);
    expect(Number.isFinite(reading!.weight)).toBe(true);
  });
});

describe("air quality, which is a health question", () => {
  const cardsFor = (values: (number | null)[], overrides: Partial<ConditionSnapshot> = {}) =>
    conditionCards({
      ...PORTLAND,
      atUtc: AT,
      snapshots: [snapshot({ ...overrides })],
      airQuality: readAirQuality(series(AT, values), AT, LATER),
      evidenceStatus: "available",
      now: LATER,
      pending: false,
    });

  const alertFor = (values: (number | null)[], overrides: Partial<ConditionSnapshot> = {}) =>
    cardsFor(values, overrides).find((card) => card.id === "air-quality");

  it("says nothing at all when the air is normal", () => {
    // "AQI 23 · Good" is a dashboard reading: it tells a reader nothing they
    // can act on and it would be on the page every single night.
    expect(alertFor(Array(12).fill(5))).toBeUndefined();
    expect(alertFor(Array(12).fill(8.9))).toBeUndefined();
  });

  it("stays quiet through the whole moderate band", () => {
    expect(alertFor(Array(12).fill(12))).toBeUndefined();
    expect(alertFor(Array(12).fill(35))).toBeUndefined();
  });

  it("raises a warning when sustained pollution earns one", () => {
    const card = alertFor(Array(12).fill(90));
    expect(card?.value).toMatch(/^AQI \d+ · Unhealthy$/);
    expect(card?.interpretation).toMatch(/limit prolonged time outdoors/i);
    expect(card?.tone).toBe("poor");
  });

  it("shows its working: the window, the weight and the NowCast", () => {
    const card = alertFor(Array(12).fill(90));
    expect(card?.provenance?.detail).toMatch(/12-hour EPA NowCast/i);
    expect(card?.provenance?.detail).toMatch(/weight 1\.00/);
    expect(card?.provenance?.detail).toMatch(/NowCast 90\.0 µg\/m³/);
    expect(card?.provenance?.detail).toMatch(/single hourly value is never converted/i);
  });

  /**
   * ## The regression test
   *
   * One hour at 200 µg/m³ used to produce "AQI 250 · Very unhealthy". It is the
   * exact input that produced the defect, and the assertion is that no card
   * anywhere can reach that conclusion from it.
   */
  it("cannot turn a single hourly reading into an AQI", () => {
    const oneHour = [null, null, null, null, null, null, null, null, null, null, null, 200];
    const reading = readAirQuality(series(AT, oneHour), AT, LATER);
    expect(reading.pm25).toBe(200);
    expect(reading.nowCast).toBeNull();
    expect(reading.index).toBeNull();

    const card = alertFor(oneHour);
    expect(card).toBeDefined();
    expect(card?.value).not.toMatch(/AQI/);
    expect(card?.value).toBe("PM2.5 200 µg/m³");
    // And none of the index's category names, which belong to a scale that has
    // not been evaluated.
    expect(card?.value).not.toMatch(/good|moderate|unhealthy|hazardous/i);
    expect(card?.provenance?.detail).toMatch(/no AQI is claimed/i);
  });

  it("withholds the index but keeps quiet about an ordinary concentration", () => {
    // Insufficient history *and* nothing alarming: no card at all rather than a
    // number nobody needs.
    expect(alertFor([null, null, null, null, null, null, null, null, null, null, null, 12]))
      .toBeUndefined();
  });

  it("says nothing when no particulate reading exists", () => {
    expect(alertFor(Array(12).fill(null))).toBeUndefined();
  });

  it("shows nothing at all without an air-quality reading to work from", () => {
    const cards = conditionCards({
      ...PORTLAND,
      atUtc: AT,
      snapshots: [snapshot({ surfacePm25: 200 })],
      evidenceStatus: "available",
      now: LATER,
      pending: false,
    });
    // Even with a snapshot carrying 200 µg/m³: the card cannot be reached
    // without the series, which is the structural half of the fix.
    expect(cards.find((card) => card.id === "air-quality")).toBeUndefined();
  });

  it("is independent of the sky: clean air can sit under a ruined sky", () => {
    const cards = cardsFor(Array(12).fill(4), { aerosolOpticalDepth: 0.9 });
    expect(cards.find((card) => card.id === "smoke")?.value).toBe("Poor");
    expect(cards.find((card) => card.id === "air-quality")).toBeUndefined();
  });

  it("and a fine sky can sit under air worth warning about", () => {
    const cards = cardsFor(Array(12).fill(90), { aerosolOpticalDepth: 0.04 });
    expect(cards.find((card) => card.id === "smoke")?.value).toBe("Clear");
    expect(cards.find((card) => card.id === "air-quality")?.value).toMatch(/AQI \d+ · Unhealthy/);
  });
});

describe("the index itself", () => {
  it("puts the published category boundaries where the EPA puts them", () => {
    expect(airQualityIndex(0).aqi).toBe(0);
    expect(airQualityIndex(9).aqi).toBe(50);
    expect(airQualityIndex(9.1).aqi).toBe(51);
    expect(airQualityIndex(35.4).aqi).toBe(100);
    expect(airQualityIndex(35.5).aqi).toBe(101);
    expect(airQualityIndex(55.5).aqi).toBe(151);
    expect(airQualityIndex(125.5).aqi).toBe(201);
  });

  it("only claims an advisory from the first category that has one", () => {
    expect(airQualityIndex(9).advisory).toBe(false);
    expect(airQualityIndex(35.4).advisory).toBe(false);
    expect(airQualityIndex(35.5).advisory).toBe(true);
    expect(AQI_ADVISORY_FLOOR).toBe(101);
  });

  it("carries the category's own guidance rather than inventing any", () => {
    expect(airQualityIndex(5).guidance).toBeNull();
    expect(airQualityIndex(40).guidance).toMatch(/sensitive|heart or lung/i);
    expect(airQualityIndex(300).guidance).toMatch(/indoors|avoid/i);
  });

  it("does not run off the end of the scale", () => {
    expect(airQualityIndex(5000).aqi).toBeLessThanOrEqual(500);
    expect(airQualityIndex(-5).aqi).toBe(0);
  });
});
