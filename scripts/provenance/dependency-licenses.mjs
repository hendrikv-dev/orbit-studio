import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptDirectory, "../..");
export const dependencyNoticePath = path.join(projectRoot, "THIRD_PARTY_NOTICES.md");

const supportedLicenses = new Set([
  // BSD Zero Clause: OSI-approved and strictly more permissive than MIT, which
  // is already allowed — it grants the same rights and drops the attribution
  // requirement. Reached the tree as a transitive dependency of
  // react-aria-components (tslib, via @swc/helpers and aria-hidden).
  "0BSD",
  "Apache-2.0",
  "BSD-3-Clause",
  // CC0 1.0 Universal: a public-domain dedication rather than a licence. The
  // owner relinquishes copyright and related rights entirely, so it imposes no
  // condition at all — weaker than CC-BY-4.0, which is already allowed and does
  // require attribution. Reached the tree via @photostructure/tz-lookup, whose
  // timezone boundaries derive from Evan Siroky's timezone-boundary-builder.
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
]);

/**
 * Licences accepted only for development dependencies.
 *
 * MPL-2.0 is weak copyleft: its obligations attach to distributing the covered
 * files, and a package used to test the build is never distributed — it is not
 * in the bundle, the source archive, or the release. That reasoning holds only
 * while the package stays development-only, so it is encoded as a rule rather
 * than written in a comment beside a blanket allowance. A runtime dependency
 * arriving under MPL-2.0 still fails.
 *
 * Reached the tree via @axe-core/playwright, which runs the accessibility gate.
 */
const developmentOnlyLicenses = new Set(["MPL-2.0"]);

const licenseOverrides = new Map([
  [
    "webgl-constants@1.1.1",
    {
      license: "MIT",
      evidenceUrl:
        "https://github.com/TimvanScherpenzeel/webgl-constants/blob/3ed05e37a29cc15cc1f612913723a4c39f808d9d/LICENSE",
      packageGitHead: "3ed05e37a29cc15cc1f612913723a4c39f808d9d",
      licenseFileSha256:
        "0969fa65680b694452c2c65981df14af5c192da24f2b1f87bdd51d8ed24efcfa",
      reason:
        "package-lock omits the license field; npm registry metadata identifies the " +
        "published git head and its immutable upstream LICENSE is explicit.",
    },
  ],
]);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function normalizeNoticeText(content) {
  return content
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function packageNameFromLockPath(lockPath) {
  return lockPath.slice(lockPath.lastIndexOf("node_modules/") + "node_modules/".length);
}

async function noticeFiles(packageDirectory) {
  let entries;
  try {
    entries = await readdir(packageDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(licen[cs]e|copying|notice|copyright)(\.|$)/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

export async function readDependencyAudit(root = projectRoot) {
  const lockContent = await readFile(path.join(root, "package-lock.json"), "utf8");
  const lock = JSON.parse(lockContent);
  const failures = [];
  const packages = [];

  if (lock.lockfileVersion !== 3) {
    failures.push(`unsupported-lockfile-version:${lock.lockfileVersion}`);
  }

  for (const [lockPath, metadata] of Object.entries(lock.packages ?? {})) {
    if (!lockPath) continue;
    const name = packageNameFromLockPath(lockPath);
    const key = `${name}@${metadata.version}`;
    const override = licenseOverrides.get(key);
    const license = metadata.license ?? override?.license ?? null;

    const classification = metadata.dev
      ? "development"
      : metadata.optional
        ? "optional-platform"
        : "runtime";

    if (!license) failures.push(`license-missing:${key}`);
    if (license && !supportedLicenses.has(license)) {
      if (classification === "development" && developmentOnlyLicenses.has(license)) {
        // Allowed here and nowhere else. See developmentOnlyLicenses.
      } else {
        failures.push(`license-unreviewed:${key}:${license}`);
      }
    }
    const packageDirectory = path.join(root, lockPath);
    const files = classification === "runtime"
      ? await noticeFiles(packageDirectory)
      : [];
    const notices = [];

    for (const fileName of files) {
      const content = await readFile(path.join(packageDirectory, fileName), "utf8");
      notices.push({
        fileName,
        content: normalizeNoticeText(content),
        sha256: sha256(content),
      });
    }

    if (
      override?.licenseFileSha256 &&
      !notices.some((notice) => notice.sha256 === override.licenseFileSha256)
    ) {
      failures.push(`license-override-evidence-mismatch:${key}`);
    }

    packages.push({
      key,
      name,
      version: metadata.version,
      license,
      classification,
      override: override ?? null,
      notices,
    });
  }

  return {
    failures,
    lockSha256: sha256(lockContent),
    lockfileVersion: lock.lockfileVersion,
    packages: packages.sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function packagesByLicense(packages) {
  const groups = new Map();
  for (const entry of packages) {
    const values = groups.get(entry.license) ?? [];
    values.push(entry);
    groups.set(entry.license, values);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function groupedRuntimeNotices(packages) {
  const groups = new Map();
  for (const entry of packages.filter((item) => item.classification === "runtime")) {
    for (const notice of entry.notices) {
      const key = sha256(notice.content);
      const group = groups.get(key) ?? { content: notice.content, packages: [] };
      group.packages.push(`${entry.key} (${notice.fileName})`);
      groups.set(key, group);
    }
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function renderDependencyNotices(audit) {
  const count = (classification) =>
    audit.packages.filter((entry) => entry.classification === classification).length;
  const lines = [
    "# Third-Party Software Notices",
    "",
    "<!-- Generated by scripts/provenance/dependency-licenses.mjs. Do not edit by hand. -->",
    "",
    "Orbit Studio's MIT license does not replace the licenses of third-party packages.",
    "This notice is derived from `package-lock.json`, the authoritative dependency graph.",
    "",
    `- Lockfile version: ${audit.lockfileVersion}`,
    `- Lockfile SHA-256: \`${audit.lockSha256}\``,
    `- Locked package entries: ${audit.packages.length}`,
    `- Runtime package entries: ${count("runtime")}`,
    `- Development package entries: ${count("development")}`,
    `- Optional platform package entries: ${count("optional-platform")}`,
    "",
    "## License audit",
    "",
  ];

  for (const [license, entries] of packagesByLicense(audit.packages)) {
    lines.push(`### ${license}`, "");
    for (const entry of entries) {
      lines.push(`- \`${entry.key}\` — ${entry.classification}`);
    }
    lines.push("");
  }

  lines.push(
    "## Evidence-backed metadata override",
    "",
    "- `webgl-constants@1.1.1` — MIT. `package-lock.json` omits a license field; " +
      "npm registry metadata identifies git head `3ed05e37a29cc15cc1f612913723a4c39f808d9d`, " +
      "and the [immutable upstream MIT LICENSE]" +
      "(https://github.com/TimvanScherpenzeel/webgl-constants/blob/" +
      "3ed05e37a29cc15cc1f612913723a4c39f808d9d/LICENSE) has SHA-256 " +
      "`0969fa65680b694452c2c65981df14af5c192da24f2b1f87bdd51d8ed24efcfa`.",
    "",
    "## Runtime package license and notice texts",
    "",
    "The following package-supplied texts come from the clean locked installation. Rendering",
    "normalizes line endings and incidental end-of-line whitespace; raw upstream checksums remain",
    "part of the machine audit. Packages sharing normalized notice text are grouped together.",
    "",
  );

  for (const [digest, group] of groupedRuntimeNotices(audit.packages)) {
    lines.push(`### Notice \`${digest}\``, "");
    lines.push(`Applies to: ${group.packages.map((entry) => `\`${entry}\``).join(", ")}`, "");
    lines.push("```text", group.content, "```", "");
  }

  const runtimeWithoutFiles = audit.packages.filter(
    (entry) => entry.classification === "runtime" && entry.notices.length === 0,
  );
  lines.push(
    "## Runtime packages without package-supplied notice files",
    "",
    "These installed packages do not contain a top-level LICENSE, COPYING, NOTICE, or COPYRIGHT",
    "file. Their lockfile SPDX declaration is recorded here; adding or changing one fails the",
    "license-expression audit until reviewed.",
    "",
  );
  for (const entry of runtimeWithoutFiles) {
    lines.push(`- \`${entry.key}\` — ${entry.license}`);
  }
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
}

export async function validateDependencyLicenses({
  checkNotice = true,
  root = projectRoot,
} = {}) {
  const audit = await readDependencyAudit(root);
  const failures = [...audit.failures];

  if (checkNotice) {
    const expected = renderDependencyNotices(audit);
    const actual = await readFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8")
      .catch(() => null);
    if (actual !== expected) failures.push("dependency-notice-out-of-date");
  }

  return { audit, failures };
}

async function main() {
  const check = process.argv.includes("--check");
  const { audit, failures } = await validateDependencyLicenses({ checkNotice: check });

  if (failures.length > 0) {
    console.error("[licenses] Dependency license validation failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  if (check) {
    console.log(
      `[licenses] PASS ${audit.packages.length} lockfile packages; ${audit.lockSha256}`,
    );
    return;
  }

  const { writeFile } = await import("node:fs/promises");
  await writeFile(dependencyNoticePath, renderDependencyNotices(audit), "utf8");
  console.log(`[licenses] Wrote ${dependencyNoticePath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
