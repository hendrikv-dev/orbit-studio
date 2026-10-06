import type { SkyFinderTarget } from "./skyFinder";

export type SkyMarkerKind =
  | "sun"
  | "saturn"
  | "jupiter"
  | "mars"
  | "venus"
  | "mercury"
  | "uranus"
  | "neptune"
  | "pluto"
  | "moon"
  | "satellite"
  | "radiant"
  | "cluster"
  | "deep-sky"
  | "planet";

/** A small, deterministic visual classification of Tracker's existing target. */
export function skyMarkerKindForTarget(target: SkyFinderTarget): SkyMarkerKind {
  const body = target.source.kind === "body" ? target.source.body.toLowerCase() : "";
  const identity = `${target.id} ${target.title}`.toLowerCase();
  const title = target.title.trim().toLowerCase();
  // Body-specific artwork follows the authoritative source class. Exact-title
  // fallback handles legacy body targets without misclassifying objects such
  // as the Saturn Nebula or Sunflower Galaxy as Solar System bodies.
  if (body === "sun" || title === "sun") return "sun";
  if (body === "saturn" || title === "saturn") return "saturn";
  if (body === "jupiter" || title === "jupiter") return "jupiter";
  if (body === "mars" || title === "mars") return "mars";
  if (body === "venus" || title === "venus") return "venus";
  if (body === "mercury" || title === "mercury") return "mercury";
  if (body === "uranus" || title === "uranus") return "uranus";
  if (body === "neptune" || title === "neptune") return "neptune";
  if (body === "pluto" || title === "pluto") return "pluto";
  if (body === "moon" || title === "moon") return "moon";
  if (target.source.kind === "sampled" || /\biss\b|satellite/.test(identity)) return "satellite";
  if (target.shape === "radiant") return "radiant";
  if (target.shape === "cluster") return "cluster";
  if (target.source.kind === "body") return "planet";
  return "deep-sky";
}
