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
  scenarios: [{ id: "explorer", catalogAuthority: "current-catalog" }],
  states: [{
    id: "startup",
    catalogAuthority: "current-catalog",
    dataCoverage: { status: "latest-public-catalog" },
    datasets: {
      currentCatalogMode: "release-public-gcat",
      currentCatalogRecordCount: 0,
      latestPublicCatalogMembershipCount: 33_489,
    },
  }, {
    id: "historical",
    catalogAuthority: "current-catalog",
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
          catalogAuthority: "current-catalog",
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

/**
 * The catalog-authority contract.
 *
 * The rule being protected is that a released package never carries the locally
 * acquired satellite catalog. What changed is only *which* states owe that
 * proof: the ones that declare they rendered the catalog. These cases exist to
 * prove that narrowing did not become a way out of the rule.
 */
describe("review state catalog authority", () => {
  const withStates = (states) => ({ ...validReview, states });
  const check = (states) =>
    validateReleaseSource({
      identity,
      reviewDocument: withStates(states),
      expectedBuild: "orbit-studio@0.1.0",
      artifacts,
    });

  const catalogState = (overrides = {}) => ({
    id: "explorer-state",
    catalogAuthority: "current-catalog",
    dataCoverage: { status: "latest-public-catalog" },
    datasets: {
      currentCatalogMode: "release-public-gcat",
      currentCatalogRecordCount: 0,
      latestPublicCatalogMembershipCount: 33_489,
    },
    ...overrides,
  });

  /** A Tracker-shaped state: a real surface that never loads the catalog. */
  const nonCatalogState = (overrides = {}) => ({
    id: "tracker-map-entry",
    catalogAuthority: "none",
    ...overrides,
  });

  it("accepts a catalog-bearing state that rendered the release-safe catalog", () => {
    expect(check([catalogState()])).toEqual([]);
  });

  it("rejects a catalog-bearing state that rendered the locally acquired catalog", () => {
    const failures = check([
      catalogState({ datasets: { currentCatalogMode: "local-acquired", currentCatalogRecordCount: 0 } }),
    ]);
    expect(failures).toContain("review-state-current-catalog-unsafe");
  });

  it("rejects a catalog-bearing state carrying current catalog rows", () => {
    const failures = check([
      catalogState({
        datasets: {
          currentCatalogMode: "release-public-gcat",
          currentCatalogRecordCount: 42,
          latestPublicCatalogMembershipCount: 33_489,
        },
      }),
    ]);
    expect(failures).toContain("review-state-current-catalog-unsafe");
  });

  it("rejects a catalog-bearing state with no catalog metadata at all", () => {
    const { datasets: _datasets, ...bare } = catalogState();
    expect(check([bare])).toContain("review-state-current-catalog-unsafe");
  });

  it("accepts a non-catalog state that carries no catalog metadata", () => {
    expect(check([catalogState(), nonCatalogState()])).toEqual([]);
  });

  /**
   * The masquerade this contract exists to stop: shipping catalog metadata while
   * declaring the state does not certify the catalog. Disclaiming authority has
   * to forbid the metadata, not excuse it, or "none" becomes a way to smuggle a
   * local catalog past the rule above.
   */
  it("rejects a non-catalog state that still carries a catalog identity", () => {
    const failures = check([
      catalogState(),
      nonCatalogState({
        datasets: { currentCatalogMode: "local-acquired", currentCatalogRecordCount: 9 },
      }),
    ]);
    expect(failures).toContain("review-state-catalog-authority-mismatch");
  });

  it("rejects a non-catalog state that carries only a catalog version", () => {
    const failures = check([
      catalogState(),
      nonCatalogState({ datasets: { catalogVersion: "2026-08-01" } }),
    ]);
    expect(failures).toContain("review-state-catalog-authority-mismatch");
  });

  it("rejects a state that declares no authority at all", () => {
    const { catalogAuthority: _authority, ...undeclared } = catalogState();
    expect(check([undeclared])).toContain("review-state-catalog-authority-missing");
  });

  it("rejects an unrecognised authority rather than treating it as exempt", () => {
    const failures = check([catalogState(), nonCatalogState({ catalogAuthority: "not-applicable" })]);
    expect(failures).toContain("review-state-catalog-authority-missing");
  });

  /**
   * The whole-package escape hatch: if every state could declare "none", the
   * rule would still be satisfied while certifying nothing.
   */
  it("rejects a package in which nothing certifies the catalog", () => {
    const failures = check([nonCatalogState(), nonCatalogState({ id: "tracker-rail-expanded" })]);
    expect(failures).toContain("review-catalog-states-missing");
  });
});

/**
 * The browser-diagnostics contract.
 *
 * A deterministic review must reach the end with a clean console. These cases
 * pin that the rule is about the captured list itself, whatever a diagnostic
 * happens to be about, so no future fixture can be made to pass by teaching the
 * verifier to ignore a category of error.
 */
describe("review browser diagnostics", () => {
  const withDiagnostics = (browserDiagnostics) =>
    validateReleaseSource({
      identity,
      reviewDocument: { ...validReview, browserDiagnostics },
      expectedBuild: "orbit-studio@0.1.0",
      artifacts,
    });

  it("accepts a review that captured nothing", () => {
    expect(withDiagnostics([])).toEqual([]);
  });

  it("rejects a console error", () => {
    expect(withDiagnostics([{ scenarioId: "tracker", kind: "console-error", text: "boom" }]))
      .toContain("browser-diagnostics-present");
  });

  it("rejects a page error", () => {
    expect(withDiagnostics([{ scenarioId: "tracker", kind: "page-error", text: "TypeError" }]))
      .toContain("browser-diagnostics-present");
  });

  it("rejects a failed resource, which is the shape a refused service takes", () => {
    expect(withDiagnostics([{
      scenarioId: "tracker",
      kind: "console-error",
      text: "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
    }])).toContain("browser-diagnostics-present");
  });

  it("rejects a console warning that was captured, without grading it", () => {
    expect(withDiagnostics([{ scenarioId: "explorer", kind: "console-warning", text: "slow" }]))
      .toContain("browser-diagnostics-present");
  });

  it("rejects a diagnostics list that is missing rather than empty", () => {
    expect(withDiagnostics(undefined)).toContain("browser-diagnostics-present");
  });
});
