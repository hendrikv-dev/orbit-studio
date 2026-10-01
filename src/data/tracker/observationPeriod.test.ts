import { describe, expect, it } from "vitest";
import {
  deepestTwilightBand,
  isWithinObservationPeriod,
  trackerObservationPeriod,
} from "./observationPeriod";

const LONDON = { lat: 51.4779, lon: -0.0015 };
const TROMSO = { lat: 69.6496, lon: 18.956 };
const NAIROBI = { lat: -1.2921, lon: 36.8219 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };

const at = (iso: string) => new Date(iso);
const hours = (period: { startUtc: string; endUtc: string }) =>
  (Date.parse(period.endUtc) - Date.parse(period.startUtc)) / 3_600_000;

describe("the frame", () => {
  it("runs sunset to sunrise for an ordinary night", () => {
    const period = trackerObservationPeriod(LONDON.lat, LONDON.lon, at("2026-08-14T21:00:00Z"));
    expect(period.kind).toBe("night");
    // London mid-August: sunset ~19:24, sunrise ~04:45.
    expect(period.startUtc.slice(11, 16)).toBe("19:24");
    expect(period.endUtc.slice(11, 16)).toBe("04:45");
    expect(hours(period)).toBeGreaterThan(9);
    expect(hours(period)).toBeLessThan(10);
  });

  it("ends after it starts, everywhere tested", () => {
    for (const place of [LONDON, TROMSO, NAIROBI, SYDNEY]) {
      for (const when of ["2026-03-20T21:00:00Z", "2026-06-21T21:00:00Z", "2026-12-21T21:00:00Z"]) {
        const period = trackerObservationPeriod(place.lat, place.lon, at(when));
        expect(Date.parse(period.endUtc)).toBeGreaterThan(Date.parse(period.startUtc));
      }
    }
  });

  it("gives the equator a night close to twelve hours all year", () => {
    for (const when of ["2026-03-20T21:00:00Z", "2026-06-21T21:00:00Z", "2026-12-21T21:00:00Z"]) {
      const period = trackerObservationPeriod(NAIROBI.lat, NAIROBI.lon, at(when));
      expect(hours(period)).toBeGreaterThan(11);
      expect(hours(period)).toBeLessThan(13);
    }
  });
});

describe("which night the reader is in", () => {
  it("still means the evening just passed at 01:00", () => {
    // R4.3: after midnight, tonight is the night in progress, not the next one.
    const period = trackerObservationPeriod(LONDON.lat, LONDON.lon, at("2026-08-15T01:00:00Z"));
    expect(period.startUtc.slice(0, 10)).toBe("2026-08-14");
    expect(period.endUtc.slice(0, 10)).toBe("2026-08-15");
  });

  it("places a pre-dawn instant in the night that is ending", () => {
    const period = trackerObservationPeriod(LONDON.lat, LONDON.lon, at("2026-08-15T03:30:00Z"));
    expect(period.startUtc.slice(0, 10)).toBe("2026-08-14");
    expect(isWithinObservationPeriod(period, at("2026-08-15T03:30:00Z"))).toBe(true);
  });

  it("looks forward to the coming night during the day", () => {
    const period = trackerObservationPeriod(LONDON.lat, LONDON.lon, at("2026-08-15T12:00:00Z"));
    expect(period.startUtc.slice(0, 10)).toBe("2026-08-15");
    expect(Date.parse(period.startUtc)).toBeGreaterThan(Date.parse("2026-08-15T12:00:00Z"));
  });

  it("does not jump to the next night moments before sunrise", () => {
    const beforeDawn = trackerObservationPeriod(LONDON.lat, LONDON.lon, at("2026-08-15T04:30:00Z"));
    expect(beforeDawn.startUtc.slice(0, 10)).toBe("2026-08-14");
  });
});

describe("darkness", () => {
  it("reports each band separately", () => {
    const period = trackerObservationPeriod(LONDON.lat, LONDON.lon, at("2026-08-14T21:00:00Z"));
    expect(period.darkness.civil).toBeDefined();
    expect(period.darkness.nautical).toBeDefined();
    expect(period.darkness.astronomical).toBeDefined();
    // Bands nest: astronomical darkness sits inside nautical, inside civil.
    expect(Date.parse(period.darkness.astronomical!.startUtc)).toBeGreaterThan(
      Date.parse(period.darkness.nautical!.startUtc),
    );
    expect(Date.parse(period.darkness.astronomical!.endUtc)).toBeLessThan(
      Date.parse(period.darkness.nautical!.endUtc),
    );
  });

  it("omits a band the Sun never reaches, and says so", () => {
    // London in late June never reaches astronomical darkness.
    const period = trackerObservationPeriod(LONDON.lat, LONDON.lon, at("2026-06-21T23:00:00Z"));
    expect(period.darkness.astronomical).toBeUndefined();
    expect(deepestTwilightBand(period)).toBe("nautical");
    expect(period.limitation).toMatch(/astronomical darkness/i);
    expect(period.deepestSunAltitudeDeg).toBeGreaterThan(-18);
  });

  it("names the darkest band actually reached", () => {
    const august = trackerObservationPeriod(LONDON.lat, LONDON.lon, at("2026-08-14T21:00:00Z"));
    expect(deepestTwilightBand(august)).toBe("astronomical");
  });
});

describe("polar cases", () => {
  it("reports polar day without erroring or returning an empty period", () => {
    // R4.3: the view is not empty and does not error; the reason is stated.
    const period = trackerObservationPeriod(TROMSO.lat, TROMSO.lon, at("2026-06-21T22:00:00Z"));
    expect(period.kind).toBe("polar-day");
    expect(period.darkness.astronomical).toBeUndefined();
    expect(deepestTwilightBand(period)).toBeNull();
    expect(period.limitation).toMatch(/does not set/i);
    expect(hours(period)).toBeGreaterThan(0);
  });

  it("treats polar night as a full day where darkness is not the limit", () => {
    const period = trackerObservationPeriod(TROMSO.lat, TROMSO.lon, at("2026-12-21T12:00:00Z"));
    expect(period.kind).toBe("polar-night");
    expect(period.limitation).toMatch(/does not rise/i);
    expect(hours(period)).toBeGreaterThan(0);
  });

  it("returns an ordinary night at the same place in spring", () => {
    const period = trackerObservationPeriod(TROMSO.lat, TROMSO.lon, at("2026-03-20T22:00:00Z"));
    expect(period.kind).toBe("night");
  });
});

describe("the southern hemisphere", () => {
  it("has its long nights in June, not December", () => {
    const june = trackerObservationPeriod(SYDNEY.lat, SYDNEY.lon, at("2026-06-21T12:00:00Z"));
    const december = trackerObservationPeriod(SYDNEY.lat, SYDNEY.lon, at("2026-12-21T12:00:00Z"));
    expect(hours(june)).toBeGreaterThan(hours(december));
  });
});
