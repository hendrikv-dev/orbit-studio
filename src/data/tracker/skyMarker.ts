import type { SkyFinderTarget } from "./skyFinder";

export type SkyMarkerKind =
  | "saturn"
  | "jupiter"
  | "mars"
  | "venus"
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
  if (body === "saturn" || /\bsaturn\b/.test(identity)) return "saturn";
  if (body === "jupiter" || /\bjupiter\b/.test(identity)) return "jupiter";
  if (body === "mars" || /\bmars\b/.test(identity)) return "mars";
  if (body === "venus" || /\bvenus\b/.test(identity)) return "venus";
  if (body === "moon" || /\bmoon\b/.test(identity)) return "moon";
  if (target.source.kind === "sampled" || /\biss\b|satellite/.test(identity)) return "satellite";
  if (target.shape === "radiant") return "radiant";
  if (target.shape === "cluster") return "cluster";
  if (target.source.kind === "body") return "planet";
  return "deep-sky";
}
