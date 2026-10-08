import type { FinderCapabilities } from "./skyFinder";

export type SkyNavigationMode = "point" | "explore";
export type SkyDensityTier = "wide" | "normal" | "close";

export interface SkyDensityRules {
  tier: SkyDensityTier;
  magnitudeLimit: number;
  namedStarMagnitudeLimit: number;
  maxLabels: number;
  maxDeepSkyObjects: number;
  showMilkyWay: boolean;
  showSelectedFigure: boolean;
}

/**
 * Point is the default only when the current surface can truthfully follow a
 * physical handheld. Explore remains the deterministic fallback for planning
 * dates and devices without orientation input.
 */
export function initialSkyNavigationMode(
  capabilities: FinderCapabilities,
  liveDate: boolean,
): SkyNavigationMode {
  return capabilities.handheldEligible && capabilities.orientation && liveDate
    ? "point"
    : "explore";
}

/**
 * One automatic density policy for the rendered sphere and camera overlay.
 * Field of view, not a user-maintained category preference, decides how much
 * supporting context is legible. Selection may strengthen its own anchored
 * constellation figure without hiding unrelated celestial context.
 */
export function skyDensityForView(options: {
  horizontalFovDeg: number;
  selectedConstellation: boolean;
}): SkyDensityRules {
  const tier: SkyDensityTier = options.horizontalFovDeg >= 96
    ? "wide"
    : options.horizontalFovDeg <= 46
      ? "close"
      : "normal";

  if (tier === "wide") {
    return {
      tier,
      magnitudeLimit: 3.8,
      namedStarMagnitudeLimit: 0.8,
      maxLabels: 4,
      maxDeepSkyObjects: 1,
      showMilkyWay: true,
      showSelectedFigure: false,
    };
  }
  if (tier === "close") {
    return {
      tier,
      magnitudeLimit: 6.5,
      namedStarMagnitudeLimit: 3.2,
      maxLabels: 12,
      maxDeepSkyObjects: 10,
      showMilkyWay: false,
      showSelectedFigure: options.selectedConstellation,
    };
  }
  return {
    tier,
    magnitudeLimit: 5.45,
    namedStarMagnitudeLimit: 1.8,
    maxLabels: 7,
    maxDeepSkyObjects: 5,
    showMilkyWay: true,
    showSelectedFigure: options.selectedConstellation,
  };
}

export interface SkyLabelCandidate {
  key: string;
  xPercent: number;
  yPercent: number;
  priority: number;
}

/**
 * Deterministic screen-space label suppression. Higher priority labels win;
 * equal-priority labels retain their stable input order. This is presentation
 * only and never changes the underlying catalogue or target eligibility.
 */
export function selectNonCollidingSkyLabels(
  candidates: readonly SkyLabelCandidate[],
  limit: number,
  spacing = { horizontalPercent: 13, verticalPercent: 6 },
): Set<string> {
  const chosen: SkyLabelCandidate[] = [];
  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => right.candidate.priority - left.candidate.priority || left.index - right.index);

  for (const { candidate } of ordered) {
    if (chosen.length >= limit) break;
    if (chosen.some((existing) =>
      Math.abs(existing.xPercent - candidate.xPercent) < spacing.horizontalPercent &&
      Math.abs(existing.yPercent - candidate.yPercent) < spacing.verticalPercent
    )) continue;
    chosen.push(candidate);
  }
  return new Set(chosen.map((candidate) => candidate.key));
}
