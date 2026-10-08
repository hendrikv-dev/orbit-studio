import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditFunctionsDirectory,
  NETLIFY_DEFAULT_FUNCTIONS_DIRECTORY,
  readFunctionsDirectory,
} from "./netlify-functions.mjs";

const made = [];
async function directoryOf(files) {
  const root = await mkdtemp(path.join(tmpdir(), "netlify-functions-"));
  made.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const full = path.join(root, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(made.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** What a real entrypoint looks like, reduced to the part the audit reads. */
const HANDLER = 'export default async (request) => new Response("ok");\n';

describe("reading the configured directory", () => {
  it("takes the directory out of the [functions] table", () => {
    expect(
      readFunctionsDirectory(
        '[build]\n  command = "npm run build"\n\n[functions]\n  directory = "netlify/functions"\n  node_bundler = "esbuild"\n',
      ),
    ).toBe("netlify/functions");
  });

  it("reads this repository's own netlify.toml shape", async () => {
    const { readFile } = await import("node:fs/promises");
    const toml = await readFile(new URL("../../netlify.toml", import.meta.url), "utf8");
    expect(readFunctionsDirectory(toml)).toBe("netlify/functions");
  });

  /* Per-function settings live in tables that also begin with "functions", and
     reading a `directory` out of one of those would point the audit somewhere
     nobody configured. */
  it("ignores per-function tables", () => {
    expect(
      readFunctionsDirectory(
        '[functions]\n  directory = "a/b"\n\n[functions."goes-cloud-mask"]\n  directory = "somewhere/else"\n',
      ),
    ).toBe("a/b");
  });

  it("says nothing rather than guessing when no directory is configured", () => {
    expect(readFunctionsDirectory('[build]\n  publish = "dist"\n')).toBeNull();
    expect(NETLIFY_DEFAULT_FUNCTIONS_DIRECTORY).toBe("netlify/functions");
  });
});

describe("the deploy failure this exists to catch", () => {
  /**
   * The exact tree that broke production: one real function and its test beside
   * it. Netlify derived `goes-cloud-mask.test` from the second file and refused
   * the whole deploy.
   */
  it("catches goes-cloud-mask.test.ts", async () => {
    const root = await directoryOf({
      "goes-cloud-mask.mts": HANDLER,
      "goes-cloud-mask.test.ts": 'import { it } from "vitest";\n',
    });
    const findings = await auditFunctionsDirectory(root);
    expect(findings).toEqual([
      {
        kind: "test-file",
        entry: "goes-cloud-mask.test.ts",
        detail: 'Netlify would deploy this as a public function named "goes-cloud-mask.test"',
      },
    ]);
  });

  it("passes the same tree once the test is moved out", async () => {
    const root = await directoryOf({ "goes-cloud-mask.mts": HANDLER });
    expect(await auditFunctionsDirectory(root)).toEqual(["goes-cloud-mask"]);
  });
});

describe("everything else that must not deploy", () => {
  /* Only the final extension is stripped, so every remaining dot stays in the
     name Netlify tries to register. */
  it("rejects a name a dot makes illegal, test or not", async () => {
    const root = await directoryOf({ "goes.cloud.mask.mts": HANDLER });
    const [finding] = await auditFunctionsDirectory(root);
    expect(finding.kind).toBe("invalid-function-name");
    expect(finding.detail).toContain('"goes.cloud.mask"');
  });

  it("rejects specs, fixtures and mocks", async () => {
    const root = await directoryOf({
      "a.spec.ts": "",
      "cloud-fixtures.ts": HANDLER,
      "noaa.mock.ts": HANDLER,
    });
    const kinds = (await auditFunctionsDirectory(root)).map((f) => f.kind);
    expect(kinds).toContain("test-file");
    expect(kinds).toContain("fixture-or-mock");
    expect(kinds).toHaveLength(3);
  });

  it("rejects dotfiles and generated files", async () => {
    const root = await directoryOf({
      ".env": "SECRET=1",
      "goes-cloud-mask.mts": HANDLER,
      "bundle.js.map": "{}",
      "types.d.ts": "",
    });
    const found = Object.fromEntries(
      (await auditFunctionsDirectory(root)).map((f) => [f.entry, f.kind]),
    );
    expect(found[".env"]).toBe("dotfile");
    expect(found["bundle.js.map"]).toBe("generated-file");
    expect(found["types.d.ts"]).toBe("generated-file");
  });

  /**
   * The quieter half of the same bug. A helper module deploys perfectly
   * happily — no invalid name, no failed deploy — and is simply live at its own
   * URL, which is how an internal function becomes a public endpoint without
   * anyone deciding that it should.
   */
  it("rejects a helper module with no handler, which would deploy silently", async () => {
    const root = await directoryOf({
      "goes-cloud-mask.mts": HANDLER,
      "dap4.mts": "export function parse(buffer) { return buffer; }\n",
    });
    const findings = await auditFunctionsDirectory(root);
    expect(findings).toEqual([
      {
        kind: "support-module",
        entry: "dap4.mts",
        detail: 'no handler export, yet Netlify would publish it as the function "dap4"',
      },
    ]);
  });

  it("accepts a handler exported as `handler` rather than as default", async () => {
    const root = await directoryOf({
      "goes-cloud-mask.mts": "export const handler = async () => ({ statusCode: 200 });\n",
    });
    expect(await auditFunctionsDirectory(root)).toEqual(["goes-cloud-mask"]);
  });

  it("rejects a directory of tests", async () => {
    const root = await directoryOf({
      "goes-cloud-mask.mts": HANDLER,
      "__tests__/a.test.ts": "",
    });
    const [finding] = await auditFunctionsDirectory(root);
    expect(finding.kind).toBe("test-directory");
  });
});

describe("functions that live in their own directory", () => {
  it("accepts an index entrypoint", async () => {
    const root = await directoryOf({ "goes-cloud-mask/index.mts": HANDLER });
    expect(await auditFunctionsDirectory(root)).toEqual(["goes-cloud-mask"]);
  });

  it("accepts an entrypoint named after its directory", async () => {
    const root = await directoryOf({ "goes-cloud-mask/goes-cloud-mask.mts": HANDLER });
    expect(await auditFunctionsDirectory(root)).toEqual(["goes-cloud-mask"]);
  });

  /* Not a second endpoint — Netlify bundles it into the function — but test
     code shipped to production all the same. */
  it("still reports a test bundled inside one", async () => {
    const root = await directoryOf({
      "goes-cloud-mask/index.mts": HANDLER,
      "goes-cloud-mask/index.test.ts": "",
    });
    const [finding] = await auditFunctionsDirectory(root);
    expect(finding.kind).toBe("test-file");
    expect(finding.entry).toBe("goes-cloud-mask/index.test.ts");
  });

  it("reports a directory Netlify would deploy nothing from", async () => {
    const root = await directoryOf({ "shared/dap4.mts": "export const x = 1;\n" });
    const [finding] = await auditFunctionsDirectory(root);
    expect(finding.kind).toBe("unexpected-entry");
  });
});

describe("the real directory", () => {
  it("holds only the cloud proxy", async () => {
    const directory = new URL("../../netlify/functions/", import.meta.url);
    expect(await auditFunctionsDirectory(directory.pathname)).toEqual(["goes-cloud-mask"]);
  });
});
