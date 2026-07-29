import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDependencyAudit } from "./dependency-licenses.mjs";

const temporaryRoots = [];

async function lockFixture(
  metadata,
  { packageName = "example-package", version = "1.2.3" } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "orbit-license-audit-"));
  temporaryRoots.push(root);
  // Project-authored synthetic lockfile: no package code or third-party notice is copied.
  await writeFile(
    path.join(root, "package-lock.json"),
    `${JSON.stringify({
      name: "orbit-license-audit-fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "orbit-license-audit-fixture", version: "1.0.0" },
        [`node_modules/${packageName}`]: {
          version,
          ...metadata,
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

describe("lockfile dependency license audit", () => {
  it("accepts a reviewed SPDX license in the lockfile", async () => {
    const audit = await readDependencyAudit(await lockFixture({ license: "MIT" }));

    expect(audit.failures).toEqual([]);
    expect(audit.packages).toEqual([
      expect.objectContaining({
        key: "example-package@1.2.3",
        license: "MIT",
        classification: "runtime",
      }),
    ]);
  });

  it("rejects missing and unreviewed license metadata", async () => {
    const missing = await readDependencyAudit(await lockFixture({}));
    const unreviewed = await readDependencyAudit(
      await lockFixture({ license: "UNREVIEWED-SYNTHETIC-LICENSE" }),
    );

    expect(missing.failures).toContain("license-missing:example-package@1.2.3");
    expect(unreviewed.failures).toContain(
      "license-unreviewed:example-package@1.2.3:UNREVIEWED-SYNTHETIC-LICENSE",
    );
  });

  it("requires the immutable license checksum for a metadata override", async () => {
    const root = await lockFixture(
      {},
      { packageName: "webgl-constants", version: "1.1.1" },
    );
    const packageDirectory = path.join(root, "node_modules/webgl-constants");
    await mkdir(packageDirectory, { recursive: true });
    const reviewedLicense = await readFile(
      path.join(process.cwd(), "node_modules/webgl-constants/LICENSE"),
      "utf8",
    );
    await writeFile(path.join(packageDirectory, "LICENSE"), reviewedLicense, "utf8");

    expect((await readDependencyAudit(root)).failures).toEqual([]);

    await writeFile(
      path.join(packageDirectory, "LICENSE"),
      "Project-authored mismatched license fixture.\n",
      "utf8",
    );
    expect((await readDependencyAudit(root)).failures).toContain(
      "license-override-evidence-mismatch:webgl-constants@1.1.1",
    );
  });

  it("normalizes notice line endings without changing raw checksum evidence", async () => {
    const root = await lockFixture({ license: "MIT" });
    const packageDirectory = path.join(root, "node_modules/example-package");
    await mkdir(packageDirectory, { recursive: true });
    const rawNotice = "Project-authored fixture line.  \r\nSecond line.\r\n";
    await writeFile(path.join(packageDirectory, "LICENSE"), rawNotice, "utf8");

    const audit = await readDependencyAudit(root);

    expect(audit.failures).toEqual([]);
    expect(audit.packages[0]?.notices[0]?.content).toBe(
      "Project-authored fixture line.\nSecond line.",
    );
    expect(audit.packages[0]?.notices[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
