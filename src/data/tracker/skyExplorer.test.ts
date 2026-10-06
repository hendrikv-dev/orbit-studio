import { describe, expect, it } from "vitest";

import { expectedSkyContext } from "./skyFinderContext";
import { positionForSkyFinderTarget } from "./skyFinder";
import {
  CONSTELLATIONS,
  filterSkySearch,
  skyTargetEquipmentLabel,
  skySearchCatalog,
  solarSystemTargets,
  stationSearchEntries,
} from "./skyExplorer";

describe("Sky 2.0 browse catalogue", () => {
  const at = new Date("2026-10-05T05:00:00Z");

  it("addresses exactly all 88 IAU constellation identities", () => {
    expect(CONSTELLATIONS).toHaveLength(88);
    expect(new Set(CONSTELLATIONS.map((item) => item.symbol)).size).toBe(88);
    expect(CONSTELLATIONS.map((item) => item.name)).toEqual(expect.arrayContaining(["Orion", "Serpens", "Carina", "Pyxis"]));
  });

  it("searches every required solar-system body including Pluto", () => {
    const targets = solarSystemTargets(at);
    expect(targets.map((item) => item.title)).toEqual([
      "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
    ]);
    expect(Object.fromEntries(targets.map((item) => [item.title, item.equipment]))).toMatchObject({
      Saturn: "eyes",
      Uranus: "binoculars",
      Neptune: "telescope",
      Pluto: "telescope",
    });
    expect(skyTargetEquipmentLabel(targets.find((item) => item.title === "Sun")!)).toBe("Certified solar filter");
    expect(skyTargetEquipmentLabel(targets.find((item) => item.title === "Neptune")!)).toBe("Telescope");
    const catalog = skySearchCatalog(at);
    expect(filterSkySearch(catalog, "Neptune")[0]?.target.source).toEqual({ kind: "body", body: "Neptune" });
    expect(filterSkySearch(catalog, "Orion")[0]?.kind).toBe("constellation");
    expect(filterSkySearch(catalog, "Sirius")[0]?.kind).toBe("star");
  });

  it("keeps one searchable identity when a recommendation references a catalogued object", () => {
    const catalogued = filterSkySearch(skySearchCatalog(at), "Great Orion Nebula")[0];
    const catalog = skySearchCatalog(at, [{
      ...catalogued,
      id: "recommendation-m42",
      subtitle: "Tonight recommendation",
      target: { ...catalogued.target, id: "recommendation-m42" },
    }]);

    expect(filterSkySearch(catalog, "Great Orion Nebula").map((entry) => entry.title)).toEqual([
      "Great Orion Nebula",
    ]);
  });

  it("keeps rendered and camera presentation on the identical celestial solution", () => {
    const saturn = solarSystemTargets(at).find((item) => item.title === "Saturn")!;
    const observer = { latitudeDeg: 45.5152, longitudeDeg: -122.6784 };
    const beforeToggle = positionForSkyFinderTarget(saturn, observer, at);
    const afterToggle = positionForSkyFinderTarget(saturn, observer, at);
    expect(afterToggle).toEqual(beforeToggle);
  });

  it("derives the Milky Way orientation and constellation figures in the real ENU frame", () => {
    const orion = filterSkySearch(skySearchCatalog(at), "Orion")[0].target;
    const observer = { latitudeDeg: 45.5152, longitudeDeg: -122.6784 };
    const centre = positionForSkyFinderTarget(orion, observer, at)!;
    const context = expectedSkyContext(orion, observer, at, centre);
    expect(context.milkyWay.length).toBeGreaterThan(0);
    expect(context.figures.some((figure) => figure.symbol === "Ori" && figure.primary)).toBe(true);
    expect(context.lines.filter((line) => line.constellation === "Ori").every((line) => line.startStarId > 0 && line.endStarId > 0)).toBe(true);
  });

  it("models crewed stations as an extensible collection rather than excluding Tiangong", () => {
    const line1 = "1 48274U 21035A   26245.50000000  .00000000  00000+0  00000+0 0  9998";
    const line2 = "2 48274  41.4700   6.0000 0005000  90.0000 298.0000 15.60000000000016";
    const entries = stationSearchEntries([{ id: "tiangong", name: "Tiangong", catalogNumber: "48274", source: "gp", segments: [{ name: "TIANGONG", line1, line2, epochUtc: "2026-09-02T12:00:00.000Z", catalogNumber: "48274" }] }], at);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ title: "Tiangong", kind: "station" });
    expect(entries[0].target.source.kind).toBe("tle");
  });
});
