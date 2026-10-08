import fragmentationCauses from "./generated/fragmentationCauses.json";
import type { FragmentationEvent } from "./explorerFragmentation";

/**
 * Why an object fragmented — the one fact in the debris view that GCAT does not
 * carry.
 *
 * GCAT records parentage and separation times and nothing about cause, so this
 * comes from NASA's standing reference and stays visibly separate from it. The
 * catalog is never overwritten: fragment counts, dates and orbits all remain
 * GCAT's, and this layer adds a single assessed cause where the reference and
 * the catalog agree on both the object and the date.
 *
 * See data/fragmentation-causes/PROVENANCE.md.
 */

export type AssessedCause =
  | "PROPULSION"
  | "BATTERY"
  | "DELIBERATE"
  | "COLLISION, DELIBERATE"
  | "COLLISION, ACCIDENTAL"
  | "UNKNOWN";

interface FragmentationCauseArtifact {
  schemaVersion: 1;
  reference: {
    id: string;
    title: string;
    reportNumber: string;
    publisher: string;
    published: string;
    url: string;
    rights: string;
    provenanceKind: "curated-reference";
    assessmentCutoff: string;
  };
  coverage: {
    referenceEventCount: number;
    catalogEventCount: number;
    matchedEventCount: number;
    catalogFragmentCount: number;
    matchedFragmentCount: number;
  };
  causeByEventId: Record<string, AssessedCause>;
}

const artifact = fragmentationCauses as FragmentationCauseArtifact;

export const fragmentationCauseReference = artifact.reference;
export const fragmentationCauseCoverage = artifact.coverage;

/**
 * How an event's cause stands epistemically. The distinction that matters is
 * between `assessed-unknown` and `unassessed`: the first is a published finding
 * that the cause could not be determined, the second is silence because the
 * event falls outside the reference. Collapsing them would turn "nobody knows"
 * and "nobody here has looked" into the same statement.
 */
export type CauseStanding = "assessed" | "assessed-unknown" | "unassessed";

export interface FragmentationCause {
  standing: CauseStanding;
  /** Present only when standing is "assessed". */
  cause?: Exclude<AssessedCause, "UNKNOWN">;
  /** Short human phrasing of the assessed cause. */
  label: string;
  /** Why the event is unassessed, when it is. */
  note?: string;
}

const CAUSE_LABELS: Record<AssessedCause, string> = {
  PROPULSION: "Propulsion-related break-up",
  BATTERY: "Battery failure",
  DELIBERATE: "Deliberate destruction",
  "COLLISION, DELIBERATE": "Destroyed by deliberate collision",
  "COLLISION, ACCIDENTAL": "Accidental collision",
  UNKNOWN: "Cause investigated, undetermined",
};

export function fragmentationCauseFor(event: FragmentationEvent): FragmentationCause {
  const assessed = artifact.causeByEventId[event.id];
  if (!assessed) {
    const cutoffYear = Number(artifact.reference.assessmentCutoff.slice(0, 4));
    const eventYear = Number(event.dateIso.slice(0, 4));
    return {
      standing: "unassessed",
      label: "Cause not assessed in the cited reference",
      note:
        Number.isFinite(eventYear) && eventYear > cutoffYear
          ? `This break-up postdates the ${artifact.reference.published} reference edition.`
          : undefined,
    };
  }
  if (assessed === "UNKNOWN") {
    return { standing: "assessed-unknown", label: CAUSE_LABELS.UNKNOWN };
  }
  return { standing: "assessed", cause: assessed, label: CAUSE_LABELS[assessed] };
}

/** True where the reference attributes the break-up to a collision of either kind. */
export function isCollision(cause: FragmentationCause): boolean {
  return cause.cause === "COLLISION, ACCIDENTAL" || cause.cause === "COLLISION, DELIBERATE";
}
