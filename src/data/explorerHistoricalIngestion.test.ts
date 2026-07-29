// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  createCoverageReport,
  createRuntimeArtifacts,
  normalizeHistoricalCatalogRecords,
  validateHistoricalDataset,
} from "../../scripts/import-explorer-historical-catalog.mjs";
import { createHistoricalCatalogIndex, queryHistoricalCatalog } from "./explorerHistoricalPipeline";

const generatedAt = "2026-06-30T00:00:00.000Z";

function satcat(records, patch = {}) {
  return {
    family: "space-track",
    role: "satcat",
    fileName: "space-track-satcat.csv",
    importedAt: generatedAt,
    license: "Space-Track user agreement",
    records,
    ...patch,
  };
}

function gcat(records, patch = {}) {
  return {
    family: "gcat",
    role: "metadata",
    fileName: "gcat.tsv",
    importedAt: generatedAt,
    records,
    ...patch,
  };
}

function codes(dataset) {
  return dataset.validation.issues.map((issue) => issue.code);
}

describe("Explorer historical catalog ingestion", () => {
  it("merges duplicate identities into one canonical object", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "00001",
            OBJECT_ID: "1957-001A",
            OBJECT_NAME: "SPUTNIK 1",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1957-10-04",
            DECAY_DATE: "1958-01-04",
            OWNER: "SU",
          },
        ]),
        gcat([
          {
            Satcat: "1",
            Piece: "1957-001A",
            Name: "Sputnik 1 / PS-1",
            Type: "P",
            LDate: "1957-10-04",
            DDate: "1958-01-04",
            State: "SU",
          },
        ]),
      ],
      { generatedAt },
    );

    expect(dataset.objects).toHaveLength(1);
    expect(dataset.objects[0].id).toBe("object-norad-1");
    expect(dataset.objects[0].catalogNumber).toBe("1");
    expect(dataset.objects[0].internationalDesignator).toBe("1957-001A");
    expect(dataset.objects[0].alternateNames).toContain("Sputnik 1 / PS-1");
    expect(dataset.objects[0].aliases.map((alias) => `${alias.kind}:${alias.value}`)).toContain(
      "norad:1",
    );
    expect(new Set(dataset.objects[0].sources.map((source) => source.sourceFamily))).toEqual(
      new Set(["space-track", "gcat"]),
    );
  });

  it("validates duplicate identifiers without duplicating logical objects", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "42",
            OBJECT_ID: "1960-001A",
            OBJECT_NAME: "OBJECT A",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1960-01-01",
          },
          {
            NORAD_CAT_ID: "42",
            OBJECT_ID: "1960-001A",
            OBJECT_NAME: "OBJECT A DUPLICATE",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1960-01-01",
          },
        ]),
      ],
      { generatedAt },
    );

    expect(dataset.objects).toHaveLength(1);
    expect(codes(dataset)).toContain("duplicate-norad-id");
  });

  it("uses lifecycle only for historical membership", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "1",
            OBJECT_ID: "1957-001A",
            OBJECT_NAME: "SPUTNIK 1",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1957-10-04",
            DECAY_DATE: "1958-01-04",
            OWNER: "SU",
          },
          {
            NORAD_CAT_ID: "2",
            OBJECT_ID: "1960-001A",
            OBJECT_NAME: "BAD CHRONOLOGY",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1960-01-01",
            DECAY_DATE: "1959-01-01",
            OWNER: "US",
          },
        ]),
      ],
      { generatedAt },
    );
    const index = createHistoricalCatalogIndex(dataset);

    expect(queryHistoricalCatalog(index, "1956-01-01T00:00:00.000Z").objects).toHaveLength(0);
    expect(queryHistoricalCatalog(index, "1957-10-05T00:00:00.000Z").objects.map((item) => item.object.name)).toEqual([
      "SPUTNIK 1",
    ]);
    expect(queryHistoricalCatalog(index, "1958-01-05T00:00:00.000Z").objects).toHaveLength(0);
    expect(codes(dataset)).toContain("invalid-chronology");
  });

  it("reconciles ownership metadata and records conflicts", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "100",
            OBJECT_ID: "1961-001A",
            OBJECT_NAME: "MERGE TEST",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1961-01-01",
            OWNER: "US",
          },
        ]),
        gcat([
          {
            Satcat: "100",
            Piece: "1961-001A",
            Name: "Merge Test",
            Type: "Payload",
            LDate: "1961-01-01",
            State: "USA",
          },
        ]),
      ],
      { generatedAt },
    );

    expect(dataset.objects[0].owner).toBe("US");
    expect(codes(dataset)).toContain("conflicting-owner");
    expect(dataset.objects[0].conflicts.map((conflict) => conflict.field)).toContain("owner");
  });

  it("tracks field provenance for canonical lifecycle data", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "25544",
            OBJECT_ID: "1998-067A",
            OBJECT_NAME: "ISS",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1998-11-20",
            OWNER: "ISS",
          },
        ]),
      ],
      { generatedAt },
    );

    expect(dataset.objects[0].fieldProvenance.launchDate[0]).toMatchObject({
      sourceFamily: "space-track",
      fieldName: "LAUNCH_DATE",
      value: "1998-11-20T00:00:00.000Z",
      confidence: "authoritative",
      license: "Space-Track user agreement",
    });
  });

  it("surfaces invalid identifiers, missing launch dates, and missing object types", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "ABC",
            OBJECT_NAME: "INVALID RECORD",
            OWNER: "US",
          },
        ]),
      ],
      { generatedAt },
    );

    expect(codes(dataset)).toContain("invalid-catalog-number");
    expect(codes(dataset)).toContain("missing-launch-date");
    expect(codes(dataset)).toContain("missing-object-type");
  });

  it("reports conflicting decay dates", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "5",
            OBJECT_ID: "1962-001A",
            OBJECT_NAME: "DECAY CONFLICT",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1962-01-01",
            DECAY_DATE: "1962-02-01",
          },
        ]),
        gcat([
          {
            Satcat: "5",
            Piece: "1962-001A",
            Name: "Decay Conflict",
            Type: "Payload",
            LDate: "1962-01-01",
            DDate: "1962-02-02",
          },
        ]),
      ],
      { generatedAt },
    );

    expect(codes(dataset)).toContain("conflicting-decayDate");
    expect(dataset.objects[0].conflicts.map((conflict) => conflict.field)).toContain("decayDate");
  });

  it("does not close active SATCAT objects with supplemental GCAT DDate values", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "25544",
            OBJECT_ID: "1998-067A",
            OBJECT_NAME: "ISS",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1998-11-20",
            OPS_STATUS_CODE: "+",
            OWNER: "ISS",
          },
        ]),
        gcat([
          {
            Satcat: "25544",
            Piece: "1998-067A",
            Name: "ISS (ZARYA)",
            Type: "Payload",
            LDate: "1998 Nov 20 0640",
            DDate: "1998 Dec 6 2347:02",
            Status: "O",
            State: "ISS",
          },
        ]),
      ],
      { generatedAt },
    );
    const index = createHistoricalCatalogIndex(dataset);

    expect(dataset.objects[0].decayDate).toBeUndefined();
    expect(dataset.objects[0].reentryDate).toBeUndefined();
    expect(codes(dataset)).not.toContain("active-open-object-has-past-lifecycle-end");
    expect(
      queryHistoricalCatalog(index, "2026-06-30T00:00:00.000Z").objects.map((item) => item.object.catalogNumber),
    ).toContain("25544");
  });

  it("drops supplemental debris existenceStartDate values that predate authoritative launch dates", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "3293",
            OBJECT_ID: "1968-091A",
            OBJECT_NAME: "DEBRIS CHRONOLOGY",
            OBJECT_TYPE: "DEBRIS",
            LAUNCH_DATE: "1968-11-05",
            OWNER: "US",
          },
        ]),
        gcat([
          {
            Satcat: "3293",
            Piece: "1968-091A",
            Name: "Debris Chronology",
            Type: "D",
            LDate: "1968 Nov 5",
            SDate: "1968 Nov 1 0402",
            State: "US",
          },
        ]),
      ],
      { generatedAt },
    );
    const index = createHistoricalCatalogIndex(dataset);
    const validation = validateHistoricalDataset(dataset);

    expect(dataset.objects[0].existenceStartDate).toBeUndefined();
    expect(validation.issueCountBySeverity.error).toBe(0);
    expect(queryHistoricalCatalog(index, "1968-11-04T00:00:00.000Z").objects).toHaveLength(0);
    expect(
      queryHistoricalCatalog(index, "1968-11-05T00:00:00.000Z").objects.map((item) => item.object.catalogNumber),
    ).toContain("3293");
  });

  it("does not merge supplemental records by NORAD when COSPAR identifiers conflict", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "63359",
            OBJECT_ID: "2025-061J",
            OBJECT_NAME: "ELECTRON KICK STAGE R/B",
            OBJECT_TYPE: "ROCKET BODY",
            LAUNCH_DATE: "2025-03-26",
            OWNER: "US",
          },
        ]),
        gcat([
          {
            Satcat: "63359",
            Piece: "2025-061J",
            Name: "Electron 63 Stage 2",
            Type: "R2",
            LDate: "2025 Mar 26",
            SDate: "2025 Mar 26 1539",
            Status: "O",
            State: "US",
          },
          {
            Satcat: "63359",
            Piece: "2025-061K",
            Name: "Electron 63 Kick Stage",
            Type: "R3",
            LDate: "2025 Mar 26",
            SDate: "2025 Mar 26 1539",
            DDate: "2025 Apr 4 0620",
            Status: "R",
            State: "US",
          },
        ]),
      ],
      { generatedAt },
    );

    expect(dataset.objects).toHaveLength(1);
    expect(dataset.objects[0].internationalDesignator).toBe("2025-061J");
    expect(dataset.objects[0].decayDate).toBeUndefined();
    expect(dataset.objects[0].alternateNames).toContain("Electron 63 Stage 2");
    expect(dataset.objects[0].alternateNames).not.toContain("Electron 63 Kick Stage");
    expect(validateHistoricalDataset(dataset).issueCountBySeverity.error).toBe(0);
  });

  it("fails validation for final artifacts with impossible chronology", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "9001",
            OBJECT_ID: "2000-001A",
            OBJECT_NAME: "IMPOSSIBLE START",
            OBJECT_TYPE: "DEBRIS",
            LAUNCH_DATE: "2000-01-02",
            OWNER: "US",
          },
        ]),
      ],
      { generatedAt },
    );
    dataset.objects[0].existenceStartDate = "2000-01-01T00:00:00.000Z";

    const validation = validateHistoricalDataset(dataset);

    expect(validation.issueCountBySeverity.error).toBeGreaterThan(0);
    expect(validation.issueCountByCode["existence-before-launch"]).toBe(1);
  });

  it("fails validation for active objects with past decay or reentry dates", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "9002",
            OBJECT_ID: "2000-002A",
            OBJECT_NAME: "ACTIVE WITH DECAY",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "2000-01-01",
            OPS_STATUS_CODE: "+",
            OWNER: "US",
          },
        ]),
      ],
      { generatedAt },
    );
    dataset.objects[0].decayDate = "2001-01-01T00:00:00.000Z";

    const validation = validateHistoricalDataset(dataset);

    expect(validation.issueCountBySeverity.error).toBeGreaterThan(0);
    expect(validation.issueCountByCode["active-open-object-has-past-lifecycle-end"]).toBe(1);
  });

  it("supports incremental imports against an existing normalized dataset", () => {
    const first = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "25544",
            OBJECT_ID: "1998-067A",
            OBJECT_NAME: "ISS",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1998-11-20",
            OWNER: "ISS",
          },
        ]),
      ],
      { generatedAt },
    );
    const updated = normalizeHistoricalCatalogRecords(
      [
        gcat([
          {
            Satcat: "25544",
            Piece: "1998-067A",
            Name: "International Space Station",
            Type: "Payload",
            LDate: "1998-11-20",
            State: "ISS",
          },
        ]),
      ],
      { existingDataset: first, generatedAt },
    );

    expect(updated.objects).toHaveLength(1);
    expect(updated.objects[0].alternateNames).toContain("International Space Station");
    expect(new Set(updated.objects[0].sources.map((source) => source.sourceFamily))).toEqual(
      new Set(["space-track", "gcat"]),
    );
    expect(codes(updated)).not.toContain("missing-required-satcat");
  });

  it("generates deterministic runtime indexes and coverage manifests", () => {
    const records = [
      {
        NORAD_CAT_ID: "1",
        OBJECT_ID: "1957-001A",
        OBJECT_NAME: "SPUTNIK 1",
        OBJECT_TYPE: "PAYLOAD",
        LAUNCH_DATE: "1957-10-04",
        DECAY_DATE: "1958-01-04",
        OWNER: "SU",
      },
    ];
    const first = normalizeHistoricalCatalogRecords([satcat(records)], { generatedAt });
    const second = normalizeHistoricalCatalogRecords([satcat(records)], { generatedAt });

    expect(first.sourceFingerprint).toBe(second.sourceFingerprint);
    expect(first.runtimeArtifacts.identityIndex["norad:1"]).toBe("object-norad-1");
    expect(first.runtimeArtifacts.launchIndex).toEqual([
      { date: "1957-10-04T00:00:00.000Z", objectId: "object-norad-1" },
    ]);
    expect(first.runtimeArtifacts.decayIndex).toEqual([
      { date: "1958-01-04T00:00:00.000Z", objectId: "object-norad-1", field: "decayDate" },
    ]);
    expect(first.runtimeArtifacts.coverageManifest.completeMembership).toBe(true);
    expect(createCoverageReport(first).sourceBackedCompleteBuild).toBe(true);
    expect(createRuntimeArtifacts(first).sourceFingerprint).toBe(first.sourceFingerprint);
  });

  it("indexes historical orbit states by canonical object id", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "1",
            OBJECT_ID: "1957-001A",
            OBJECT_NAME: "SPUTNIK 1",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1957-10-04",
            DECAY_DATE: "1958-01-04",
            OWNER: "SU",
          },
        ]),
        satcat(
          [
            {
              OBJECT_NAME: "SPUTNIK 1",
              NORAD_CAT_ID: "1",
              OBJECT_ID: "1957-001A",
              EPOCH: "1957-10-05T00:00:00.000Z",
              TLE_LINE1: "1 00001U 57001A   57278.00000000  .00000023  00000+0  00000+0 0  9991",
              TLE_LINE2: "2 00001  65.1000 118.0000 0520000  58.0000  42.0000 14.00000000    01",
            },
          ],
          { role: "orbit-history", fileName: "space-track-gp-history.json" },
        ),
      ],
      { generatedAt },
    );

    expect(dataset.orbitStates).toHaveLength(1);
    expect(dataset.orbitStates[0].objectId).toBe("object-norad-1");
    expect(dataset.runtimeArtifacts.orbitStateIndex["object-norad-1"]).toEqual([
      { id: "object-norad-1:1957-10-05T00:00:00.000Z", epoch: "1957-10-05T00:00:00.000Z" },
    ]);
    expect(dataset.runtimeArtifacts.coverageManifest.renderableOrbitStateCount).toBe(1);
  });

  it("validates source-backed artifacts after normalization", () => {
    const dataset = normalizeHistoricalCatalogRecords(
      [
        satcat([
          {
            NORAD_CAT_ID: "25544",
            OBJECT_ID: "1998-067A",
            OBJECT_NAME: "ISS",
            OBJECT_TYPE: "PAYLOAD",
            LAUNCH_DATE: "1998-11-20",
            OWNER: "ISS",
          },
        ]),
      ],
      { generatedAt },
    );
    const validation = validateHistoricalDataset(dataset);

    expect(validation.issueCountBySeverity.error).toBe(0);
    expect(createCoverageReport(dataset).coverage.completeMembership).toBe(true);
  });
});
