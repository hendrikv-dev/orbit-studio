import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export async function acquireReviewLock(lockPath) {
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;

    const owner = await readFile(path.join(lockPath, "owner.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    const ownerSummary = owner
      ? ` PID ${owner.pid}, started ${owner.startedAt}.`
      : " Owner metadata is unavailable.";
    throw new Error(
      `Another Orbit Studio review owns ${lockPath}.${ownerSummary} ` +
        "Concurrent review runs would invalidate the shared evidence directory.",
    );
  }

  try {
    await writeFile(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await rm(lockPath, { recursive: true, force: true });
  };
}
