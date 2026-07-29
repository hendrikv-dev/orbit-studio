import { describe, expect, it } from "vitest";
import normalizedCatalog from "./historical/explorerHistoricalCatalog.normalized.json";
import type { ExplorerHistoricalCatalogDataset } from "./explorerHistoricalCatalog";
import { createHistoricalCatalogIndex, queryHistoricalCatalog } from "./explorerHistoricalPipeline";

const dataset = normalizedCatalog as ExplorerHistoricalCatalogDataset;
const sourceBackedComplete =
  dataset.runtimeArtifacts?.coverageManifest.completeMembership === true &&
  (dataset.validation?.issueCountBySeverity.error ?? 0) === 0;
const describeSourceBacked = sourceBackedComplete ? describe : describe.skip;
const index = createHistoricalCatalogIndex(dataset);

function hasObject(catalogNumber: string, dateIso: string): boolean {
  return queryHistoricalCatalog(index, dateIso).objects.some(
    (item) => item.object.catalogNumber === catalogNumber,
  );
}

function startsBeforeLaunch(object: ExplorerHistoricalCatalogDataset["objects"][number]): boolean {
  const startMs = Date.parse(object.existenceStartDate ?? "");
  const launchMs = Date.parse(object.launchDate ?? "");
  if (!Number.isFinite(startMs) || !Number.isFinite(launchMs) || startMs >= launchMs) return false;
  if (
    object.existenceStartDate?.endsWith("T00:00:00.000Z") &&
    object.existenceStartDate.slice(0, 10) === object.launchDate?.slice(0, 10)
  ) {
    return false;
  }
  return true;
}

describeSourceBacked("source-backed historical catalog milestones", () => {
  it("has no artificial satellites before Sputnik", () => {
    expect(queryHistoricalCatalog(index, "1956-01-01T00:00:00.000Z").objects).toHaveLength(0);
  });

  it("verifies early historical objects", () => {
    expect(hasObject("2", "1957-10-03T00:00:00.000Z")).toBe(false); // Sputnik 1 pre-launch
    expect(hasObject("2", "1957-10-05T00:00:00.000Z")).toBe(true); // Sputnik 1
    expect(hasObject("4", "1958-01-31T00:00:00.000Z")).toBe(false); // Explorer 1 pre-launch
    expect(hasObject("4", "1958-02-02T00:00:00.000Z")).toBe(true); // Explorer 1
    expect(hasObject("103", "1961-04-12T12:00:00.000Z")).toBe(true); // Vostok 1
  });

  it("verifies crewed station and Apollo-era milestones", () => {
    expect(hasObject("4039", "1969-07-20T00:00:00.000Z")).toBe(true); // Apollo 11 CM
    expect(hasObject("5160", "1971-04-20T00:00:00.000Z")).toBe(true); // Salyut 1
    expect(hasObject("6633", "1973-05-15T00:00:00.000Z")).toBe(true); // Skylab 1
    expect(hasObject("16609", "1986-02-20T00:00:00.000Z")).toBe(true); // Mir
    expect(hasObject("25544", "1998-11-20T00:00:00.000Z")).toBe(true); // ISS Zarya
  });

  it("keeps active major spacecraft visible through current day", () => {
    expect(hasObject("25544", "1998-12-07T00:00:00.000Z")).toBe(true); // ISS after first assembly event
    expect(hasObject("25544", "2026-06-30T00:00:00.000Z")).toBe(true); // ISS current day
    expect(hasObject("20580", "1990-04-26T00:00:00.000Z")).toBe(true); // HST after launch
    expect(hasObject("20580", "2026-06-30T00:00:00.000Z")).toBe(true); // HST current day
  });

  it("keeps later objects absent before launch", () => {
    expect(hasObject("25544", "1998-11-19T00:00:00.000Z")).toBe(false);
    expect(hasObject("44235", "2019-01-01T00:00:00.000Z")).toBe(false);
    expect(hasObject("44235", "2019-05-25T00:00:00.000Z")).toBe(true);
    expect(dataset.objects.filter(startsBeforeLaunch)).toHaveLength(0);
  });

  it("uses debris creation timing when GCAT supplies object start dates", () => {
    expect(hasObject("29716", "2007-01-10T00:00:00.000Z")).toBe(false);
    expect(hasObject("29716", "2007-01-12T00:00:00.000Z")).toBe(true);
    expect(hasObject("33771", "2009-02-09T00:00:00.000Z")).toBe(false);
    expect(hasObject("33771", "2009-02-11T00:00:00.000Z")).toBe(true);
    expect(hasObject("33757", "2009-02-09T00:00:00.000Z")).toBe(false);
    expect(hasObject("33757", "2009-02-11T00:00:00.000Z")).toBe(true);
  });

  it("removes objects after decay or reentry", () => {
    expect(hasObject("2", "1958-01-03T00:00:00.000Z")).toBe(true);
    expect(hasObject("2", "1958-01-04T00:00:00.000Z")).toBe(false);
  });
});
