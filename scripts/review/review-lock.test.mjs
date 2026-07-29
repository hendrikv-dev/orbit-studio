import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireReviewLock } from "./review-lock.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ),
  );
});

async function temporaryLockPath() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orbit-review-lock-"));
  temporaryRoots.push(root);
  return path.join(root, "review.lock");
}

describe("review process lock", () => {
  it("rejects a concurrent owner before shared review output can be removed", async () => {
    const lockPath = await temporaryLockPath();
    const release = await acquireReviewLock(lockPath);

    await expect(acquireReviewLock(lockPath)).rejects.toThrow(
      /Concurrent review runs would invalidate the shared evidence directory/,
    );

    await release();
  });

  it("releases ownership for the next valid review run", async () => {
    const lockPath = await temporaryLockPath();
    const releaseFirst = await acquireReviewLock(lockPath);
    await releaseFirst();

    const releaseSecond = await acquireReviewLock(lockPath);
    await releaseSecond();
    await releaseSecond();
  });
});
