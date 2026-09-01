import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The repository says which licence covers what, and keeps saying it.
 *
 * ## Why this is a test
 *
 * Because the failure mode is a sentence. "Open-source tools for exploring
 * orbital data" was true of Orbit Studio when there were two products in it and
 * became a licence claim about a third the day Tracker shipped. Nothing breaks
 * when copy like that comes back — it renders perfectly, it reads well, and it
 * grants a licence nobody meant to grant. So the wording is checked the way a
 * contract is: by looking for the specific claim that must not be made.
 */

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
/**
 * The same text with its hard wrapping removed.
 *
 * These are prose documents wrapped at eighty columns, so a phrase the reader
 * sees as one sentence is a phrase with a newline in the middle of it. Matching
 * the wrapped form would make the tests fail on a reflow rather than on a
 * change of meaning.
 */
const flowed = (relative: string) => read(relative).replace(/\s+/g, " ");

describe("the repository's licence boundary", () => {
  it("keeps both licences and the map between them", () => {
    expect(read("LICENSE")).toContain("MIT License");
    const tracker = read("LICENSE-TRACKER");
    expect(tracker).toContain("All rights reserved");
    const map = read("LICENSES.md");
    for (const covered of ["src/components/tracker/**", "src/data/tracker/**", "public/tracker/**"]) {
      expect(map, `LICENSES.md should name ${covered}`).toContain(covered);
    }
  });

  /**
   * Nothing here is retroactive, and the documents have to keep saying so.
   *
   * Code published under MIT stays available under MIT at the commits where it
   * was published. A licence change that quietly implied otherwise would be
   * claiming to withdraw a permission that cannot be withdrawn.
   */
  it("does not claim to relicense what was already published", () => {
    for (const file of ["LICENSES.md", "LICENSE-TRACKER"]) {
      expect(flowed(file).toLowerCase(), file).toMatch(/not retroactive/);
      expect(flowed(file), file).toMatch(/remain available under the MIT License/);
    }
  });

  it("leaves third-party terms alone, and says so", () => {
    const map = read("LICENSES.md");
    expect(map).toMatch(/third-party/i);
    expect(map).toContain("THIRD_PARTY_NOTICES.md");
    expect(map).toContain("ATTRIBUTION.md");
    expect(map).toContain("provenance/inventory.json");
  });

  /**
   * The suite-wide claim, specifically.
   *
   * Not "the word open-source appears" — Explorer and Playground are open
   * source and saying so is the point. What must not come back is a sentence
   * that makes the claim about Orbit Studio as a whole, because Tracker is part
   * of Orbit Studio.
   */
  it("makes no suite-wide open-source claim in the README", () => {
    const readme = read("README.md");
    const banned = [
      /Orbit Studio is an open-source/i,
      /Orbit Studio is an independent, open-source project/i,
      /^Open-source tools/im,
    ];
    for (const pattern of banned) {
      expect(readme, `README should not say ${pattern}`).not.toMatch(pattern);
    }
    // And it still identifies the two that are.
    expect(readme).toMatch(/Explorer.*open source/i);
    expect(readme).toMatch(/Playground.*open source/i);
  });

  /**
   * The homepage is checked as rendered, not as source.
   *
   * The first version of this read the component file, and failed on the
   * comment explaining why the old sentence was removed — which quotes it. What
   * matters is what reaches the page, so the page is what gets read. The
   * rendered assertions live in `OrbitStudioHome.test.tsx`, beside the
   * renderer.
   */
  it("keeps the two licences discoverable from the README", () => {
    const readme = read("README.md");
    expect(readme).toContain("LICENSES.md");
    expect(readme).toContain("LICENSE-TRACKER");
  });
});
