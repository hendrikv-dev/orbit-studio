import type { ExplorerOrbitAvailability } from "./explorerCatalog";

/**
 * Which orbital elements are measured, and which are not.
 *
 * The catalog's orbit *shape* — inclination, apsides, and the eccentricity and
 * semi-major axis derived from them — comes from GCAT. Its orbit *angles* —
 * right ascension of the ascending node, argument of perigee, and the anomaly —
 * do not exist in the source at all and are generated deterministically per
 * object. The export names them `raanDegReconstructed`,
 * `argumentOfPerigeeDegReconstructed` and `meanAnomalyDegReconstructed`, and
 * `latestExactStateCount` in the same artifact is zero: no object in this
 * catalog has an observed angle.
 *
 * Rendering a fabricated RAAN in the same list, in the same type, as a sourced
 * inclination tells a student that both are measurements. For an audience
 * learning the Keplerian element set that is the most consequential thing the
 * interface can get wrong, so the distinction is carried to the point of
 * display rather than being left in a caveat on another tab.
 */

export type ElementProvenance =
  /** Retained from the source record with its own epoch. */
  | "sourced"
  /** Generated to make a renderable orbit; carries no observational claim. */
  | "reconstructed"
  /** Hand-curated to represent the real orbit, not read from a live source. */
  | "representative"
  /** No orbit is available for this object at all. */
  | "unavailable";

export interface OrbitElementProvenance {
  /** Inclination, eccentricity, semi-major axis, perigee, apogee. */
  shape: ElementProvenance;
  /** RAAN, argument of perigee, true anomaly. */
  angles: ElementProvenance;
  /** One sentence a reader can act on, naming what is and is not measured. */
  note: string;
}

const RECONSTRUCTED: OrbitElementProvenance = {
  shape: "sourced",
  angles: "reconstructed",
  note:
    "Shape comes from the GCAT record. The angles are not in the source and are "
    + "generated so the orbit can be drawn — they place the object on its orbit, "
    + "and are not a measurement of where it is.",
};

const CURATED: OrbitElementProvenance = {
  shape: "representative",
  angles: "representative",
  note:
    "A curated reference orbit describing the mission's real orbit. It is not read "
    + "from a live source, so the angles show a representative position rather than "
    + "the object's current one.",
};

const UNAVAILABLE: OrbitElementProvenance = {
  shape: "unavailable",
  angles: "unavailable",
  note: "This object is in the catalog without usable orbital parameters, so no orbit is shown.",
};

export function explorerElementProvenance(
  availability: ExplorerOrbitAvailability | undefined,
): OrbitElementProvenance {
  switch (availability) {
    case "reconstructed-historical-orbit":
    case "nearest-historical-orbit":
    case "exact-historical-orbit":
      return RECONSTRUCTED;
    case "catalog-only":
      return UNAVAILABLE;
    case "curated-reference-orbit":
    case "current-representative-orbit":
      return CURATED;
    default:
      // An unknown availability must not silently read as measured.
      return RECONSTRUCTED;
  }
}

/** Short badge text, or null where the value carries no caveat. */
export function elementProvenanceLabel(provenance: ElementProvenance): string | null {
  switch (provenance) {
    case "reconstructed":
      return "reconstructed";
    case "representative":
      return "representative";
    case "unavailable":
      return "unavailable";
    case "sourced":
      return null;
  }
}
