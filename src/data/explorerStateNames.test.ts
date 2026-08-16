import { describe, expect, it } from "vitest";
import satelliteWebCatalog from "./generated/satelliteCatalog.web.json";
import { explorerStateName, isKnownExplorerStateCode } from "./explorerStateNames";

const artifact = satelliteWebCatalog as unknown as {
  rowSchema: string[];
  rows: (string | number | null)[][];
};
const stateIndex = artifact.rowSchema.indexOf("stateCode");

describe("GCAT state codes", () => {
  it("covers every code in the shipped snapshot", () => {
    const unmapped = new Set<string>();
    for (const row of artifact.rows) {
      const code = row[stateIndex];
      if (typeof code !== "string" || !code || code === "-") continue;
      if (!isKnownExplorerStateCode(code)) unmapped.add(code);
    }
    // A rebuild that introduces a new state must be noticed here rather than
    // shipping a bare code to a student.
    expect([...unmapped]).toEqual([]);
  });

  it("resolves the code that produced the defect", () => {
    // A Kosmos fragment read "Operator KVR / Region KVR"; KVR is an owner
    // organisation and RU is the state.
    expect(explorerStateName("RU")).toBe("Russia");
  });

  it("keeps historical states distinct from their successors", () => {
    expect(explorerStateName("SU")).toBe("Soviet Union");
    expect(explorerStateName("RU")).toBe("Russia");
    expect(explorerStateName("CSSR")).toBe("Czechoslovakia");
    expect(explorerStateName("CZ")).toBe("Czechia");
  });

  it("reads GCAT's single-letter codes as GCAT means them", () => {
    // Not ISO 3166: "I" is Italy here, not India; "E" is Spain.
    expect(explorerStateName("F")).toBe("France");
    expect(explorerStateName("I")).toBe("Italy");
    expect(explorerStateName("IN")).toBe("India");
    expect(explorerStateName("E")).toBe("Spain");
    expect(explorerStateName("D")).toBe("Germany");
  });

  it("names international organisations", () => {
    expect(explorerStateName("I-ESA")).toBe("European Space Agency");
    expect(explorerStateName("I-INT")).toBe("Intelsat");
  });

  it("returns nothing where no state is recorded", () => {
    expect(explorerStateName("-")).toBeNull();
    expect(explorerStateName("")).toBeNull();
    expect(explorerStateName(undefined)).toBeNull();
    expect(explorerStateName(null)).toBeNull();
  });

  it("passes an unknown code through rather than inventing one", () => {
    expect(explorerStateName("ZZ")).toBe("ZZ");
    expect(isKnownExplorerStateCode("ZZ")).toBe(false);
  });
});
