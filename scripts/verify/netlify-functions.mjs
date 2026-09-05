/**
 * Is everything in the Netlify functions directory something we meant to
 * deploy?
 *
 * ## Why this exists
 *
 * Netlify treats every top-level file in the configured functions directory as
 * a deployable function, and derives that function's name from the file's
 * basename minus its final extension. A test sitting next to its subject is
 * therefore not a test as far as the deploy is concerned — it is a public
 * endpoint. `goes-cloud-mask.test.ts` became a function named
 * `goes-cloud-mask.test`, and because a dot is not legal in a function name the
 * whole deploy was rejected:
 *
 *   The following serverless functions failed to deploy: goes-cloud-mask.test
 *
 * Nothing local caught it. The unit suite passed, `npm run build` passed, and
 * even `netlify build` passed — it bundled both files without complaint and
 * wrote `goes-cloud-mask.zip` and `goes-cloud-mask.test.zip`. The name is only
 * rejected server-side, at deploy, after the site build has already succeeded.
 * That gap between "every gate is green" and "production will not accept this"
 * is the thing this file closes, and it has to close it statically, because the
 * only tool that would have caught it is the one we do not get to run.
 *
 * ## What it checks
 *
 * The functions directory is read from `netlify.toml` rather than written here
 * again, so moving the directory moves the check with it.
 *
 * A top-level entry is a finding when it is a test or spec, a fixture or mock,
 * a dotfile, something generated, a file whose derived function name is not
 * legal, or a module with no handler export — that last one being a helper that
 * would quietly become its own public endpoint. Inside a legitimate function's
 * own subdirectory the rules relax to the ones that still matter: support files
 * there are bundled into that function rather than deployed separately, so a
 * test in there is shipping test code to production rather than opening a
 * second endpoint.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** What Netlify uses when `netlify.toml` names no directory of its own. */
export const NETLIFY_DEFAULT_FUNCTIONS_DIRECTORY = "netlify/functions";

/** Extensions Netlify will treat as a JavaScript-family function entrypoint. */
const FUNCTION_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

/**
 * A legal Netlify function name.
 *
 * Letters, digits, hyphen and underscore. The dot is the interesting exclusion:
 * it is what turns `a.test.ts` into the name `a.test` and breaks the deploy.
 */
const VALID_FUNCTION_NAME = /^[A-Za-z0-9_-]+$/;

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const FIXTURE_OR_MOCK = /(^|[.\-_])(fixtures?|mocks?|stubs?|samples?)([.\-_]|$)/i;
const GENERATED = /(\.d\.ts|\.map|\.tsbuildinfo|\.log|\.snap|\.zip)$/i;
const TEST_DIRECTORY = /^(__tests__|__mocks__|__fixtures__|tests?|specs?|fixtures?|mocks?)$/i;

/**
 * Read the functions directory out of `netlify.toml`.
 *
 * A deliberately small reader rather than a TOML dependency: it walks the file
 * a line at a time, tracks which table it is inside, and returns `directory`
 * from `[functions]`. It understands the shape this repository's config
 * actually uses and nothing more, which is why it reports how it decided —
 * a caller that silently fell back to a default would disable this check the
 * day somebody moved the directory.
 *
 * `[functions.name]` and `[functions."name"]` tables are per-function settings,
 * not the directory, so they are skipped rather than read.
 */
export function readFunctionsDirectory(toml) {
  let table = "";
  let directory = null;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = line.match(/^\[+([^\]]+)\]+$/);
    if (header) {
      table = header[1].trim();
      continue;
    }
    if (table !== "functions") continue;
    const pair = line.match(/^directory\s*=\s*["']([^"']+)["']/);
    if (pair) directory = pair[1].trim();
  }
  return directory;
}

/** Everything wrong with one directory listing, as sentences about the deploy. */
export async function auditFunctionsDirectory(directory) {
  const findings = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [
      {
        kind: "missing-directory",
        entry: directory,
        detail: "the configured functions directory does not exist",
      },
    ];
  }

  const deployable = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = entry.name;
    const full = path.join(directory, name);

    if (name.startsWith(".")) {
      findings.push({ kind: "dotfile", entry: name, detail: "a dotfile in a deployment surface" });
      continue;
    }

    if (entry.isDirectory()) {
      if (TEST_DIRECTORY.test(name)) {
        findings.push({
          kind: "test-directory",
          entry: `${name}/`,
          detail: "a directory of tests inside the deployable tree",
        });
        continue;
      }
      /* Netlify reads a subdirectory as one function when it holds `index.*` or
         a file named after the directory. Anything else in there is a loose
         directory nobody asked to deploy. */
      const inner = await readdir(full).catch(() => []);
      const entrypoint = inner.find((file) => {
        const base = path.basename(file, path.extname(file));
        return (
          FUNCTION_EXTENSIONS.has(path.extname(file)) && (base === "index" || base === name)
        );
      });
      if (!entrypoint) {
        findings.push({
          kind: "unexpected-entry",
          entry: `${name}/`,
          detail: "a directory with no index or same-named entrypoint, so Netlify deploys nothing from it",
        });
        continue;
      }
      if (!VALID_FUNCTION_NAME.test(name)) {
        findings.push({
          kind: "invalid-function-name",
          entry: `${name}/`,
          detail: `Netlify would name this function "${name}", which is not a legal function name`,
        });
      }
      /* Support files here are bundled into the function rather than deployed
         beside it, so the concern changes: not a second endpoint, but test code
         shipped to production. */
      for (const file of inner) {
        if (TEST_FILE.test(file) || FIXTURE_OR_MOCK.test(file)) {
          findings.push({
            kind: "test-file",
            entry: `${name}/${file}`,
            detail: "bundled into the deployed function rather than deployed beside it, but still shipped",
          });
        }
      }
      deployable.push(name);
      continue;
    }

    /* Before the extension check, because a declaration file ends in `.ts` and
       would otherwise be reported as a function with an illegal name — true,
       but not the useful half of the sentence. */
    if (GENERATED.test(name)) {
      findings.push({
        kind: "generated-file",
        entry: name,
        detail: "a generated file, which has no reason to sit in the deployable tree",
      });
      continue;
    }

    const extension = path.extname(name);
    if (!FUNCTION_EXTENSIONS.has(extension)) {
      findings.push({
        kind: "unexpected-entry",
        entry: name,
        detail: "not a function entrypoint, and has no reason to sit in the deployable tree",
      });
      continue;
    }

    const derived = path.basename(name, extension);

    if (TEST_FILE.test(name)) {
      findings.push({
        kind: "test-file",
        entry: name,
        detail: `Netlify would deploy this as a public function named "${derived}"`,
      });
      continue;
    }
    if (FIXTURE_OR_MOCK.test(name)) {
      findings.push({
        kind: "fixture-or-mock",
        entry: name,
        detail: `Netlify would deploy this as a public function named "${derived}"`,
      });
      continue;
    }
    if (!VALID_FUNCTION_NAME.test(derived)) {
      findings.push({
        kind: "invalid-function-name",
        entry: name,
        detail: `Netlify would name this function "${derived}", which is not a legal function name`,
      });
      continue;
    }

    /* An intended entrypoint answers requests. A module that exports helpers
       and no handler is a support file that Netlify will publish as an endpoint
       anyway, which is the quieter half of this bug: it deploys successfully
       and is simply live. */
    const source = await readFile(path.join(directory, name), "utf8").catch(() => "");
    const handled =
      /export\s+default\s/.test(source) ||
      /export\s+(const|let|var|async\s+function|function)\s+handler\b/.test(source);
    if (!handled) {
      findings.push({
        kind: "support-module",
        entry: name,
        detail: `no handler export, yet Netlify would publish it as the function "${derived}"`,
      });
      continue;
    }

    deployable.push(derived);
  }

  return findings.length > 0 ? findings : deployable;
}

async function main() {
  const configPath = path.join(projectRoot, "netlify.toml");
  const toml = await readFile(configPath, "utf8").catch(() => null);
  if (toml === null) {
    console.error("[netlify:functions] netlify.toml could not be read; cannot tell what deploys.");
    process.exitCode = 1;
    return;
  }

  const configured = readFunctionsDirectory(toml);
  const relative = configured ?? NETLIFY_DEFAULT_FUNCTIONS_DIRECTORY;
  const source = configured
    ? "netlify.toml [functions] directory"
    : "Netlify's default, because netlify.toml names no directory";
  const directory = path.resolve(projectRoot, relative);

  const exists = await stat(directory).then((s) => s.isDirectory(), () => false);
  if (!exists) {
    console.error(`[netlify:functions] ${relative} (${source}) is not a directory.`);
    process.exitCode = 1;
    return;
  }

  const result = await auditFunctionsDirectory(directory);
  if (Array.isArray(result) && result.length > 0 && typeof result[0] === "string") {
    console.log(
      `[netlify:functions] PASS ${relative} — ${result.length} ` +
        `${result.length === 1 ? "function" : "functions"}: ${result.join(", ")} ` +
        `(directory from ${source})`,
    );
    return;
  }

  console.error(`[netlify:functions] ${relative} contains entries that must not deploy:`);
  for (const finding of result) {
    console.error(`- ${finding.kind}:${finding.entry} — ${finding.detail}`);
  }
  console.error(
    "\nNetlify deploys every top-level file in this directory as a public function. " +
      "Move tests, fixtures and helpers out of it; keep only intended entrypoints.",
  );
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
