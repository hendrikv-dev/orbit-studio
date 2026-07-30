import { describe, expect, it } from "vitest";
import { validateReleaseSource } from "./source-identity.mjs";

const identity = {
  kind: "git",
  repositoryRoot: ".",
  gitCommit: "abc123",
  gitDirty: false,
  gitStatusEntryCount: 0,
  trackedFileCount: 12,
  sourceFileCount: 12,
  sourceTreeHash: "sha256:source",
};

const validReview = {
  schemaVersion: 6,
  build: "orbit-studio@0.1.0",
  gitCommit: identity.gitCommit,
  gitDirty: false,
  currentCatalogMode: "release-public-gcat",
  currentCatalogRecordCount: 0,
  latestPublicCatalogMembershipCount: 33_489,
  source: { ...identity },
  scenarios: [{ id: "explorer" }],
  states: [{
    id: "startup",
    dataCoverage: { status: "latest-public-catalog" },
    datasets: {
      currentCatalogMode: "release-public-gcat",
      currentCatalogRecordCount: 0,
      latestPublicCatalogMembershipCount: 33_489,
    },
  }, {
    id: "historical",
    dataCoverage: { status: "historical-loaded" },
    datasets: {
      currentCatalogMode: "release-public-gcat",
      currentCatalogRecordCount: 0,
      latestPublicCatalogMembershipCount: 0,
    },
  }],
  milestoneValidations: [{ pass: true }],
  playbackDeterminismValidations: [{ pass: true }],
  populationValidations: [{ pass: true }, { pass: true }],
  browserDiagnostics: [],
};

const artifacts = {
  "review.json": true,
  "REVIEW_NOTES.md": true,
  "timeline.mp4": true,
  "timeline.csv": true,
  "screenshots/*.webp": true,
};

describe("release source validation", () => {
  it("accepts a clean review package tied to the authoritative source", () => {
    expect(validateReleaseSource({
      identity,
      reviewDocument: validReview,
      expectedBuild: "orbit-studio@0.1.0",
      artifacts,
    })).toEqual([]);
  });

  it("rejects captured states whose catalog provenance metadata is absent", () => {
    const failures = validateReleaseSource({
      identity,
      reviewDocument: {
        ...validReview,
        states: validReview.states.map(({ datasets: _datasets, ...state }) => state),
      },
      expectedBuild: "orbit-studio@0.1.0",
      artifacts,
    });

    expect(failures).toContain("review-state-current-catalog-unsafe");
  });

  it("rejects dirty, mismatched, incomplete, or diagnostically failed evidence", () => {
    const failures = validateReleaseSource({
      identity: { ...identity, gitDirty: true, gitStatusEntryCount: 1, sourceFileCount: 13 },
      reviewDocument: {
        ...validReview,
        gitCommit: "stale",
        currentCatalogMode: "local-acquired",
        currentCatalogRecordCount: 1,
        source: { ...identity, gitCommit: "stale" },
        states: [{
          id: "startup",
          datasets: {
            currentCatalogMode: "local-acquired",
            currentCatalogRecordCount: 1,
          },
        }],
        browserDiagnostics: [{ kind: "console-error", text: "failure" }],
      },
      expectedBuild: "orbit-studio@0.1.0",
      artifacts: { ...artifacts, "timeline.mp4": false },
    });

    expect(failures).toContain("source-dirty");
    expect(failures).toContain("untracked-source-present");
    expect(failures).toContain("review-source-gitCommit-mismatch");
    expect(failures).toContain("legacy-commit-mismatch");
    expect(failures).toContain("review-current-catalog-mode-unsafe");
    expect(failures).toContain("review-current-catalog-records-present");
    expect(failures).toContain("review-state-current-catalog-unsafe");
    expect(failures).toContain("review-state-latest-public-catalog-too-small");
    expect(failures).toContain("browser-diagnostics-present");
    expect(failures).toContain("artifact-missing:timeline.mp4");
  });
});
