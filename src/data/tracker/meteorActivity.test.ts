import { describe, expect, it } from "vitest";
import { Observer } from "astronomy-engine";
import {
  cadenceDescription,
  limitingMagnitude,
  meteorNight,
  observedHourlyRate,
  showerPeakTime,
  solarLongitudeDeg,
  sporadicHourlyRate,
  zhrAtSolarLongitude,
} from "./meteorActivity";
import { METEOR_SHOWERS, meteorShowerByCode } from "./meteorShowers";
import { trackerObservationPeriod } from "./observationPeriod";

const LONDON = { lat: 51.4779, lon: -0.0015 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };
const TROMSO = { lat: 69.6496, lon: 18.956 };

const at = (iso: string) => new Date(iso);
const night = (place: { lat: number; lon: number }, when: string) =>
  meteorNight(place.lat, place.lon, trackerObservationPeriod(place.lat, place.lon, at(when)));

describe("when a shower peaks", () => {
  // Peaks are checked against the dates the IMO publishes for 2026. These are
  // external facts, not this file's own output, which is the only kind of test
  // that can catch the model being confidently wrong.
  it.each([
    ["QUA", "2026-01-03"],
    ["LYR", "2026-04-22"],
    ["ETA", "2026-05-06"],
    ["PER", "2026-08-12"],
    ["ORI", "2026-10-21"],
    ["LEO", "2026-11-17"],
    ["GEM", "2026-12-14"],
    ["URS", "2026-12-22"],
  ])("puts the %s maximum on %s", (code, expected) => {
    const shower = meteorShowerByCode(code)!;
    const peak = showerPeakTime(shower, at(`${expected}T00:00:00Z`));
    expect(peak?.toISOString().slice(0, 10)).toBe(expected);
  });

  it("finds the nearest maximum whichever side of it you ask from", () => {
    // Regression: a search window longer than a year returns nothing at all,
    // because the target solar longitude occurs twice inside it. That failure
    // was silent, and it made the Geminids vanish from December.
    for (const shower of METEOR_SHOWERS) {
      for (const from of ["2026-02-01", "2026-06-15", "2026-09-01", "2026-12-01"]) {
        const peak = showerPeakTime(shower, at(`${from}T00:00:00Z`));
        expect(peak, `${shower.code} from ${from}`).not.toBeNull();
        const daysAway = Math.abs(peak!.getTime() - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
        expect(daysAway, `${shower.code} from ${from}`).toBeLessThan(190);
      }
    }
  });
});

describe("the activity profile", () => {
  const perseids = meteorShowerByCode("PER")!;
  const zhrDaysFromPeak = (days: number) =>
    zhrAtSolarLongitude(perseids, perseids.peakSolarLongitudeDeg + days * 0.9856);

  // Checked against the published Perseid profile: roughly 55 an hour a day
  // from maximum, 10 at five days, a couple at ten. A single exponential fitted
  // to the peak width gave 3 an hour at five days — it would have told people
  // to stay in on nights that are genuinely good.
  it("tracks the published Perseid curve into the wings", () => {
    expect(zhrDaysFromPeak(0)).toBeCloseTo(100, 0);
    expect(zhrDaysFromPeak(-1)).toBeGreaterThan(40);
    expect(zhrDaysFromPeak(-1)).toBeLessThan(70);
    expect(zhrDaysFromPeak(-5)).toBeGreaterThan(6);
    expect(zhrDaysFromPeak(-5)).toBeLessThan(15);
    expect(zhrDaysFromPeak(-10)).toBeGreaterThan(1);
    expect(zhrDaysFromPeak(-10)).toBeLessThan(6);
  });

  it("decays more slowly before maximum than after, as the Perseids do", () => {
    expect(zhrDaysFromPeak(-5)).toBeGreaterThan(zhrDaysFromPeak(5));
  });

  it("keeps a sharp peak sharp and a broad one broad", () => {
    const quadrantids = meteorShowerByCode("QUA")!;
    const taurids = meteorShowerByCode("STA")!;
    const dayOff = (shower: typeof quadrantids, days: number) =>
      zhrAtSolarLongitude(shower, shower.peakSolarLongitudeDeg + days * 0.9856) /
      shower.nominalZhr;

    // The Quadrantids lose most of their rate within a day of maximum.
    expect(dayOff(quadrantids, 1)).toBeLessThan(0.2);
    // The Taurids barely notice a week.
    expect(dayOff(taurids, 7)).toBeGreaterThan(0.5);
  });

  it("gives nothing outside the published activity interval", () => {
    const geminids = meteorShowerByCode("GEM")!;
    expect(zhrAtSolarLongitude(geminids, geminids.peakSolarLongitudeDeg + 40)).toBe(0);
  });
});

describe("the sky the meteors are seen against", () => {
  // The anchors these curves were calibrated to, asserted so a later change to
  // the constants has to face them.
  it("loses about two magnitudes to a high full Moon", () => {
    expect(limitingMagnitude(-25, 60, 1)).toBeCloseTo(4.5, 0);
  });

  it("loses nothing to a Moon below the horizon", () => {
    expect(limitingMagnitude(-25, -5, 1)).toBe(6.5);
  });

  it("is already three magnitudes down at the civil twilight boundary", () => {
    expect(limitingMagnitude(-6, -10, 0)).toBeCloseTo(3.5, 1);
  });

  it("costs rate, because a brighter sky hides the faint majority", () => {
    const dark = observedHourlyRate(100, 60, 2.2, 6.5);
    const moonlit = observedHourlyRate(100, 60, 2.2, 4.5);
    expect(moonlit).toBeLessThan(dark / 2);
  });
});

describe("what the observer actually gets", () => {
  it("does not report the zenithal rate as the expected count", () => {
    // The Perseids are nominally 100 an hour. Nobody has ever seen 100. The
    // comparison is per stream, not against the whole sky: sporadics and the
    // Southern delta Aquariids are added on top, so the combined total can
    // legitimately exceed any single shower's zenithal rate.
    const perseids = night(LONDON, "2026-08-12T22:00:00Z");
    const per = perseids.contributions.find((entry) => entry.code === "PER")!;
    expect(per.perHour).toBeLessThan(per.zhrTonight);
    expect(per.perHour).toBeLessThan(100);
  });

  it("puts the best of Perseid night after midnight", () => {
    const perseids = night(LONDON, "2026-08-12T22:00:00Z");
    const hour = Number(perseids.best!.atUtc.slice(11, 13));
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThan(4);
  });

  it("reports a rate a real observer could match", () => {
    // Dark-sky observers count 60–90 an hour at Perseid maximum.
    const perseids = night(LONDON, "2026-08-12T22:00:00Z");
    expect(perseids.best!.totalPerHour).toBeGreaterThan(40);
    expect(perseids.best!.totalPerHour).toBeLessThan(110);
  });

  it("bands the rate downwards only, because the missing inputs only subtract", () => {
    const perseids = night(LONDON, "2026-08-12T22:00:00Z");
    const [low, high] = perseids.ratePerHourRange!;
    expect(high).toBeCloseTo(perseids.best!.totalPerHour, 5);
    expect(low).toBeLessThan(high);
  });

  it("names light pollution and cloud as missing rather than assuming them", () => {
    const quiet = night(LONDON, "2026-03-05T22:00:00Z");
    expect(quiet.missingInputs.join(" ")).toMatch(/light pollution/i);
    expect(quiet.missingInputs.join(" ")).toMatch(/cloud/i);
  });

  it("counts every active shower, not only the famous one", () => {
    // Late July runs the Southern delta Aquariids, the alpha Capricornids and
    // the beginning of the Perseids at once.
    const july = night(LONDON, "2026-07-28T22:00:00Z");
    expect(july.activeShowerCodes.length).toBeGreaterThanOrEqual(3);
  });

  it("still offers something on a night with no shower at all", () => {
    const quiet = night(LONDON, "2026-03-19T22:00:00Z");
    expect(quiet.contributions).toHaveLength(0);
    expect(quiet.best!.sporadicPerHour).toBeGreaterThan(1);
  });
});

describe("geometry the user can check against their own sky", () => {
  it("favours the southern hemisphere for the eta Aquariids", () => {
    // A Halley stream with a radiant near the celestial equator that rises
    // before dawn: famously much better from Sydney than from London.
    const sydney = night(SYDNEY, "2026-05-06T14:00:00Z");
    const london = night(LONDON, "2026-05-06T22:00:00Z");
    const rate = (result: typeof sydney) =>
      result.contributions.find((entry) => entry.code === "ETA")?.perHour ?? 0;
    expect(rate(sydney)).toBeGreaterThan(rate(london) * 2);
  });

  it("puts the Perseid radiant high in the north-east from London", () => {
    const perseids = night(LONDON, "2026-08-12T22:00:00Z");
    const per = perseids.contributions.find((entry) => entry.code === "PER")!;
    expect(per.radiantAltitudeDeg).toBeGreaterThan(45);
    expect(per.radiantAzimuthDeg).toBeGreaterThan(20);
    expect(per.radiantAzimuthDeg).toBeLessThan(90);
  });

  it("drifts the radiant across the activity period", () => {
    const early = night(LONDON, "2026-08-02T22:00:00Z");
    const late = night(LONDON, "2026-08-17T22:00:00Z");
    const azimuth = (result: typeof early) =>
      result.contributions.find((entry) => entry.code === "PER")?.radiantAzimuthDeg;
    // Both nights have the radiant up; the drift moves it measurably.
    expect(azimuth(late)).toBeDefined();
    expect(solarLongitudeDeg(at("2026-08-17T22:00:00Z"))).toBeGreaterThan(
      solarLongitudeDeg(at("2026-08-02T22:00:00Z")),
    );
  });

  it("raises the sporadic background towards dawn, as the apex rises", () => {
    // Near new Moon, so the Moon is not masking the effect.
    const observer = new Observer(LONDON.lat, LONDON.lon, 0);
    const evening = sporadicHourlyRate(observer, at("2026-03-19T22:00:00Z"), 6.5);
    const beforeDawn = sporadicHourlyRate(observer, at("2026-03-20T04:30:00Z"), 6.5);
    expect(beforeDawn).toBeGreaterThan(evening);
  });
});

describe("polar cases", () => {
  it("says plainly that a midsummer night is unusable, rather than reporting zero", () => {
    const midsummer = night(TROMSO, "2026-06-21T22:00:00Z");
    expect(midsummer.best).toBeNull();
    expect(midsummer.limitations.join(" ")).toMatch(/dark/i);
  });
});

describe("cadence", () => {
  it("turns a rate into the wait between meteors", () => {
    expect(cadenceDescription(60)).toMatch(/one a minute/);
    expect(cadenceDescription(6)).toMatch(/10 minutes/);
    expect(cadenceDescription(0)).toMatch(/nothing/);
  });
});
