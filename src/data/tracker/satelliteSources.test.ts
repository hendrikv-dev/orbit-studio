import { describe, expect, it } from "vitest";

import {
  deploymentFiles,
  epochOf,
  parseElementSets,
  segmentFor,
  stackOf,
} from "./satelliteSources";

/**
 * A two-segment ephemeris in the shape CelesTrak publishes one, six hours apart.
 *
 * Constructed rather than copied: the repository's provenance review found no
 * grant for redistributing CelesTrak's data, and the format is what these tests
 * are about.
 */
const ISS_EPHEMERIS = `STATION [Segment 01]
1 99001U 26900A   26245.50000000  .00000000  00000+0  00000+0 0  9998
2 99001  51.6400   6.0000 0005000  90.0000 298.0000 15.49000000000016
STATION [Segment 02]
1 99001U 26900A   26245.75000000  .00000000  00000+0  00000+0 0  9990
2 99001  51.6400   4.5000 0005000  90.0000 152.0000 15.49000000000023
`;

/** A post-deployment file in the same shape: the stack, and one satellite of it. */
const DEPLOYMENT = `STARLINK-G15-23 STACK
1 99002U 26901A   26245.40000000  .00000000  00000+0  00000+0 0  9999
2 99002  70.0000  28.0000 0010000 275.0000 156.0000 16.06000000000010
STARLINK-G15-23 SINGLE
1 99003U 26901B   26245.40000000  .00000000  00000+0  00000+0 0  9995
2 99003  70.0000  28.0000 0010000 275.0000 156.5000 16.06000000000019
`;

describe("reading element sets", () => {
  it("takes the epoch from the element set rather than from anywhere else", () => {
    // 2026 day 245.5 is 2 September, midday UTC.
    expect(epochOf("1 99001U 26900A   26245.50000000  .00000000  00000+0  00000+0 0  9998")).toBe(
      "2026-09-02T12:00:00.000Z",
    );
  });

  it("reads the format's own two-digit year convention", () => {
    // 57 and above is the twentieth century; the format has said so since Sputnik.
    expect(epochOf("1 00005U 58002B   58002.50000000  .00000000  00000+0  00000+0 0    01")).toBe(
      "1958-01-02T12:00:00.000Z",
    );
  });

  it("parses a three-line block into its parts", () => {
    const sets = parseElementSets(ISS_EPHEMERIS);
    expect(sets).toHaveLength(2);
    expect(sets[0].name).toBe("STATION [Segment 01]");
    expect(sets[0].catalogNumber).toBe("99001");
    expect(sets[1].epochUtc).toBe("2026-09-02T18:00:00.000Z");
  });

  it("ignores anything that is not a pair of element lines", () => {
    expect(parseElementSets("nothing here\nnor here\n")).toHaveLength(0);
    expect(parseElementSets("")).toHaveLength(0);
  });
});

describe("choosing a segment", () => {
  const sets = parseElementSets(ISS_EPHEMERIS);

  /**
   * A segmented ephemeris exists so a prediction can use the arc it is about.
   * Taking the first segment for every moment throws away the rest of it.
   */
  it("uses the segment whose epoch is nearest the moment being asked about", () => {
    expect(segmentFor(sets, new Date("2026-09-02T13:00:00Z"))?.name).toBe("STATION [Segment 01]");
    expect(segmentFor(sets, new Date("2026-09-02T17:00:00Z"))?.name).toBe("STATION [Segment 02]");
  });

  it("still answers outside the span it covers", () => {
    expect(segmentFor(sets, new Date("2026-09-04T00:00:00Z"))?.name).toBe("STATION [Segment 02]");
    expect(segmentFor([], new Date())).toBeNull();
  });
});

describe("finding a deployment", () => {
  /**
   * The narrowness is the point. The constellation-wide `starlink` file is
   * eleven thousand on-station satellites and describes no deployment at all;
   * matching it would turn the whole constellation into a "train".
   */
  it("names only post-deployment stack files", () => {
    const index = `
      <a href="sup-gp.php?FILE=starlink&FORMAT=csv">Starlink</a>
      <a href="sup-gp.php?FILE=starlink-g15-23&FORMAT=csv">G15-23</a>
      <a href="sup-gp.php?FILE=starlink-g15-23&FORMAT=tle">G15-23</a>
      <a href="sup-gp.php?FILE=oneweb&FORMAT=csv">OneWeb</a>
      <a href="sup-gp.php?FILE=iss&FORMAT=csv">ISS</a>`;
    expect(deploymentFiles(index)).toEqual(["starlink-g15-23"]);
  });

  it("finds nothing on an index with no deployment on it", () => {
    expect(deploymentFiles("<a href='sup-gp.php?FILE=gps&FORMAT=csv'>GPS</a>")).toEqual([]);
    expect(deploymentFiles("")).toEqual([]);
  });

  it("takes the stack and not the sample satellite", () => {
    const stack = stackOf(parseElementSets(DEPLOYMENT));
    expect(stack?.name).toContain("STACK");
    // The stack's epoch is the deployment: 2026 day 245.4 is 2 September at
    // 09:36 UTC, and that is where `deployedUtc` comes from.
    expect(stack?.epochUtc.slice(0, 19)).toBe("2026-09-02T09:36:00");
  });

  it("reports no stack rather than falling back to one satellite", () => {
    const single = parseElementSets(DEPLOYMENT).filter((set) => set.name.includes("SINGLE"));
    expect(stackOf(single)).toBeNull();
  });
});
