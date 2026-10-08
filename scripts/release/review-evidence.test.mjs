import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveReleaseReviewRun, REVIEW_RUN_ENV } from "./review-evidence.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "orbit-release-review-"));
  const projectRoot = path.join(root, "orbit-studio");
  const reviewRoot = path.join(root, "evidence");
  await Promise.all([
    mkdir(projectRoot),
    mkdir(path.join(reviewRoot, "runs"), { recursive: true }),
  ]);
  return { projectRoot, reviewRoot };
}

describe("release review evidence discovery", () => {
  it("uses an explicitly supplied external run", async () => {
    const { projectRoot, reviewRoot } = await fixture();
    const run = path.join(reviewRoot, "manual-release-run");
    await mkdir(run);

    await expect(resolveReleaseReviewRun({
      env: { [REVIEW_RUN_ENV]: run },
      projectRoot,
    })).resolves.toBe(await realpath(run));
  });

  it("selects the newest append-only run from the configured external root", async () => {
    const { projectRoot, reviewRoot } = await fixture();
    const older = path.join(reviewRoot, "runs", "review-2026-10-08T10-00-00-000Z");
    const newer = path.join(reviewRoot, "runs", "review-2026-10-08T11-00-00-000Z");
    await Promise.all([mkdir(older), mkdir(newer)]);

    await expect(resolveReleaseReviewRun({
      env: { ORBIT_REVIEW_OUTPUT_DIR: reviewRoot },
      projectRoot,
    })).resolves.toBe(await realpath(newer));
  });

  it("fails clearly when no generated run exists", async () => {
    const { projectRoot, reviewRoot } = await fixture();
    await expect(resolveReleaseReviewRun({
      env: { ORBIT_REVIEW_OUTPUT_DIR: reviewRoot },
      projectRoot,
    })).rejects.toThrow(/No external review runs/);
  });

  it("fails clearly when the configured external review root does not exist", async () => {
    const { projectRoot, reviewRoot } = await fixture();
    const missingRoot = path.join(reviewRoot, "missing");

    await expect(resolveReleaseReviewRun({
      env: { ORBIT_REVIEW_OUTPUT_DIR: missingRoot },
      projectRoot,
    })).rejects.toThrow(/External review evidence directory does not exist/);
  });

  it("rejects an explicit repository-local directory", async () => {
    const { projectRoot } = await fixture();
    const localReview = path.join(projectRoot, "review");
    await mkdir(localReview);

    await expect(resolveReleaseReviewRun({
      env: { [REVIEW_RUN_ENV]: localReview },
      projectRoot,
    })).rejects.toThrow(/inside the repository/i);
  });

  it("rejects a symlink that resolves back into the repository", async () => {
    const { projectRoot, reviewRoot } = await fixture();
    const localReview = path.join(projectRoot, "review");
    const disguised = path.join(reviewRoot, "disguised-run");
    await mkdir(localReview);
    await symlink(localReview, disguised);

    await expect(resolveReleaseReviewRun({
      env: { [REVIEW_RUN_ENV]: disguised },
      projectRoot,
    })).rejects.toThrow(/inside the repository/i);
  });
});
