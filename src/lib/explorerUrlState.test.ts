import { describe, expect, it } from "vitest";
import { readExplorerUrlState, writeExplorerUrlState } from "./explorerUrlState";

describe("reading Explorer state from a URL", () => {
  it("reads a full link", () => {
    expect(
      readExplorerUrlState("?app=explorer&view=population&regime=leo&object=gcat-s25544&year=1998"),
    ).toEqual({ view: "population", regime: "leo", object: "gcat-s25544", year: 1998 });
  });

  it("returns nulls for a bare Explorer link", () => {
    expect(readExplorerUrlState("?app=explorer")).toEqual({
      view: null, regime: null, object: null, year: null,
    });
  });

  it("ignores a view it does not recognise", () => {
    // A stale link to a view that no longer exists must not blank the app.
    expect(readExplorerUrlState("?view=lifetime").view).toBeNull();
    expect(readExplorerUrlState("?view=../../etc").view).toBeNull();
  });

  it("rejects a year outside the validated range", () => {
    for (const year of ["1600", "3000", "not-a-year", "1998.5", ""]) {
      expect(readExplorerUrlState(`?year=${year}`).year).toBeNull();
    }
    expect(readExplorerUrlState("?year=1957").year).toBe(1957);
  });
});

describe("writing Explorer state to a URL", () => {
  const base = { view: "globe" as const, regime: "all", object: null, year: null, defaultYear: 2026 };

  it("writes nothing for the default state", () => {
    expect(writeExplorerUrlState("?app=explorer", base)).toBe("?app=explorer");
  });

  it("keeps parameters it does not own", () => {
    const href = writeExplorerUrlState("?app=explorer&spike=tracker", {
      ...base, view: "debris",
    });
    expect(href).toContain("app=explorer");
    expect(href).toContain("spike=tracker");
    expect(href).toContain("view=debris");
  });

  it("omits the default year but keeps any other", () => {
    expect(writeExplorerUrlState("", { ...base, year: 2026 })).toBe("");
    expect(writeExplorerUrlState("", { ...base, year: 1998 })).toBe("?year=1998");
  });

  it("clears state when it returns to default", () => {
    const selected = writeExplorerUrlState("?app=explorer", {
      ...base, view: "population", regime: "leo", object: "gcat-s25544",
    });
    expect(selected).toContain("object=gcat-s25544");
    const cleared = writeExplorerUrlState(selected, base);
    expect(cleared).toBe("?app=explorer");
  });

  it("round-trips through read", () => {
    const href = writeExplorerUrlState("?app=explorer", {
      view: "debris", regime: "geo", object: "gcat-s00011", year: 1974, defaultYear: 2026,
    });
    expect(readExplorerUrlState(href)).toEqual({
      view: "debris", regime: "geo", object: "gcat-s00011", year: 1974,
    });
  });

  it("encodes an id that needs escaping", () => {
    const href = writeExplorerUrlState("", { ...base, object: "deb Kosmos-2251 #3" });
    expect(href).not.toContain(" ");
    expect(readExplorerUrlState(href).object).toBe("deb Kosmos-2251 #3");
  });
});
