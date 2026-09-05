import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SATELLITE_CLOCK, TRACKER_FIXTURE_AT } from "./tracker-fixtures.mjs";

/**
 * The accessibility gate is read as source rather than imported: the module
 * runs the whole gate on import, which is a browser session, not a unit test.
 */
const gateFile = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "accessibility.mjs"),
  "utf8",
);
/**
 * Comment lines removed, code lines kept whole.
 *
 * Deliberately line-based. A regex that hunts for block-comment openers also
 * finds the one inside a route glob such as a doubled-star wildcard before
 * "api.weather.gov", and then eats every line up to the next closer — which
 * silently deletes the code these guards are supposed to be reading, and makes
 * them pass by finding nothing at all.
 */
function stripComments(text) {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      );
    })
    .join("\n");
}

const gateCode = stripComments(gateFile);

const reviewScenario = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../review/scenarios/tracker.mjs"),
  "utf8",
);

describe("accessibility gate determinism", () => {
  /**
   * The regression itself.
   *
   * `RUN_AT` used to be `new Date()` with only the hour forced, so the date
   * moved with the calendar and the fixtures below it were stamped from the
   * real clock while the page was pinned to 05:00. This test fails against that
   * version.
   */
  it("takes nothing from the wall clock", () => {
    expect(gateCode).not.toMatch(/new Date\(\s*\)/);
    expect(gateCode).not.toMatch(/Date\.now\(\)/);
  });

  it("pins one whole instant, not just an hour", () => {
    expect(gateCode).toMatch(/const RUN_AT = TRACKER_FIXTURE_AT;/);
    expect(TRACKER_FIXTURE_AT.toISOString()).toBe("2026-09-03T05:00:00.000Z");
  });

  /**
   * A constant cannot move with the host, which is the whole point: whatever
   * date, timezone or DST state the machine is in, the gate scans the same sky.
   */
  it("resolves to the same instant whatever the host clock says", () => {
    const asIf = (iso) => {
      const host = new Date(iso);
      // What the old implementation would have produced on that host date.
      const old = new Date(
        Date.UTC(host.getUTCFullYear(), host.getUTCMonth(), host.getUTCDate(), 5, 30, 0),
      );
      return { old: old.toISOString(), now: TRACKER_FIXTURE_AT.toISOString() };
    };
    const dates = [
      "2026-09-04T22:35:00Z",
      "2026-09-05T00:46:00Z",
      "2027-01-01T12:00:00Z",
      "2026-03-08T09:30:00Z",
    ];
    const pinned = new Set(dates.map((d) => asIf(d).now));
    const drifting = new Set(dates.map((d) => asIf(d).old));
    expect(pinned.size).toBe(1);
    expect(drifting.size).toBe(dates.length);
  });

  it("stamps its weather and cloud fixtures from the pinned instant", () => {
    expect(gateCode).toMatch(/const start = new Date\(RUN_AT\);/);
    expect(gateCode).toMatch(/updateTime: RUN_AT\.toISOString\(\)/);
    expect(gateCode).toMatch(/observedUtc: RUN_AT\.toISOString\(\)/);
    expect(gateCode).toMatch(/new Date\(RUN_AT\.getTime\(\)/);
  });

  it("shares its instant with the Tracker review instead of keeping a copy", () => {
    expect(gateCode).toMatch(/from "\.\/tracker-fixtures\.mjs"/);
    expect(reviewScenario).toMatch(/const REVIEW_AT = TRACKER_FIXTURE_AT;/);
    expect(SATELLITE_CLOCK).toBe(TRACKER_FIXTURE_AT);
  });
});

describe("accessibility gate source guards", () => {
  it("is reading the real gate, not an emptied copy", () => {
    expect(gateCode).toMatch(/async function chooseFirstResult/);
    expect(gateCode).toMatch(/async function openDetail/);
    expect(gateCode.length).toBeGreaterThan(10_000);
  });
});

describe("accessibility gate state setup", () => {
  const before = (needle) => gateCode.indexOf(needle);

  it("establishes the observing location itself before asking for rail content", () => {
    const chooses = before('chooseFirstResult(page, "Joshua Tree Village Campground")');
    const opens = before("await openDetail(page)");
    expect(chooses).toBeGreaterThan(-1);
    expect(opens).toBeGreaterThan(-1);
    expect(chooses).toBeLessThan(opens);
  });

  /**
   * A bare Tracker has no rail, and the gate says so before it selects
   * anything. If that assertion ever passes by accident — because a place
   * leaked in from storage or a previous scenario — this is where it shows.
   */
  it("asserts a bare Tracker offers no rail until a place is chosen", () => {
    expect(gateCode).toMatch(/\.tk-rail"\)\.count\(\)\) === 0/);
    expect(gateCode).toMatch(/const TRACKER = `\$\{PREVIEW_ORIGIN\}\/\?app=tracker`/);
  });

  /**
   * Every scenario opens its own context, so nothing survives between them:
   * no localStorage, no cookies, no permission grant, no service worker.
   */
  it("gives every scenario a fresh browser context with no stored state", () => {
    const contexts = gateCode.match(/browser\.newContext\(/g) ?? [];
    expect(contexts.length).toBeGreaterThanOrEqual(4);
    expect(gateCode).not.toMatch(/storageState/);
  });

  it("seeds a place only where it also opens its own context for it", () => {
    // The narrow and reduced-motion scans seed a confirmed place through
    // addInitScript on their own context, which is establishing state, not
    // inheriting it.
    const seeds = gateCode.match(/addInitScript/g) ?? [];
    const contexts = gateCode.match(/browser\.newContext\(/g) ?? [];
    expect(seeds.length).toBeLessThanOrEqual(contexts.length);
  });
});
