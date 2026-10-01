import { describe, expect, it } from "vitest";

import type { SkyConditions } from "./nakedEye";
import { parseElementSets } from "./satelliteSources";
import type { Deployment, IssEphemeris } from "./satelliteSources";
import { issOpportunities, satelliteOpportunities, trainVerdict } from "./satellites";

const PORTLAND = { latitudeDeg: 45.5152, longitudeDeg: -122.6784 };

/**
 * A station-like orbit, constructed here rather than acquired.
 *
 * Four hundred and seventeen kilometres up at 51.64°, which is the shape of the
 * orbit the Space Station is in, and chosen so it makes a high sunlit pass over
 * Portland in the pinned window. It is not a snapshot of anybody's catalogue:
 * CelesTrak's usage policy covers retrieving their data, and this repository's
 * own provenance review found no grant for committing or redistributing it, so
 * the fixtures are Orbit Studio's own elements rather than a copy of theirs.
 */
const ISS_GP: IssEphemeris = {
  source: "gp",
  segments: parseElementSets(`STATION
1 99001U 26900A   26245.50000000  .00000000  00000+0  00000+0 0  9998
2 99001  51.6400   6.0000 0005000  90.0000 298.0000 15.49000000000016
`),
};

const ISS_SUPGP: IssEphemeris = { source: "supgp", segments: ISS_GP.segments };

/**
 * A deployment-stack orbit, constructed to the shape a real one has.
 *
 * Seventy degrees and about 265 km, which is where a Starlink stack sits for
 * its first days and is the bright population the study measured. Its epoch is
 * the separation time, which is how CelesTrak publishes a post-deployment
 * vector and how `deployedUtc` is read.
 */
const STACK = parseElementSets(`STARLINK-G15-23 STACK
1 99002U 26901A   26245.40000000  .00000000  00000+0  00000+0 0  9999
2 99002  70.0000  28.0000 0010000 275.0000 156.0000 16.06000000000010
`)[0];

const DEPLOYMENT: Deployment = {
  file: "starlink-g15-23",
  stack: STACK,
  deployedUtc: STACK.epochUtc,
  catalogued: null,
};

const dark = (): SkyConditions => ({
  sunAltitudeDeg: -20,
  moonAltitudeDeg: -30,
  moonIlluminatedFraction: 0,
  artificialLightRadiance: null,
});

/**
 * One night, which both fixtures were built to cross.
 *
 * Portland's observing period for 2–3 September 2026, from the end of astronomical
 * twilight to its beginning again. The station goes nearly overhead in it and so
 * does the stack, which is what makes it the night to test both against.
 */
const NIGHT = { startUtc: "2026-09-03T02:46:00Z", endUtc: "2026-09-03T13:34:00Z" };
const TRAIN_NIGHT = NIGHT;
const ISS_NIGHT = NIGHT;

const inputs = (over: Partial<Parameters<typeof trainVerdict>[2]> = {}) => ({
  ...ISS_NIGHT,
  skyAt: dark,
  iss: ISS_GP,
  deployment: DEPLOYMENT,
  ...over,
});

describe("the Space Station", () => {
  it("is offered when it makes a lit pass in a dark sky", () => {
    const [iss] = issOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, inputs());
    expect(iss).toBeDefined();
    expect(iss.kind).toBe("satellite");
    expect(iss.guidance.equipment).toBe("eyes");
    expect(iss.guidance.direction).toMatch(/north|south|east|west/);
    expect(iss.profile.length).toBeGreaterThan(5);
    expect(iss.geometry).toMatchObject({ kind: "target" });
  });

  /**
   * The station passes over most places several times a week. A rail entry that
   * claimed otherwise would be borrowing the weight that belongs to an eclipse.
   */
  it("does not claim to be rare", () => {
    const [iss] = issOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, inputs());
    expect(iss.qualities.rarity).toBeLessThan(0.15);
  });

  /**
   * A pass is unusual by how high it goes, and never more than favourable.
   *
   * Without a significance the rail treats it as routine and drops it behind
   * the routine limit, which is how a fifty-degree pass ended up ranked below
   * four things nobody would choose over it. `notable` is the tier that means
   * news, and the station going over is not news however good the pass is.
   */
  it("earns its place by how high the pass goes, and never claims to be news", () => {
    const [iss] = issOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, inputs());
    expect(iss.significance).toBeDefined();
    expect(iss.significance!.tier).not.toBe("notable");
    expect(iss.significance!.reasons.join(" ")).toMatch(/\d+°/);
  });

  it("says where its orbit came from", () => {
    const [fromNasa] = issOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, inputs({ iss: ISS_SUPGP }));
    expect(fromNasa.limitations.join(" ")).toMatch(/NASA/i);
    const [fromCatalogue] = issOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, inputs());
    expect(fromCatalogue.limitations.join(" ")).toMatch(/public catalogue/i);
  });

  it("says the brightness is scaled from a measurement rather than computed", () => {
    const [iss] = issOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, inputs());
    expect(iss.limitations.join(" ")).toMatch(/measured standard magnitude/i);
  });

  it("offers one pass rather than every pass, so the rail stays a ranking", () => {
    const found = issOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, inputs());
    expect(found.length).toBeLessThanOrEqual(1);
  });

  /**
   * No orbit is not a faint orbit.
   *
   * If CelesTrak cannot be reached there is nothing to say about tonight, and
   * the absence has to be an absence rather than a stale pass from last week.
   */
  it("is absent when no orbit could be fetched", () => {
    expect(issOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, inputs({ iss: null }))).toEqual([]);
  });

  it("is absent in daylight, on the same test as everything else", () => {
    const daylit = () => ({ ...dark(), sunAltitudeDeg: 30 });
    expect(
      issOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, inputs({ skyAt: daylit })),
    ).toEqual([]);
  });
});

describe("a Starlink train", () => {
  const night = (over: Record<string, unknown> = {}) => inputs({ ...TRAIN_NIGHT, ...over });

  it("is offered for a real deployment, still low, passing overhead in the dark", () => {
    const verdict = trainVerdict(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, night());
    expect(verdict.offered).toBe(true);
    if (!verdict.offered) return;
    expect(verdict.opportunity.title).toMatch(/train/i);
    expect(verdict.opportunity.id).toContain("starlink-g15-23");
  });

  /**
   * The lowest confidence anything is offered at, and it says why in the copy.
   *
   * The orbit is SpaceX's own state vector and is not the doubt. The brightness
   * is an average over hundreds of other satellites standing in for these ones.
   */
  it("is honest that its brightness is an average and not a measurement of these", () => {
    const verdict = trainVerdict(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, night());
    if (!verdict.offered) throw new Error("expected a train");
    expect(verdict.opportunity.qualities.confidence).toBeLessThan(0.6);
    expect(verdict.opportunity.limitations.join(" ")).toMatch(/published average/i);
    expect(verdict.opportunity.limitations.join(" ")).toMatch(/spreading apart/i);
  });

  it("is absent when nothing has been deployed", () => {
    const verdict = trainVerdict(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, night({ deployment: null }));
    expect(verdict.offered).toBe(false);
    if (verdict.offered) return;
    expect(verdict.reason).toMatch(/no recent starlink deployment/i);
  });

  /**
   * A train is a train while the satellites are still together.
   *
   * Weeks later the same objects are still up there and still Starlink, and
   * there is no line to see. Offering one on the strength of the launch having
   * happened is the failure this guards.
   */
  it("is absent once the stack has had time to spread out", () => {
    const verdict = trainVerdict(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, {
      ...night(),
      startUtc: "2026-09-20T18:00:00Z",
      endUtc: "2026-09-21T12:00:00Z",
    });
    expect(verdict.offered).toBe(false);
    if (verdict.offered) return;
    expect(verdict.reason).toMatch(/spread out/i);
  });

  /**
   * Above 340 km the two brightness populations cannot be told apart from here.
   *
   * SpaceX dims them at 357, the study found nearly three magnitudes between
   * the two sides of that, and a stack raising its orbit crosses it in about a
   * day. Predicting the bright side right up to the line would be predicting on
   * the wrong side of it for a night.
   */
  it("is absent once the stack is near the height at which they are dimmed", () => {
    // The same deployment, propagated far enough forward that it has raised
    // past the confident band.
    const raised = parseElementSets(`STARLINK-G15-23 STACK
1 72000C 26201A   26245.40578750  .00067556  00000+0  92196-4 0    07
2 72000  70.0081 187.5107 0010256 275.6620  98.4982 15.62000000    15
`)[0];
    const verdict = trainVerdict(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, {
      ...night(),
      deployment: { file: "starlink-g15-23", stack: raised, deployedUtc: raised.epochUtc, catalogued: null },
    });
    expect(verdict.offered).toBe(false);
    if (verdict.offered) return;
    expect(verdict.reason).toMatch(/dim/i);
  });

  /**
   * Below 250 km the study excluded these objects as de-orbiting.
   *
   * So there is no measurement that describes them, and a prediction made from
   * the orbit-raising figures would be applying a number to a population it was
   * explicitly not measured on.
   */
  it("is absent below the height the brightness study covers", () => {
    const decaying = parseElementSets(`STARLINK-G15-23 STACK
1 72000C 26201A   26245.40578750  .00067556  00000+0  92196-4 0    07
2 72000  70.0081 187.5107 0010256 275.6620  98.4982 16.45000000    15
`)[0];
    const verdict = trainVerdict(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, {
      ...night(),
      deployment: { file: "starlink-g15-23", stack: decaying, deployedUtc: decaying.epochUtc, catalogued: null },
    });
    expect(verdict.offered).toBe(false);
    if (verdict.offered) return;
    expect(verdict.reason).toMatch(/below the height/i);
  });

  /**
   * The same pass, from a city, is withheld.
   *
   * Nothing about the deployment changed. What changed is how much of the
   * prediction's own uncertainty still fits between it and the sky.
   */
  it("is withheld under a bright sky where the margin no longer fits", () => {
    const city = () => ({ ...dark(), artificialLightRadiance: 40 });
    const verdict = trainVerdict(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, night({ skyAt: city }));
    expect(verdict.offered).toBe(false);
    if (verdict.offered) return;
    expect(verdict.reason).toMatch(/not brightly enough|does not pass high enough/i);
  });

  it("is absent where it does not pass", () => {
    // A 70° orbit's ground track reaches 70° south and a 265 km satellite is
    // above the horizon for perhaps fifteen degrees beyond that. The pole is
    // outside both.
    const verdict = trainVerdict(-89.5, 0, night());
    expect(verdict.offered).toBe(false);
    if (verdict.offered) return;
    expect(verdict.reason).toMatch(/does not pass high enough/i);
  });
});

describe("everything artificial, together", () => {
  it("returns the station and the train as separate answers", () => {
    const found = satelliteOpportunities(PORTLAND.latitudeDeg, PORTLAND.longitudeDeg, {
      ...inputs(),
      ...TRAIN_NIGHT,
    });
    expect(found.map((entry) => entry.id).some((id) => id === "satellite-iss")).toBe(true);
    expect(found.some((entry) => entry.id.startsWith("satellite-train-"))).toBe(true);
    for (const entry of found) expect(entry.kind).toBe("satellite");
  });
});
