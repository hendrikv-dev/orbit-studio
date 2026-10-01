import type { LocalSkyConditionEvidence } from "../data/tracker/cloudTimeline";
import { clearConditionCache } from "../data/tracker/weatherProviders";
import { isOrbitStudioReviewMode } from "./reviewBridge";

const RECOVERY_FIXTURE_PARAM = "tracker-recovery-review";
const RECOVERY_FIXTURE_VALUE = "target-obscured";

/**
 * Whether the deterministic Tracker recovery fixture is active.
 *
 * This is an input adapter for the production recommendation path, not a
 * replacement planner. It is deliberately available only in explicit review
 * mode and only under a named fixture value, so an ordinary URL cannot invent
 * target-direction evidence.
 */
export function trackerRecoveryReviewEnabled(search?: string): boolean {
  if (
    typeof window !== "undefined" &&
    window.__ORBIT_TRACKER_RECOVERY_FIXTURE__ === RECOVERY_FIXTURE_VALUE
  ) {
    return true;
  }
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const params = new URLSearchParams(query);
  return (
    isOrbitStudioReviewMode(query) &&
    params.get(RECOVERY_FIXTURE_PARAM) === RECOVERY_FIXTURE_VALUE
  );
}

/**
 * High-confidence evidence for the exact candidate direction, supplied only
 * by the deterministic review fixture.
 *
 * The review's weather routes separately hold the coarse forecast closed over
 * the complete observing window. This evidence supplies the missing local
 * fact the coarse forecast cannot: the selected target direction is also
 * substantially blocked now. `cloudAdvice` remains the sole eligibility
 * authority and still applies its ordinary freshness and target-id checks.
 */
export function trackerRecoveryReviewEvidence(
  targetId: string,
  observedUtc: string,
  search?: string,
): LocalSkyConditionEvidence | null {
  if (!trackerRecoveryReviewEnabled(search)) return null;
  return {
    source: "observer",
    observedUtc,
    scope: "target-direction",
    targetId,
    finding: "heavy-cloud",
    confidence: "high",
    visualVerification: false,
  };
}

export interface TrackerRecoveryReviewBridge {
  /**
   * Clear both weather cache layers and refetch through the production query.
   * The scenario changes its provider response first, then invokes this hook.
   */
  refreshForecast: () => Promise<void>;
}

/** Install the narrow forecast-refresh hook used by the recovery review. */
export function installTrackerRecoveryReviewBridge(input: {
  refreshConditions: () => Promise<unknown>;
}): () => void {
  if (typeof window === "undefined" || !trackerRecoveryReviewEnabled()) {
    return () => undefined;
  }
  const bridge: TrackerRecoveryReviewBridge = {
    refreshForecast: async () => {
      clearConditionCache();
      await input.refreshConditions();
    },
  };
  window.__ORBIT_TRACKER_RECOVERY_REVIEW__ = bridge;
  return () => {
    if (window.__ORBIT_TRACKER_RECOVERY_REVIEW__ === bridge) {
      delete window.__ORBIT_TRACKER_RECOVERY_REVIEW__;
    }
  };
}
