import { describe, expect, it } from "vitest";
import {
  createExplorerScenario,
  explorerSnapshotView,
  explorerSnapshots,
  getHistoricalCatalog,
} from "./explorerCatalog";
import {
  createExplorerVisibilityState,
  isExplorerEntryVisible,
  representativeConstellationShells,
  representativeConstellationSatellites,
  resolveExplorerVisibility,
  summarizeExplorerConstellation,
} from "./explorerVisibility";

const currentSnapshot = explorerSnapshots[explorerSnapshots.length - 1];

describe("Explorer visibility hierarchy", () => {
  it("keeps ground stations out of the default rendered layer state", () => {
    const view = explorerSnapshotView(currentSnapshot);
    const visibility = createExplorerVisibilityState();
    const goldstone = view.byId.get("explorer-goldstone")!;
    const resolved = resolveExplorerVisibility(
      view,
      view.records,
      visibility,
      Number.POSITIVE_INFINITY,
    );

    expect(isExplorerEntryVisible(goldstone, visibility)).toBe(false);
    expect(resolved.groundStationIds).not.toContain(goldstone.id);
  });

  it("resolves global layer, constellation, and individual visibility independently", () => {
    const view = explorerSnapshotView(currentSnapshot);
    const constellation = view.byId.get("explorer-gps-constellation")!;
    const member = view.byId.get("explorer-gps")!;
    const visibility = createExplorerVisibilityState();

    expect(isExplorerEntryVisible(member, visibility)).toBe(true);

    visibility.constellations[constellation.id] = false;
    expect(isExplorerEntryVisible(member, visibility)).toBe(false);

    visibility.constellations[constellation.id] = true;
    visibility.constellationSatellites[constellation.id] = false;
    expect(isExplorerEntryVisible(member, visibility)).toBe(false);

    visibility.constellationSatellites[constellation.id] = true;
    visibility.objects[member.id] = false;
    expect(isExplorerEntryVisible(member, visibility)).toBe(false);

    visibility.objects[member.id] = true;
    visibility.layers.constellations = false;
    expect(isExplorerEntryVisible(member, visibility)).toBe(false);

    visibility.layers.constellations = true;
    visibility.layers.payloads = false;
    expect(isExplorerEntryVisible(member, visibility)).toBe(false);
  });

  it("resolves a bounded marker set and representative constellation orbit controls", () => {
    const view = explorerSnapshotView(currentSnapshot);
    const visibility = createExplorerVisibilityState();
    visibility.constellationOrbits["explorer-gps-constellation"] = true;
    visibility.constellationShells["explorer-gps-constellation"] = true;
    visibility.constellations["explorer-starlink-constellation"] = false;

    const resolved = resolveExplorerVisibility(
      view,
      view.records,
      visibility,
      40,
      "explorer-iss",
    );

    expect(resolved.satelliteIds.length).toBeLessThanOrEqual(40);
    expect(resolved.representativeOrbitConstellationIds).toContain(
      "explorer-gps-constellation",
    );
    expect(resolved.shellConstellationIds).toContain("explorer-gps-constellation");
    expect(
      resolved.satelliteIds.some((id) =>
        view.byId.get(id)?.constellationId === "explorer-starlink-constellation"
      ),
    ).toBe(false);
  });

  it("keeps a filter-excluded selected satellite visible as an explicit exception", () => {
    const view = explorerSnapshotView(currentSnapshot);
    const visibility = createExplorerVisibilityState();
    const hubble = view.byId.get("explorer-hubble")!;
    const geoEntries = view.records.filter(
      (entry) =>
        entry.orbit &&
        Math.abs(entry.orbit.altitudeKm - 35_786) < 3_000 &&
        entry.orbit.eccentricity < 0.18,
    );
    const resolved = resolveExplorerVisibility(
      view,
      geoEntries,
      visibility,
      Number.POSITIVE_INFINITY,
      hubble.id,
    );

    expect(geoEntries).not.toContain(hubble);
    expect(resolved.satelliteIds).toContain(hubble.id);
    expect(resolved.visibleObjectIds.has(hubble.id)).toBe(true);
  });

  it("returns to the normal filtered population after selection closes", () => {
    const view = explorerSnapshotView(currentSnapshot);
    const visibility = createExplorerVisibilityState();
    const hubble = view.byId.get("explorer-hubble")!;
    const debrisEntries = view.records.filter((entry) => entry.categoryId === "debris");
    const selected = resolveExplorerVisibility(
      view,
      debrisEntries,
      visibility,
      Number.POSITIVE_INFINITY,
      hubble.id,
    );
    const cleared = resolveExplorerVisibility(
      view,
      debrisEntries,
      visibility,
      Number.POSITIVE_INFINITY,
      null,
    );

    expect(selected.satelliteIds).toContain(hubble.id);
    expect(cleared.satelliteIds).not.toContain(hubble.id);
  });

  it("resolves metadata-constrained historical members without current-catalog fallback", () => {
    const view = getHistoricalCatalog("2015-06-01T12:00:00.000Z");
    const iss = view.records.find((entry) => entry.catalogNumber === "25544");
    const hubble = view.records.find((entry) => entry.catalogNumber === "20580");
    const sceneEntries = view.records.filter(
      (entry) => entry.selectionKind === "satellite" && entry.visualRole === "selectable-orbital-object",
    );
    const resolved = resolveExplorerVisibility(
      view,
      sceneEntries,
      createExplorerVisibilityState(),
      Number.POSITIVE_INFINITY,
      null,
    );

    expect(iss?.selectionKind).toBe("satellite");
    expect(iss?.orbitAvailability).toBe("reconstructed-historical-orbit");
    expect(hubble?.selectionKind).toBe("satellite");
    expect(hubble?.orbitAvailability).toBe("reconstructed-historical-orbit");
    expect(view.renderableOrbitStateCount).toBeGreaterThan(1_500);
    expect(sceneEntries).toHaveLength(view.renderableOrbitStateCount);
    expect(resolved.satelliteIds).toHaveLength(view.renderableOrbitStateCount);
    expect(
      resolved.satelliteIds.some(
        (id) => view.byId.get(id)?.sourceId === "celestrak-gp-snapshot",
      ),
    ).toBe(false);
  });

  it("summarizes systems and creates a small representative plane set", () => {
    const scenario = createExplorerScenario(currentSnapshot);
    const starlink = scenario.constellations.find(
      (constellation) => constellation.id === "explorer-starlink-constellation",
    )!;
    const summary = summarizeExplorerConstellation(starlink, scenario.satellites);
    const representatives = representativeConstellationSatellites(
      starlink,
      scenario.satellites,
    );
    const shells = representativeConstellationShells(starlink, scenario.satellites);

    expect(summary.memberCount).toBe(0);
    expect(summary.orbitalClassification.toLowerCase()).toContain("low earth orbit");
    expect(summary.shellCount).toBeGreaterThan(1);
    expect(summary.inclinationFamilies).toBeGreaterThan(1);
    expect(summary.systemPopulation).toBeGreaterThanOrEqual(summary.memberCount);
    expect(new Set(summary.shells.map((shell) => shell.color)).size).toBe(summary.shellCount);
    expect(summary.shells.map((shell) => shell.inclinationDeg)).toEqual([53, 53.2, 70, 97.6]);
    expect(representatives.length).toBeGreaterThan(0);
    expect(representatives).toHaveLength(8);
    expect(shells.length).toBeGreaterThan(0);
    expect(shells.length).toBeLessThanOrEqual(8);
    expect(representatives.every((satellite) => satellite.visualization.showTrail)).toBe(true);
  });

  it("teaches first-class constellation architecture without inventing source members", () => {
    const scenario = createExplorerScenario(currentSnapshot);
    const galileo = scenario.constellations.find(
      (constellation) => constellation.id === "explorer-galileo-constellation",
    )!;
    const oneWeb = scenario.constellations.find(
      (constellation) => constellation.id === "explorer-oneweb-constellation",
    )!;

    const galileoSummary = summarizeExplorerConstellation(galileo, scenario.satellites);
    const galileoPlanes = representativeConstellationSatellites(galileo, scenario.satellites);
    const oneWebSummary = summarizeExplorerConstellation(oneWeb, scenario.satellites);

    expect(galileoSummary.memberCount).toBe(0);
    expect(galileoSummary.systemPopulation).toBeGreaterThanOrEqual(galileoSummary.memberCount);
    expect(galileoSummary.planeCount).toBe(3);
    expect(galileoSummary.altitudeRangeKm[0]).toBeGreaterThan(20_000);
    expect(galileoPlanes).toHaveLength(3);
    expect(oneWebSummary.orbitalClassification.toLowerCase()).toContain("polar");
    expect(oneWebSummary.inclinationValuesDeg[0]).toBeCloseTo(87.9, 1);
    expect(oneWebSummary.systemPopulation).toBeGreaterThan(galileoSummary.systemPopulation);
  });

  it("keeps the primary constellation visual signatures distinct", () => {
    const scenario = createExplorerScenario(currentSnapshot);
    const summaries = new Map(
      scenario.constellations
        .filter((constellation) =>
          [
            "explorer-starlink-constellation",
            "explorer-gps-constellation",
            "explorer-galileo-constellation",
            "explorer-oneweb-constellation",
            "explorer-iridium-constellation",
          ].includes(constellation.id),
        )
        .map((constellation) => [
          constellation.id,
          summarizeExplorerConstellation(constellation, scenario.satellites),
        ]),
    );
    const signatures = [...summaries.values()].map((summary) =>
      [
        summary.shellCount,
        summary.planeCount,
        summary.altitudeRangeKm.join("-"),
        summary.inclinationValuesDeg.join("-"),
        summary.systemPopulation,
      ].join(":"),
    );

    expect(new Set(signatures).size).toBe(5);
  });
});
