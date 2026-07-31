import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { getSatelliteReadouts, propagateSatellite, sampleSatelliteGroundTrack } from "../lib/propagation";
import { keplerianToCartesian, orbitalPeriodSeconds, speedKmS } from "../physics/kepler";
import { explorerRegimeForEntry } from "./explorerFilters";
import {
  createExplorerCurrentSnapshot,
  createExplorerScenario,
  currentExplorerSnapshot,
  explorerCategoryIds,
  explorerCanonicalCatalogView,
  explorerEntryForId,
  explorerHistoricalTimelineAvailable,
  filterExplorerCatalogSnapshot,
  getHistoricalCatalog,
  prioritizeExplorerSearchResults,
  validateExplorerRuntimeCatalogHealth,
  explorerSnapshotForYear,
  explorerSnapshotNearestToYear,
  explorerSnapshotTimelinePosition,
  explorerSnapshotView,
  explorerSnapshots,
  explorerTimelineSnapshots,
  explorerVisibleTimelinePosition,
} from "./explorerCatalog";

function circularDegreesBetween(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180);
}

function vectorAngularSeparationDeg(left: [number, number, number], right: [number, number, number]): number {
  const leftMagnitude = Math.hypot(...left);
  const rightMagnitude = Math.hypot(...right);
  const dot =
    left[0] * right[0] +
    left[1] * right[1] +
    left[2] * right[2];
  const cosine = Math.min(1, Math.max(-1, dot / (leftMagnitude * rightMagnitude)));
  return Math.acos(cosine) * 180 / Math.PI;
}

describe("Explorer catalog scenario", () => {
  it("opens orbital history at the first supported period end with a non-empty, honest scene", () => {
    const first = explorerTimelineSnapshots[0];
    const view = explorerSnapshotView(first);
    const scenario = createExplorerScenario(first);
    const sputnik = view.records.find((entry) => entry.catalogNumber === "2");
    const sputnik2 = view.records.find((entry) => entry.catalogNumber === "3");
    const sputnikSatellite = scenario.satellites.find(
      (satellite) => satellite.catalogMetadata?.catalogNumber === "2",
    )!;
    const sputnikPosition = propagateSatellite(sputnikSatellite, new Date(first.timestampIso)).positionKm;

    expect(first.timestampIso).toBe("1957-12-31T12:00:00.000Z");
    expect(sputnik?.name).toBe("Sputnik 1");
    expect(sputnik?.orbitAvailability).toBe("reconstructed-historical-orbit");
    expect(sputnik2?.categoryId).toBe("payloads");
    expect(view.records.length).toBeGreaterThan(0);
    expect(scenario.satellites.map((satellite) => satellite.catalogMetadata?.catalogNumber))
      .toEqual(expect.arrayContaining(["2", "3"]));
    expect(sputnikPosition.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...sputnikPosition)).toBeGreaterThan(EARTH_RADIUS_KM);
  });

  it("uses annual period-end membership without extending ended objects", () => {
    const firstPeriod = getHistoricalCatalog("1957-10-04T19:28:33.000Z");
    const afterDecay = getHistoricalCatalog("1958-01-05T00:00:00.000Z");

    expect(firstPeriod.snapshot.timestampIso).toBe("1957-12-31T12:00:00.000Z");
    expect(firstPeriod.records.some((entry) => entry.catalogNumber === "2")).toBe(true);
    expect(afterDecay.records.some((entry) => entry.catalogNumber === "2")).toBe(false);
  });

  it("grows the visible historical population across review milestones", () => {
    const milestones = [1957, 1965, 1980, 1990, 2000, 2015].map((year) =>
      explorerSnapshotView(explorerSnapshotForYear(year)).renderableOrbitStateCount,
    );

    expect(milestones[0]).toBeGreaterThan(0);
    milestones.slice(1).forEach((count, index) => {
      expect(count).toBeGreaterThan(milestones[index]);
    });
  });

  it("preserves historical LEO, MEO, GEO, and HEO regimes from source constraints", () => {
    const view = getHistoricalCatalog("2015-06-01T12:00:00.000Z");
    const regimes = new Set(view.records.map(explorerRegimeForEntry));

    expect(regimes.has("leo")).toBe(true);
    expect(regimes.has("meo")).toBe(true);
    expect(regimes.has("geo")).toBe(true);
    expect(regimes.has("heo")).toBe(true);
  });

  it("maps current requests onto the latest canonical public snapshot", () => {
    const timestampUtc = "2026-07-17T23:53:42.000Z";
    const snapshot = createExplorerCurrentSnapshot(timestampUtc);
    expect(snapshot).toBe(currentExplorerSnapshot);
    expect(snapshot.timestampIso).toBe("2026-06-27T22:13:02Z");
    expect(snapshot.label).toBe("Latest public catalog");
    expect(() => createExplorerCurrentSnapshot("invalid")).toThrow(RangeError);
  });

  it("builds a static current snapshot with consistent selectable orbital records", () => {
    const currentSnapshot = currentExplorerSnapshot;
    const scenario = createExplorerScenario(currentSnapshot);
    const iss = scenario.satellites.find((satellite) => satellite.id === "explorer-iss");

    expect(scenario.selectedObjectId).toBeNull();
    expect(scenario.selectedObjectType).toBe("none");
    expect(scenario.regions).toHaveLength(0);
    expect(scenario.coverageSettings.enabled).toBe(false);
    expect(iss).toBeDefined();
    expect(iss?.keplerian.semiMajorAxisKm).toBeGreaterThan(EARTH_RADIUS_KM + 380);
    expect(iss?.keplerian.semiMajorAxisKm).toBeLessThan(EARTH_RADIUS_KM + 450);
    expect(iss?.keplerian.eccentricity).toBeLessThan(0.01);
    expect(iss?.keplerian.inclinationDeg).toBeGreaterThan(51);
    expect(iss?.keplerian.inclinationDeg).toBeLessThan(52);
    expect(iss?.propagationMode).toBe("two-body");
    expect(iss?.tle).toBeUndefined();
    expect(scenario.renderSettings.earthCloudOpacity).toBeLessThan(0.1);
    expect(scenario.renderSettings.atmosphereIntensity).toBeLessThan(0.2);
    expect(
      scenario.satellites.filter((satellite) => satellite.visualization.showTrail),
    ).toHaveLength(0);
    scenario.satellites.forEach((satellite) => {
      const entry = explorerEntryForId(satellite.id, currentSnapshot);
      expect(entry?.selectionKind).toBe("satellite");
      expect(entry?.visualRole).toBe("selectable-orbital-object");
    });
  });

  it("uses the same propagated state for the globe and analytical ground track", () => {
    const scenario = createExplorerScenario(currentExplorerSnapshot);
    const satellite = scenario.satellites.find((item) => item.id === "explorer-iss")!;
    const date = new Date(scenario.simulationTimeUtc);
    const readouts = getSatelliteReadouts(satellite, date);
    const firstTrackPoint = sampleSatelliteGroundTrack(
      satellite,
      date,
      orbitalPeriodSeconds(satellite.keplerian.semiMajorAxisKm),
      120,
    )[0];

    expect(firstTrackPoint.latitudeDeg).toBeCloseTo(readouts.latitudeDeg, 8);
    expect(firstTrackPoint.longitudeDeg).toBeCloseTo(readouts.longitudeDeg, 8);
  });

  it("exposes the complete latest public GCAT snapshot without a current-data fallback", () => {
    const early = explorerSnapshotView(explorerSnapshots[0]);
    const current = explorerSnapshotView(currentExplorerSnapshot);

    expect([...current.categoryCounts.keys()]).toEqual(explorerCategoryIds);
    explorerCategoryIds.forEach((categoryId) => {
      expect(current.categoryCounts.get(categoryId)).toBeGreaterThan(0);
    });
    expect(early.dataCoverage.status).toBe("historical-loaded");
    expect(early.snapshot.year).toBe("1957");
    expect(early.records.length).toBeGreaterThan(0);
    expect(early.catalogObjectCount).toBe(early.records.length);
    expect(early.renderableOrbitStateCount).toBeGreaterThan(0);
    expect(early.byId.has("explorer-iss")).toBe(false);
    expect(current.byId.has("explorer-iss")).toBe(true);
    expect(current.dataCoverage.status).toBe("latest-public-catalog");
    expect(current.dataCoverage.label).toBe("GCAT membership · reconstructed positions");
    expect(current.dataCoverage.description).toContain("complete GCAT Earth-object snapshot");
    expect(current.dataCoverage.description).toContain("not live tracking or exact observations");
    expect(current.dataCoverage.description).not.toMatch(/renderable orbit states/i);
    expect(current.catalogObjectCount).toBe(33_489);
    expect(current.renderableOrbitStateCount).toBe(33_468);
    expect(current.dataCoverage.catalogOnlyObjectCount).toBe(21);
    expect(current.renderableOrbitStateCount).toBeGreaterThan(early.renderableOrbitStateCount);
    expect(current.records.length).toBeGreaterThan(10);
    expect(current.records.every((entry) => entry.sourceId !== "celestrak-gp-snapshot")).toBe(true);
    expect(current.records.filter((entry) => entry.orbit).every((entry) => entry.tle === undefined))
      .toBe(true);
  });

  it("builds historical scenarios from the selected historical snapshot without current fallback", () => {
    const earlySnapshot = explorerSnapshots[0];
    const earlyScenario = createExplorerScenario(earlySnapshot);
    const currentScenario = createExplorerScenario(currentExplorerSnapshot);

    expect(earlyScenario.simulationTimeUtc).toBe(earlySnapshot.timestampIso);
    expect(earlyScenario.satellites.some((satellite) => satellite.catalogMetadata?.catalogNumber === "25544")).toBe(false);
    expect(
      earlyScenario.satellites.some(
        (satellite) => satellite.catalogMetadata?.sourceId === "celestrak-gp-snapshot",
      ),
    ).toBe(false);
    expect(earlyScenario.satellites.length).toBe(
      explorerSnapshotView(earlySnapshot).renderableOrbitStateCount,
    );
    expect(earlyScenario.satellites.length).toBeGreaterThan(0);
    expect(earlyScenario.catalogLayers).toHaveLength(0);
    expect(currentScenario.satellites.some((satellite) => satellite.id === "explorer-iss")).toBe(true);
    expect(currentScenario.satellites.length).toBeGreaterThan(earlyScenario.satellites.length);
  });

  it("uses one historical catalog pipeline for snapshot views and rendered scenarios", () => {
    const earlyDate = "1956-01-01T00:00:00.000Z";
    const earlyWorld = getHistoricalCatalog(earlyDate);
    const currentWorld = getHistoricalCatalog(currentExplorerSnapshot);
    const currentScenario = createExplorerScenario(currentExplorerSnapshot);
    const renderableWorldIds = currentWorld.records
      .filter(
        (entry) =>
          entry.selectionKind === "satellite" &&
          entry.visualRole === "selectable-orbital-object" &&
          entry.orbit,
      )
      .map((entry) => entry.id)
      .sort();

    expect(earlyWorld.snapshot.year).toBe("1957");
    expect(earlyWorld.records).toHaveLength(2);
    expect(explorerSnapshotView(explorerSnapshots[0]).records).toEqual(
      getHistoricalCatalog(explorerSnapshots[0]).records,
    );
    expect(currentScenario.satellites.map((satellite) => satellite.id).sort()).toEqual(
      renderableWorldIds,
    );
    expect(explorerEntryForId("celestrak-25544", explorerSnapshots[0])).toBeUndefined();
  });

  it("uses milestone timeline positions without interpolated historical counts", () => {
    const apollo = explorerSnapshots.find((snapshot) => snapshot.year === "1969")!;
    const iss = explorerSnapshots.find((snapshot) => snapshot.year === "1998")!;
    const midpoint = explorerSnapshotForYear(2006.5);
    const currentPreviousYear = explorerSnapshotForYear(2025);
    const snappedIss = explorerSnapshotForYear(1998.2, { snap: true });

    expect(explorerSnapshotTimelinePosition(explorerSnapshots[0])).toBe(0);
    expect(explorerSnapshotTimelinePosition(explorerSnapshots[explorerSnapshots.length - 1])).toBe(1);
    expect(explorerSnapshots[0].year).toBe("1957");
    expect(explorerTimelineSnapshots[0].year).toBe("1957");
    expect(explorerTimelineSnapshots.some((snapshot) => snapshot.milestone === "Pre-Sputnik")).toBe(false);
    expect(explorerVisibleTimelinePosition(explorerTimelineSnapshots[0])).toBe(0);
    expect(explorerVisibleTimelinePosition(explorerTimelineSnapshots[explorerTimelineSnapshots.length - 1])).toBe(1);
    expect(explorerVisibleTimelinePosition(apollo)).toBeCloseTo((1969 - 1957) / (2026 - 1957), 8);
    expect(explorerSnapshotTimelinePosition(apollo)).toBeCloseTo((1969 - 1957) / (2026 - 1957), 8);
    expect(explorerSnapshotTimelinePosition(iss)).toBeCloseTo((1998 - 1957) / (2026 - 1957), 8);
    expect(explorerSnapshotNearestToYear(1968).id).toBe(apollo.id);
    expect(explorerSnapshotNearestToYear(2000).id).toBe(iss.id);
    expect(midpoint.id).toBe("timeline-2007");
    expect(midpoint.year).toBe("2007");
    expect(currentPreviousYear.id).toBe("timeline-2025");
    expect(currentPreviousYear.year).toBe("2025");
    expect("composition" in midpoint).toBe(false);
    expect(explorerHistoricalTimelineAvailable).toBe(true);
    expect(snappedIss.id).toBe(iss.id);
  });

  it("keeps runtime catalog, search, inspector, counts, and rendered set tied to the selected historical date", () => {
    const defaults = {
      query: "",
      categoryId: "all" as const,
      status: "all" as const,
      operator: "all",
      constellationId: "all",
    };
    const earliest = getHistoricalCatalog("1956-01-01T00:00:00.000Z");
    const midSixties = getHistoricalCatalog("1965-01-01T12:00:00.000Z");
    const twentyFifteen = getHistoricalCatalog("2015-06-01T12:00:00.000Z");
    const twentyTwenty = getHistoricalCatalog("2020-01-01T12:00:00.000Z");
    const current = explorerSnapshotView(currentExplorerSnapshot);
    const earliestScenario = createExplorerScenario(earliest.snapshot);
    const midSixtiesScenario = createExplorerScenario(midSixties.snapshot);
    const twentyFifteenScenario = createExplorerScenario(twentyFifteen.snapshot);
    const twentyTwentyScenario = createExplorerScenario(twentyTwenty.snapshot);

    expect(earliest.snapshot.year).toBe("1957");
    expect(earliest.records).toHaveLength(2);
    expect(earliest.catalogObjectCount).toBe(2);
    expect(earliest.renderableOrbitStateCount).toBe(2);
    expect(filterExplorerCatalogSnapshot(earliest, { ...defaults, query: "Sputnik" })).toHaveLength(1);
    expect(earliestScenario.satellites).toHaveLength(2);
    expect(earliestScenario.catalogLayers).toHaveLength(0);

    expect(midSixties.records.length).toBeGreaterThan(0);
    expect(midSixties.catalogObjectCount).toBe(midSixties.records.length);
    expect(midSixties.renderableOrbitStateCount).toBeGreaterThan(500);
    expect(midSixties.dataCoverage.reconstructedHistoricalOrbitStateCount)
      .toBe(midSixties.renderableOrbitStateCount);
    expect(midSixties.dataCoverage.catalogOnlyObjectCount).toBeLessThan(midSixties.records.length);
    expect(midSixties.dataCoverage.description).not.toMatch(/renderable orbit states/i);
    expect(midSixties.records.every((entry) =>
      !entry.launchDate || Date.parse(entry.launchDate) <= Date.parse(midSixties.snapshot.timestampIso),
    )).toBe(true);
    expect(filterExplorerCatalogSnapshot(midSixties, { ...defaults, query: "STARLINK-37656" })).toHaveLength(0);
    expect(midSixties.records.some((entry) => entry.catalogNumber === "25544")).toBe(false);
    expect(midSixtiesScenario.satellites).toHaveLength(midSixties.renderableOrbitStateCount);
    expect(midSixtiesScenario.catalogLayers).toHaveLength(0);

    const twentyFifteenStarlink = twentyFifteen.records.find((entry) => entry.catalogNumber === "44235");

    expect(twentyFifteen.records.length).toBeGreaterThan(1_500);
    expect(twentyFifteen.catalogObjectCount).toBe(twentyFifteen.records.length);
    expect(twentyFifteen.renderableOrbitStateCount).toBeGreaterThan(1_500);
    expect(twentyFifteen.dataCoverage.reconstructedHistoricalOrbitStateCount)
      .toBe(twentyFifteen.renderableOrbitStateCount);
    expect(twentyFifteen.dataCoverage.catalogOnlyObjectCount).toBe(0);
    expect(twentyFifteen.dataCoverage.exactHistoricalOrbitStateCount).toBe(0);
    expect(twentyFifteen.records.every((entry) =>
      !entry.launchDate || Date.parse(entry.launchDate) <= Date.parse(twentyFifteen.snapshot.timestampIso),
    )).toBe(true);
    expect(twentyFifteen.records.some((entry) => entry.sourceId === "curated-reference"))
      .toBe(false);
    expect(twentyFifteenStarlink).toBeUndefined();
    expect(filterExplorerCatalogSnapshot(twentyFifteen, { ...defaults, query: "STARLINK-31" })).toHaveLength(0);
    expect(twentyFifteenScenario.satellites).toHaveLength(twentyFifteen.renderableOrbitStateCount);
    expect(twentyFifteenScenario.satellites.some((satellite) => satellite.id.startsWith("demo-25544"))).toBe(false);
    expect(twentyFifteenScenario.satellites.some((satellite) => satellite.catalogMetadata?.sourceId === "curated-reference")).toBe(false);
    expect(twentyFifteenScenario.satellites.some((satellite) => satellite.catalogMetadata?.catalogNumber === "44235")).toBe(false);
    expect(twentyFifteenScenario.catalogLayers).toHaveLength(0);

    expect(twentyTwenty.records.length).toBeGreaterThan(midSixties.records.length);
    expect(twentyTwenty.catalogObjectCount).toBe(twentyTwenty.records.length);
    expect(twentyTwenty.renderableOrbitStateCount).toBeGreaterThan(midSixties.renderableOrbitStateCount);
    expect(twentyTwenty.dataCoverage.reconstructedHistoricalOrbitStateCount)
      .toBe(twentyTwenty.renderableOrbitStateCount);
    expect(twentyTwenty.dataCoverage.catalogOnlyObjectCount).toBeGreaterThan(0);
    expect(twentyTwenty.records.every((entry) =>
      !entry.launchDate || Date.parse(entry.launchDate) <= Date.parse(twentyTwenty.snapshot.timestampIso),
    )).toBe(true);
    expect(filterExplorerCatalogSnapshot(twentyTwenty, { ...defaults, query: "STARLINK-37656" })).toHaveLength(0);
    expect(twentyFifteen.records.some((entry) => entry.catalogNumber === "44235")).toBe(false);
    expect(twentyTwentyScenario.satellites).toHaveLength(twentyTwenty.renderableOrbitStateCount);
    expect(twentyTwentyScenario.catalogLayers).toHaveLength(0);

    expect(current.dataCoverage.status).toBe("latest-public-catalog");
    expect(current.records.every((entry) => entry.sourceId !== "celestrak-gp-snapshot")).toBe(true);
    expect(createExplorerScenario(currentExplorerSnapshot).satellites.length).toBeGreaterThan(0);
  });

  it("filters indexed records by search, category, operator, and constellation", () => {
    const current = explorerSnapshotView(currentExplorerSnapshot);
    const defaults = {
      query: "",
      categoryId: "all" as const,
      status: "all" as const,
      operator: "all",
      constellationId: "all",
    };
    const iss = filterExplorerCatalogSnapshot(current, { ...defaults, query: "ISS" });
    const debris = filterExplorerCatalogSnapshot(current, {
      ...defaults,
      categoryId: "debris",
    });
    const starlink = filterExplorerCatalogSnapshot(current, {
      ...defaults,
      operator: "SpaceX",
      constellationId: "explorer-starlink-constellation",
    });
    const weather = filterExplorerCatalogSnapshot(current, {
      ...defaults,
      query: "weather",
    });
    const navigation = filterExplorerCatalogSnapshot(current, {
      ...defaults,
      query: "navigation",
    });
    const earthObservation = filterExplorerCatalogSnapshot(current, {
      ...defaults,
      query: "earth observation",
    });
    const commonIss = filterExplorerCatalogSnapshot(current, {
      ...defaults,
      query: "ISS",
    });

    expect(iss.some((entry) => entry.name === "International Space Station")).toBe(true);
    expect(debris.length).toBeGreaterThan(0);
    expect(debris.every((entry) => entry.categoryId === "debris")).toBe(true);
    expect(starlink.length).toBeGreaterThan(0);
    expect(starlink.every((entry) => entry.operator === "SpaceX")).toBe(true);
    expect(weather.some((entry) => entry.id === "explorer-noaa-constellation")).toBe(true);
    expect(navigation.some((entry) => entry.id === "explorer-galileo-constellation")).toBe(true);
    expect(navigation.some((entry) => entry.id === "explorer-gps-constellation")).toBe(true);
    expect(earthObservation.some((entry) => entry.id === "explorer-sentinel-constellation")).toBe(true);
    expect(commonIss.some((entry) => entry.id === "explorer-iss")).toBe(true);
    expect(commonIss.some((entry) => entry.name === "Apollo Program")).toBe(false);
    expect(commonIss.some((entry) => entry.name === "SWISSCUBE")).toBe(false);
  });

  it("maps every current orbital record into a selectable scenario object and constellation", () => {
    const currentSnapshot = currentExplorerSnapshot;
    const current = explorerSnapshotView(currentSnapshot);
    const scenario = createExplorerScenario(currentSnapshot);
    const orbitalRecords = current.records.filter(
      (entry) =>
        entry.selectionKind === "satellite" &&
        entry.visualRole === "selectable-orbital-object" &&
        entry.orbit,
    );
    const starlink = scenario.constellations.find(
      (constellation) => constellation.id === "explorer-starlink-constellation",
    );
    const noaa = scenario.constellations.find(
      (constellation) => constellation.id === "explorer-noaa-constellation",
    );
    const sentinel = scenario.constellations.find(
      (constellation) => constellation.id === "explorer-sentinel-constellation",
    );
    const galileo = scenario.constellations.find(
      (constellation) => constellation.id === "explorer-galileo-constellation",
    );
    const iridium = scenario.constellations.find(
      (constellation) => constellation.id === "explorer-iridium-constellation",
    );

    expect(scenario.satellites).toHaveLength(orbitalRecords.length);
    expect(starlink?.satelliteIds.length).toBeGreaterThan(900);
    expect(galileo?.satelliteIds.length).toBeGreaterThan(0);
    expect(noaa?.satelliteIds.length).toBeGreaterThan(20);
    expect(sentinel?.satelliteIds.length).toBeGreaterThan(0);
    expect(galileo).toBeDefined();
    expect(iridium).toBeDefined();
    expect(iridium?.satelliteIds.length).toBeGreaterThan(0);
    scenario.satellites.forEach((satellite) => {
      expect(current.byId.get(satellite.id)?.selectionKind).toBe("satellite");
    });
  });

  it("prioritizes the expected system-level result for common searches", () => {
    const current = explorerSnapshotView(currentExplorerSnapshot);
    const search = (query: string) =>
      prioritizeExplorerSearchResults(
        filterExplorerCatalogSnapshot(current, {
          query,
          categoryId: "all",
          status: "all",
          operator: "all",
          constellationId: "all",
        }),
        query,
      );

    expect(search("ISS")[0]?.id).toBe("explorer-iss");
    expect(search("ISS").length).toBeGreaterThan(0);
    expect(search("ISS").slice(0, 10).some((entry) => entry.name === "ISS (NAUKA)")).toBe(false);
    expect(search("Hubble")[0]?.id).toBe("explorer-hubble");
    expect(search("Hubble").length).toBeGreaterThan(1);
    expect(search("Hubble")[0]).toMatchObject({
      catalogNumber: "20580",
      objectType: "Science payload",
      selectionKind: "satellite",
    });
    expect(search("Starlink")[0]?.id).toBe("explorer-starlink-constellation");
    expect(search("Starlink").length).toBeGreaterThan(1);
    expect(search("GPS")[0]?.id).toBe("explorer-gps-constellation");
    expect(search("GPS").length).toBeGreaterThan(1);
    expect(search("Galileo")[0]?.id).toBe("explorer-galileo-constellation");
    expect(search("Galileo").length).toBeGreaterThan(1);
    expect(search("BeiDou")[0]?.id).toBe("explorer-beidou-constellation");
    expect(search("BeiDou").length).toBeGreaterThan(1);
    expect(search("Tiangong")).toHaveLength(0);
    expect(search("Voyager")[0]?.id).toBe("explorer-voyager-1");
    expect(search("Voyager").length).toBeGreaterThan(1);
    expect(search("JWST")[0]?.id).toBe("explorer-jwst");
    expect(filterExplorerCatalogSnapshot(explorerSnapshotView(explorerSnapshots[0]), {
      query: "ISS",
      categoryId: "all",
      status: "all",
      operator: "all",
      constellationId: "all",
    })).toHaveLength(0);
    expect(search("ISS")[0]?.id).toBe(
      prioritizeExplorerSearchResults(
        filterExplorerCatalogSnapshot(current, {
          query: "ISS",
          categoryId: "all",
          status: "all",
          operator: "all",
          constellationId: "all",
        }),
        "ISS",
      )[0]?.id,
    );
    expect(explorerCanonicalCatalogView.byId.get("explorer-iss")?.name).toBe(
      "International Space Station",
    );
  });

  it("keeps one explicit curated fallback record for recognizable missions absent from latest membership", () => {
    const current = explorerSnapshotView(currentExplorerSnapshot);
    const hubbleRecords = current.records.filter((entry) => entry.catalogNumber === "20580");
    const issRecords = current.records.filter((entry) => entry.id === "explorer-iss");

    expect(hubbleRecords.map((entry) => entry.id)).toEqual(["explorer-hubble"]);
    expect(issRecords.map((entry) => entry.id)).toEqual(["explorer-iss"]);
    expect(hubbleRecords[0]?.tle).toBeUndefined();
    expect(hubbleRecords[0]?.sourceId).toBe("curated-reference");
    expect(hubbleRecords[0]?.orbitAvailability).toBe("curated-reference-orbit");
    expect(issRecords[0]?.sourceId).toBe("curated-reference");
    expect(issRecords[0]?.orbitAvailability).toBe("curated-reference-orbit");
  });

  it("ships a substantial, classified public population without redistributed current GP records", () => {
    const current = explorerSnapshotView(currentExplorerSnapshot);
    const orbitalRecords = current.records.filter(
      (entry) => entry.selectionKind === "satellite" && Boolean(entry.orbit),
    );

    expect(validateExplorerRuntimeCatalogHealth()).toEqual([]);
    expect(orbitalRecords).toHaveLength(33_474);
    const gcatRecords = current.records.filter(
      (entry) => entry.sourceId === "gcat-public-catalog",
    );
    const gcatOrbitalRecords = gcatRecords.filter(
      (entry) => entry.selectionKind === "satellite" && Boolean(entry.orbit),
    );
    expect(gcatOrbitalRecords).toHaveLength(33_468);
    expect(gcatOrbitalRecords.every(
      (entry) => entry.orbitAvailability === "reconstructed-historical-orbit",
    )).toBe(true);
    expect(gcatRecords).toHaveLength(33_489);
    expect(gcatRecords.filter((entry) => entry.categoryId === "payloads")).toHaveLength(18_842);
    expect(gcatRecords.filter((entry) => entry.categoryId === "rocket-bodies")).toHaveLength(2_025);
    expect(gcatRecords.filter((entry) => entry.categoryId === "components")).toHaveLength(1_345);
    expect(gcatRecords.filter((entry) => entry.categoryId === "debris")).toHaveLength(11_277);
    expect(orbitalRecords.every((entry) => entry.tle === undefined)).toBe(true);
    expect(current.records.some((entry) => entry.sourceId === "celestrak-gp-snapshot")).toBe(false);
    expect(current.dataCoverage.status).toBe("latest-public-catalog");
  });

  it("preserves recognizable LEO, MEO, GEO, and Molniya motion regimes", () => {
    const scenario = createExplorerScenario(currentExplorerSnapshot);
    type ScenarioSatellite = (typeof scenario.satellites)[number];
    const periodMinutes = (satellite: ScenarioSatellite) =>
      orbitalPeriodSeconds(satellite.keplerian.semiMajorAxisKm) / 60;
    const speedAt = (satellite: ScenarioSatellite, trueAnomalyDeg: number) =>
      speedKmS(keplerianToCartesian({ ...satellite.keplerian, trueAnomalyDeg }));
    const iss = scenario.satellites.find((satellite) => satellite.id === "explorer-iss")!;
    const meo = scenario.satellites.find(
      (satellite) =>
        periodMinutes(satellite) > 600 &&
        periodMinutes(satellite) < 900 &&
        satellite.keplerian.eccentricity < 0.1,
    )!;
    const geo = scenario.satellites.find(
      (satellite) =>
        periodMinutes(satellite) > 1_430 &&
        periodMinutes(satellite) < 1_445 &&
        satellite.keplerian.eccentricity < 0.01 &&
        satellite.keplerian.inclinationDeg < 1,
    )!;
    const molniya = scenario.satellites.find(
      (satellite) =>
        periodMinutes(satellite) > 700 &&
        periodMinutes(satellite) < 730 &&
        satellite.keplerian.eccentricity > 0.4 &&
        satellite.keplerian.inclinationDeg > 60 &&
        satellite.keplerian.inclinationDeg < 70,
    )!;

    expect(iss).toBeDefined();
    expect(meo).toBeDefined();
    expect(geo).toBeDefined();
    expect(molniya).toBeDefined();
    expect(periodMinutes(iss)).toBeGreaterThan(90);
    expect(periodMinutes(iss)).toBeLessThan(100);
    expect(periodMinutes(meo)).toBeGreaterThan(600);
    expect(periodMinutes(meo)).toBeLessThan(900);
    expect(periodMinutes(geo)).toBeGreaterThan(1_430);
    expect(periodMinutes(geo)).toBeLessThan(1_445);
    expect(periodMinutes(molniya)).toBeGreaterThan(700);
    expect(periodMinutes(molniya)).toBeLessThan(730);
    expect(speedAt(molniya, 0)).toBeGreaterThan(speedAt(molniya, 180) * 4);

    const startDate = new Date(scenario.simulationTimeUtc);
    const laterDate = new Date(startDate.getTime() + 30 * 60 * 1000);
    const issMotionDeg = vectorAngularSeparationDeg(
      propagateSatellite(iss, startDate).positionKm,
      propagateSatellite(iss, laterDate).positionKm,
    );
    const meoMotionDeg = vectorAngularSeparationDeg(
      propagateSatellite(meo, startDate).positionKm,
      propagateSatellite(meo, laterDate).positionKm,
    );
    const geoStart = getSatelliteReadouts(geo, startDate);
    const geoLater = getSatelliteReadouts(geo, laterDate);

    expect(issMotionDeg).toBeGreaterThan(90);
    expect(meoMotionDeg).toBeGreaterThan(7);
    expect(meoMotionDeg).toBeLessThan(35);
    expect(issMotionDeg).toBeGreaterThan(meoMotionDeg * 3);
    expect(circularDegreesBetween(geoStart.longitudeDeg, geoLater.longitudeDeg)).toBeLessThan(0.25);
  });
});
