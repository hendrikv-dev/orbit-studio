import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installTrackerRecoveryReviewBridge,
  trackerRecoveryReviewEnabled,
  trackerRecoveryReviewEvidence,
} from "./trackerRecoveryReview";

beforeEach(() => {
  vi.stubGlobal("window", {
    location: { search: "" },
    __ORBIT_TRACKER_RECOVERY_REVIEW__: undefined,
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Tracker recovery production-review adapter", () => {
  const enabled = "?app=tracker&review=1&tracker-recovery-review=target-obscured";

  it("is unavailable outside the explicit named review fixture", () => {
    expect(trackerRecoveryReviewEnabled("?app=tracker")).toBe(false);
    expect(trackerRecoveryReviewEnabled("?app=tracker&review=1")).toBe(false);
    expect(
      trackerRecoveryReviewEvidence("planet-saturn", "2026-09-03T05:00:00.000Z", "?app=tracker"),
    ).toBeNull();
  });

  it("supplies target-scoped evidence without claiming visual verification", () => {
    expect(
      trackerRecoveryReviewEvidence("planet-saturn", "2026-09-03T05:00:00.000Z", enabled),
    ).toEqual({
      source: "observer",
      observedUtc: "2026-09-03T05:00:00.000Z",
      scope: "target-direction",
      targetId: "planet-saturn",
      finding: "heavy-cloud",
      confidence: "high",
      visualVerification: false,
    });
  });

  it("accepts the runner's pre-navigation fixture when URL canonicalization removes review params", () => {
    window.location.search = "?app=tracker";
    window.__ORBIT_TRACKER_RECOVERY_FIXTURE__ = "target-obscured";
    expect(trackerRecoveryReviewEnabled()).toBe(true);
  });

  it("installs no refresh hook outside review mode", () => {
    const refreshConditions = vi.fn();
    const dispose = installTrackerRecoveryReviewBridge({ refreshConditions });
    expect(window.__ORBIT_TRACKER_RECOVERY_REVIEW__).toBeUndefined();
    expect(refreshConditions).not.toHaveBeenCalled();
    dispose();
  });

  it("refetches through the supplied production query hook in review mode", async () => {
    window.location.search = enabled;
    const refreshConditions = vi.fn().mockResolvedValue(undefined);
    const dispose = installTrackerRecoveryReviewBridge({ refreshConditions });
    await window.__ORBIT_TRACKER_RECOVERY_REVIEW__!.refreshForecast();
    expect(refreshConditions).toHaveBeenCalledTimes(1);
    dispose();
    expect(window.__ORBIT_TRACKER_RECOVERY_REVIEW__).toBeUndefined();
  });
});
