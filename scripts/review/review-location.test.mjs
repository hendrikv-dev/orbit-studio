import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertOutsideRepository,
  commitDirectoryName,
  DEFAULT_REVIEW_DIRNAME,
  isInsideRepository,
  resolveReviewRoot,
  reviewPaths,
  revisionName,
} from "./review-location.mjs";

const REPO = "/Users/someone/projects/orbit-studio";

describe("where review evidence is allowed to go", () => {
  it("uses the configured directory when one is set", () => {
    expect(
      resolveReviewRoot({ env: { ORBIT_REVIEW_OUTPUT_DIR: "/var/evidence" }, repoRoot: REPO }),
    ).toBe("/var/evidence");
  });

  it("falls back to a predictable sibling of the repository", () => {
    expect(resolveReviewRoot({ env: {}, repoRoot: REPO })).toBe(
      path.join("/Users/someone/projects", DEFAULT_REVIEW_DIRNAME),
    );
  });

  it("ignores an empty or blank setting rather than writing to the working directory", () => {
    for (const value of ["", "   "]) {
      expect(resolveReviewRoot({ env: { ORBIT_REVIEW_OUTPUT_DIR: value }, repoRoot: REPO })).toBe(
        path.join("/Users/someone/projects", DEFAULT_REVIEW_DIRNAME),
      );
    }
  });
});

describe("the repository boundary", () => {
  /**
   * The rule the brief is emphatic about: `.gitignore` is not a boundary. A
   * gitignored folder still ships in an archive of the working tree, still
   * looks like source to anyone reading the directory, and still disappears
   * under `git clean -x`. So the check is on the path, and it refuses.
   */
  it("rejects the repository itself", () => {
    expect(isInsideRepository(REPO, REPO)).toBe(true);
  });

  it("rejects anything beneath it, gitignored or not", () => {
    for (const inside of ["review", "review/tracker-pass", "node_modules/x", ".git/evidence"]) {
      expect(isInsideRepository(path.join(REPO, inside), REPO)).toBe(true);
    }
  });

  it("rejects a path that climbs back in through a relative segment", () => {
    expect(isInsideRepository(`${REPO}/../orbit-studio/review`, REPO)).toBe(true);
  });

  it("allows a sibling whose name merely starts the same way", () => {
    // `/a/orbit-studio-reviews` is not inside `/a/orbit-studio`, and a naive
    // `startsWith` without the separator would say it is.
    expect(isInsideRepository("/Users/someone/projects/orbit-studio-reviews", REPO)).toBe(false);
  });

  it("allows a genuine sibling and an unrelated absolute path", () => {
    expect(isInsideRepository("/Users/someone/projects/reviews", REPO)).toBe(false);
    expect(isInsideRepository("/var/evidence", REPO)).toBe(false);
  });

  it("throws with a usable reason when the destination is inside", () => {
    expect(() => assertOutsideRepository(path.join(REPO, "review"), REPO)).toThrow(
      /inside the repository/i,
    );
    expect(() => assertOutsideRepository(path.join(REPO, "review"), REPO)).toThrow(
      /ORBIT_REVIEW_OUTPUT_DIR/,
    );
  });

  it("returns the resolved path when the destination is acceptable", () => {
    expect(assertOutsideRepository("/var/evidence/../evidence", REPO)).toBe("/var/evidence");
  });
});

describe("one commit, one directory", () => {
  it("names a package by its date and hash", () => {
    expect(commitDirectoryName("2026-09-03T18:15:53.309Z", "81b1b1a")).toBe("2026-09-03_81b1b1a");
  });

  it("refuses anything that is not a commit hash", () => {
    expect(() => commitDirectoryName("2026-09-03", "HEAD")).toThrow(/commit hash/i);
    expect(() => commitDirectoryName("2026-09-03", "")).toThrow(/commit hash/i);
  });

  it("refuses a date it cannot order by", () => {
    expect(() => commitDirectoryName("yesterday", "81b1b1a")).toThrow(/ISO date/i);
  });

  it("gives different commits different directories", () => {
    const a = commitDirectoryName("2026-09-03T10:00:00Z", "aaaaaaa");
    const b = commitDirectoryName("2026-09-03T10:00:00Z", "bbbbbbb");
    expect(a).not.toBe(b);
  });
});

describe("append-only history", () => {
  it("uses the plain name when nothing exists for the commit", () => {
    expect(revisionName("2026-09-03_81b1b1a", [])).toEqual({
      name: "2026-09-03_81b1b1a",
      revision: 1,
    });
  });

  /**
   * Regenerating evidence for a commit must never destroy what was inspected
   * the first time. The original is what somebody actually looked at; a second
   * run is a second opinion, not a correction of the record.
   */
  it("never reuses a name that already exists", () => {
    expect(revisionName("2026-09-03_81b1b1a", ["2026-09-03_81b1b1a"])).toEqual({
      name: "2026-09-03_81b1b1a-r2",
      revision: 2,
    });
  });

  it("keeps counting past revisions that already exist", () => {
    expect(
      revisionName("2026-09-03_81b1b1a", [
        "2026-09-03_81b1b1a",
        "2026-09-03_81b1b1a-r2",
        "2026-09-03_81b1b1a-r3",
      ]),
    ).toEqual({ name: "2026-09-03_81b1b1a-r4", revision: 4 });
  });

  it("is not confused by another commit's directories", () => {
    expect(
      revisionName("2026-09-03_81b1b1a", ["2026-09-03_e5dfe5a", "2026-09-03_e5dfe5a-r2"]),
    ).toEqual({ name: "2026-09-03_81b1b1a", revision: 1 });
  });
});

describe("the shape of the history", () => {
  it("keeps commit evidence and aggregate passes apart", () => {
    const paths = reviewPaths("/var/evidence");
    expect(paths.commits).toBe("/var/evidence/tracker/commits");
    expect(paths.passes).toBe("/var/evidence/tracker/passes");
    expect(paths.commits).not.toBe(paths.passes);
  });
});
