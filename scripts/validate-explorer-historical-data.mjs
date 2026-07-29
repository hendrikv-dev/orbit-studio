import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createCoverageReport,
  validateHistoricalDataset,
} from "./import-explorer-historical-catalog.mjs";

const datasetPath = resolve(
  process.argv[2] ?? "src/data/historical/explorerHistoricalCatalog.normalized.json",
);

function dateMs(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDay(value) {
  const parsed = dateMs(value);
  return parsed === null ? undefined : new Date(parsed).toISOString().slice(0, 10);
}

function isDateOnlyIso(value) {
  return Boolean(value?.endsWith("T00:00:00.000Z"));
}

function startsAfterSelectedDate(startIso, selectedIso) {
  const selectedMs = dateMs(selectedIso);
  const startMs = dateMs(startIso);
  if (selectedMs === null || startMs === null) return true;
  if (isDateOnlyIso(startIso)) return utcDay(startIso) > utcDay(selectedIso);
  return startMs > selectedMs;
}

function endedBeforeSelectedDate(endIso, selectedIso) {
  const selectedMs = dateMs(selectedIso);
  const endMs = dateMs(endIso);
  if (selectedMs === null || endMs === null) return false;
  if (isDateOnlyIso(endIso)) return utcDay(endIso) < utcDay(selectedIso);
  return endMs < selectedMs;
}

function startsBeforeLaunch(object) {
  const startMs = dateMs(object.existenceStartDate);
  const launchMs = dateMs(object.launchDate);
  if (startMs === null || launchMs === null || startMs >= launchMs) return false;
  if (isDateOnlyIso(object.existenceStartDate) && utcDay(object.existenceStartDate) === utcDay(object.launchDate)) {
    return false;
  }
  return true;
}

function existsOnDate(object, dateIso) {
  const startIso = object.existenceStartDate ?? object.launchDate;
  if (startsAfterSelectedDate(startIso, dateIso)) return false;

  const endCandidates = [object.decayDate, object.reentryDate].filter(Boolean);
  return !endCandidates.some((endIso) => endedBeforeSelectedDate(endIso, dateIso));
}

function objectsOnDate(dataset, dateIso) {
  return dataset.objects.filter((object) => existsOnDate(object, dateIso));
}

function findObject(dataset, predicate) {
  return dataset.objects.find(predicate);
}

function checkObjectPresence(dataset, { name, catalogNumber, dateIso }) {
  const object = findObject(
    dataset,
    (candidate) =>
      candidate.catalogNumber === catalogNumber ||
      candidate.name === name ||
      candidate.alternateNames?.includes(name),
  );
  return Boolean(object && existsOnDate(object, dateIso));
}

function checkObjectAbsence(dataset, { name, catalogNumber, dateIso }) {
  const object = findObject(
    dataset,
    (candidate) =>
      candidate.catalogNumber === catalogNumber ||
      candidate.name === name ||
      candidate.alternateNames?.includes(name),
  );
  return Boolean(object && !existsOnDate(object, dateIso));
}

function runMilestoneChecks(dataset) {
  const checks = [];
  const currentDayIso = new Date().toISOString();
  const complete =
    dataset.runtimeArtifacts?.coverageManifest?.completeMembership === true ||
    createCoverageReport(dataset).sourceBackedCompleteBuild === true;

  if (!complete) {
    return {
      skipped: true,
      checks: [
        {
          name: "source-backed milestones",
          status: "skipped",
          reason: "SATCAT-backed complete historical membership is not loaded.",
        },
      ],
    };
  }

  checks.push({
    name: "1956 has no artificial satellites",
    status: objectsOnDate(dataset, "1956-01-01T00:00:00.000Z").length === 0 ? "passed" : "failed",
  });

  const objectMilestones = [
    {
      name: "Sputnik 1 appears after October 4, 1957",
      catalogNumber: "2",
      objectName: "SPUTNIK 1",
      dateIso: "1957-10-05T00:00:00.000Z",
    },
    {
      name: "Explorer 1 appears after February 1, 1958",
      catalogNumber: "4",
      objectName: "EXPLORER 1",
      dateIso: "1958-02-02T00:00:00.000Z",
    },
    {
      name: "Vostok 1 appears on April 12, 1961",
      catalogNumber: "103",
      objectName: "VOSTOK 1",
      dateIso: "1961-04-12T12:00:00.000Z",
    },
    {
      name: "Apollo 11 command module appears during Apollo era",
      catalogNumber: "4039",
      objectName: "APOLLO 11 CM (COLUMBIA)",
      dateIso: "1969-07-20T00:00:00.000Z",
    },
    {
      name: "Salyut 1 appears after launch",
      catalogNumber: "5160",
      objectName: "SALYUT 1",
      dateIso: "1971-04-20T00:00:00.000Z",
    },
    {
      name: "Skylab appears after launch",
      catalogNumber: "6633",
      objectName: "SKYLAB 1",
      dateIso: "1973-05-15T00:00:00.000Z",
    },
    {
      name: "Mir appears after launch",
      catalogNumber: "16609",
      objectName: "MIR",
      dateIso: "1986-02-20T00:00:00.000Z",
    },
    {
      name: "ISS appears after first module launch",
      catalogNumber: "25544",
      objectName: "ISS (ZARYA)",
      dateIso: "1998-11-20T00:00:00.000Z",
    },
    {
      name: "ISS remains visible after December 6, 1998",
      catalogNumber: "25544",
      objectName: "ISS (ZARYA)",
      dateIso: "1998-12-07T00:00:00.000Z",
    },
    {
      name: "ISS remains visible on current day",
      catalogNumber: "25544",
      objectName: "ISS (ZARYA)",
      dateIso: currentDayIso,
    },
    {
      name: "HST appears after launch",
      catalogNumber: "20580",
      objectName: "HST",
      dateIso: "1990-04-26T00:00:00.000Z",
    },
    {
      name: "HST remains visible on current day",
      catalogNumber: "20580",
      objectName: "HST",
      dateIso: currentDayIso,
    },
    {
      name: "Starlink deployment appears after first operational launch",
      catalogNumber: "44235",
      objectName: "STARLINK-31",
      dateIso: "2019-05-25T00:00:00.000Z",
    },
  ];

  for (const milestone of objectMilestones) {
    checks.push({
      name: milestone.name,
      status: checkObjectPresence(dataset, {
        name: milestone.objectName,
        catalogNumber: milestone.catalogNumber,
        dateIso: milestone.dateIso,
      })
        ? "passed"
        : "failed",
    });
  }

  const absenceMilestones = [
    {
      name: "Sputnik 1 is absent before launch",
      catalogNumber: "2",
      objectName: "SPUTNIK 1",
      dateIso: "1957-10-03T00:00:00.000Z",
    },
    {
      name: "Explorer 1 is absent before launch",
      catalogNumber: "4",
      objectName: "EXPLORER 1",
      dateIso: "1958-01-31T00:00:00.000Z",
    },
    {
      name: "ISS is absent before first module launch date",
      catalogNumber: "25544",
      objectName: "ISS (ZARYA)",
      dateIso: "1998-11-19T00:00:00.000Z",
    },
    {
      name: "Starlink is absent before first deployment",
      catalogNumber: "44235",
      objectName: "STARLINK-31",
      dateIso: "2019-01-01T00:00:00.000Z",
    },
    {
      name: "Fengyun-1C debris is absent before breakup",
      catalogNumber: "29716",
      objectName: "FENGYUN 1C DEB",
      dateIso: "2007-01-10T00:00:00.000Z",
    },
    {
      name: "Iridium 33 debris is absent before collision",
      catalogNumber: "33771",
      objectName: "IRIDIUM 33 DEB",
      dateIso: "2009-02-09T00:00:00.000Z",
    },
    {
      name: "Cosmos 2251 debris is absent before collision",
      catalogNumber: "33757",
      objectName: "COSMOS 2251 DEB",
      dateIso: "2009-02-09T00:00:00.000Z",
    },
  ];

  for (const milestone of absenceMilestones) {
    checks.push({
      name: milestone.name,
      status: checkObjectAbsence(dataset, {
        name: milestone.objectName,
        catalogNumber: milestone.catalogNumber,
        dateIso: milestone.dateIso,
      })
        ? "passed"
        : "failed",
    });
  }

  const eventMilestones = [
    {
      name: "Fengyun-1C debris appears after breakup",
      catalogNumber: "29716",
      objectName: "FENGYUN 1C DEB",
      dateIso: "2007-01-12T00:00:00.000Z",
    },
    {
      name: "Iridium 33 debris appears after collision",
      catalogNumber: "33771",
      objectName: "IRIDIUM 33 DEB",
      dateIso: "2009-02-11T00:00:00.000Z",
    },
    {
      name: "Cosmos 2251 debris appears after collision",
      catalogNumber: "33757",
      objectName: "COSMOS 2251 DEB",
      dateIso: "2009-02-11T00:00:00.000Z",
    },
  ];

  for (const milestone of eventMilestones) {
    checks.push({
      name: milestone.name,
      status: checkObjectPresence(dataset, {
        name: milestone.objectName,
        catalogNumber: milestone.catalogNumber,
        dateIso: milestone.dateIso,
      })
        ? "passed"
        : "failed",
    });
  }

  const futureFrom2020 = dataset.objects.find(
    (object) => dateMs(object.launchDate) !== null && dateMs(object.launchDate) > Date.parse("2020-12-31T23:59:59.999Z"),
  );
  checks.push({
    name: "Objects launched after 2020 do not appear in 2020",
    status:
      futureFrom2020 && !existsOnDate(futureFrom2020, "2020-01-01T00:00:00.000Z")
        ? "passed"
        : "failed",
  });

  checks.push({
    name: "No object has existenceStartDate earlier than launchDate",
    status: dataset.objects.some(startsBeforeLaunch) ? "failed" : "passed",
  });

  checks.push({
    name: "Current-day catalog includes active major spacecraft",
    status:
      ["25544", "20580"].every((catalogNumber) =>
        checkObjectPresence(dataset, { catalogNumber, dateIso: currentDayIso }),
      )
        ? "passed"
        : "failed",
  });

  const decayed = dataset.objects.find(
    (object) => object.launchDate && (object.decayDate || object.reentryDate),
  );
  const endDate = decayed?.decayDate ?? decayed?.reentryDate;
  checks.push({
    name: "Objects disappear after decay/reentry",
    status:
      decayed &&
      endDate &&
      existsOnDate(decayed, decayed.launchDate) &&
      !existsOnDate(decayed, new Date(Date.parse(endDate) + 86_400_000).toISOString())
        ? "passed"
        : "failed",
  });

  return { skipped: false, checks };
}

const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const validation = validateHistoricalDataset(dataset);
const coverage = createCoverageReport(dataset);
const milestones = runMilestoneChecks(dataset);
const failedMilestones = milestones.checks.filter((check) => check.status === "failed");
const errorCount = validation.issueCountBySeverity.error ?? 0;
const warningCount = validation.issueCountBySeverity.warning ?? 0;

console.log(`Dataset: ${datasetPath}`);
console.log(`Objects: ${coverage.recordCounts.objects}`);
console.log(`Orbit states: ${coverage.recordCounts.orbitStates}`);
console.log(`Source-backed complete build: ${coverage.sourceBackedCompleteBuild ? "yes" : "no"}`);
console.log(`Validation: ${errorCount} error(s), ${warningCount} warning(s)`);
for (const check of milestones.checks) {
  console.log(`${check.status}: ${check.name}${check.reason ? ` (${check.reason})` : ""}`);
}

if (errorCount > 0 || failedMilestones.length > 0) process.exitCode = 1;
