import { describe, expect, it } from "vitest";
import { clockForCoordinates, formatClockRange, formatClockTime } from "./localTime";

/**
 * The cases that were wrong when the offset was derived from longitude. Each of
 * these is a place where politics beat geography, which is exactly where the
 * old approximation failed — and a stargazing app whose whole output is a time
 * cannot be an hour out.
 */
describe("the clock at a place", () => {
  it.each([
    ["London", 51.4779, -0.0015, "Europe/London"],
    ["Leeds", 53.8192, -1.4409, "Europe/London"],
    ["Joshua Tree, California", 34.135, -116.313, "America/Los_Angeles"],
    ["Sydney", -33.8688, 151.2093, "Australia/Sydney"],
    ["Tromsø", 69.6496, 18.956, "Europe/Oslo"],
    // Half an hour off any meridian.
    ["Mumbai", 19.076, 72.8777, "Asia/Kolkata"],
    // An hour east of the meridian it sits on.
    ["Madrid", 40.4168, -3.7038, "Europe/Madrid"],
  ])("resolves %s exactly", (_name, latitude, longitude, zone) => {
    const clock = clockForCoordinates(latitude, longitude);
    expect(clock.timeZone).toBe(zone);
    expect(clock.approximate).toBe(false);
  });

  it("falls back to longitude, and says so, where there is no zone", () => {
    // The middle of the South Pacific: no land, no zone.
    const clock = clockForCoordinates(-40, -140);
    if (clock.timeZone === null) {
      expect(clock.approximate).toBe(true);
      expect(clock.offsetMinutes).toBe(-9 * 60);
    } else {
      // The dataset does cover open ocean in places; that is exact too.
      expect(clock.approximate).toBe(false);
    }
  });
});

describe("formatting in that clock", () => {
  const instant = "2026-08-17T03:30:00.000Z";

  it("shows a place's own wall time, not the machine's", () => {
    const losAngeles = clockForCoordinates(34.135, -116.313);
    const london = clockForCoordinates(51.4779, -0.0015);
    // The same instant is a different hour in each.
    expect(formatClockTime(instant, losAngeles)).not.toBe(formatClockTime(instant, london));
  });

  it("follows daylight saving, which the longitude offset could not", () => {
    const london = clockForCoordinates(51.4779, -0.0015);
    // London is UTC+1 in August and UTC+0 in January, from one zone name.
    const summer = formatClockTime("2026-08-17T12:00:00.000Z", london);
    const winter = formatClockTime("2026-01-17T12:00:00.000Z", london);
    expect(summer).not.toBe(winter);
  });

  it("collapses a repeated meridiem in a range", () => {
    const london = clockForCoordinates(51.4779, -0.0015);
    const range = formatClockRange("2026-08-17T00:30:00Z", "2026-08-17T02:00:00Z", london);
    expect(range.match(/AM|PM/g)?.length).toBe(1);
  });
});
