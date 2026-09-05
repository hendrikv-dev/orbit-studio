import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG_AUTHORITIES } from "../release/source-identity.mjs";
import { reviewScenarios } from "./scenarios/index.mjs";

const runnerSource = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "run-review.mjs"),
  "utf8",
);

/**
 * Every review surface has to say whether it certifies the current catalog.
 *
 * The release verifier decides what to demand of a state from its declared
 * authority, so a scenario that forgets to declare one would have its states
 * rejected in CI rather than here. Adding a workspace review is meant to be one
 * scenario module and one registry entry; this is the part of that contract a
 * new module is most likely to miss.
 */
describe("review scenario catalog authority", () => {
  it("is declared by every registered scenario", () => {
    for (const scenario of reviewScenarios) {
      expect(CATALOG_AUTHORITIES, `${scenario.id} declares an unknown catalog authority`)
        .toContain(scenario.catalogAuthority);
    }
  });

  it("is declared by at least one scenario that certifies the catalog", () => {
    expect(reviewScenarios.some((scenario) => scenario.catalogAuthority === "current-catalog"))
      .toBe(true);
  });
});

/**
 * The two properties that make the contract more than a formality.
 *
 * Both are about the runner rather than any one scenario, and both are the kind
 * of thing an ordinary-looking edit could undo without any test noticing: the
 * package would still be generated, still be verified, and quietly certify
 * nothing. They are asserted against the runner's source because what is being
 * pinned is the shape of the code, not a value it computes.
 */
describe("the review runner owns what it certifies", () => {
  /**
   * Stamped after the scenario's own state is spread.
   *
   * Spread first and the scenario wins, which would let a captured surface
   * choose the authority the verifier then trusts — a state could disclaim the
   * catalog it had just rendered, and the release rule would pass by asking the
   * wrong question.
   */
  it("stamps the catalog authority after a scenario's state, not before", () => {
    expect(runnerSource).toMatch(/\.\.\.state,\s*catalogAuthority,/);
    expect(runnerSource).not.toMatch(/catalogAuthority,\s*\.\.\.state/);
  });

  /**
   * Written through unchanged.
   *
   * A refused service is captured as a console error before any application
   * code sees it, so the temptation when a fixture is noisy is to drop the
   * noisy entries on the way out. That would make the clean-console rule
   * unfalsifiable. The fixtures are what get fixed; this list does not.
   */
  it("writes captured diagnostics through without filtering them", () => {
    expect(runnerSource).toMatch(/^\s*browserDiagnostics,\s*$/m);
    expect(runnerSource).not.toMatch(/browserDiagnostics\s*[.:]?\s*=?\s*browserDiagnostics\.filter/);
    expect(runnerSource).not.toMatch(/browserDiagnostics\.(filter|splice|slice)\(/);
  });

  it("is reading the real runner, not an emptied copy", () => {
    expect(runnerSource).toMatch(/function catalogAuthorityOf/);
    expect(runnerSource).toMatch(/attachBrowserDiagnostics/);
    expect(runnerSource.length).toBeGreaterThan(10_000);
  });
});
