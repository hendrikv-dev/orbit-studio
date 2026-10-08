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
  | "space-station"
  | "tiangong"
  | "starlink-train"
  | "satellite"
  | "radiant"
  | "open-cluster"
  | "globular-cluster"
  | "nebula"
  | "galaxy"
  | "star"
  | "constellation"
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
  if (/starlink.*train|train.*starlink/.test(identity)) return "starlink-train";
  if (/tiangong/.test(identity)) return "tiangong";
  if (/\biss\b|international space station/.test(identity)) return "space-station";
  if (target.source.kind === "tle" || target.source.kind === "sampled" || /satellite/.test(identity)) return "satellite";
  if (target.shape === "radiant") return "radiant";
  if (target.id.startsWith("constellation-")) return "constellation";
  if (/globular|\bm\s?(?:13|15|22|92)\b/.test(identity)) return "globular-cluster";
  if (target.shape === "cluster" || /pleiades|hyades|open cluster|double cluster/.test(identity)) return "open-cluster";
  if (/nebula|\bm\s?(?:1|8|16|27|42|57)\b/.test(identity)) return "nebula";
  if (/galaxy|andromeda|whirlpool|sombrero|\bm\s?(?:31|51|81|82|104)\b/.test(identity)) return "galaxy";
  if (/^star-|\b(?:sirius|vega|arcturus|capella|rigel|betelgeuse|altair|deneb|polaris)\b/.test(identity)) return "star";
  if (target.source.kind === "body") return "planet";
  return "deep-sky";
}
