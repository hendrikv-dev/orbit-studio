import { EQUIPMENT_ORDER, type Equipment, type Opportunity } from "./opportunity";
import { nakedEyeVerdict, skyConditionsAt, type NakedEyeVerdict } from "./nakedEye";

/**
 * What the reader is observing with, as a rule rather than a filter.
 *
 * ## Why this is not a Layer and not a section of the product
 *
 * A layer is something drawn on the map; equipment is not drawn anywhere. And a
 * separate "telescope mode" would be a second product with a second ranking,
 * which is the thing Tracker keeps refusing to build. What equipment changes is
 * *what is eligible* — one more clause in the admission rules the rail already
 * runs — and everything after admission stays exactly as it was: the same
 * significance, the same ranking, the same cards, the same page.
 *
 * ## Why the default is the eyes
 *
 * Because the question Tracker exists to answer is "what can I see from here
 * tonight", and the honest default answer is the one that needs nothing. A
 * reader who owns a telescope can say so; a reader who does not should never be
 * offered a galaxy.
 */

export type EquipmentRule = Equipment;

export const EQUIPMENT_RULES: { id: EquipmentRule; label: string; blurb: string }[] = [
  { id: "eyes", label: "Naked eye", blurb: "Only what you can see without help" },
  { id: "binoculars", label: "Binoculars", blurb: "Adds what binoculars bring in" },
  { id: "telescope", label: "Telescope", blurb: "Adds deep-sky targets and fine detail" },
];

/** Whether a rule admits something needing this much equipment. */
export function admits(rule: EquipmentRule, needed: Equipment): boolean {
  return EQUIPMENT_ORDER[needed] <= EQUIPMENT_ORDER[rule];
}

export interface ObservingContext {
  latitudeDeg: number;
  longitudeDeg: number;
  /** The instant the recommendation is about. */
  atUtc: string;
  /** Upward artificial radiance at the observer, or null where not known. */
  artificialLightRadiance: number | null;
  /** Terrain standing in the target's direction, where it has been measured. */
  terrainHorizonDeg?: number | null;
}

export interface AdmissionVerdict {
  admitted: boolean;
  reason: string;
}

/**
 * The apparent magnitude of the thing the reader would be looking at.
 *
 * Null where the phenomenon has no single brightness, which is not a gap to be
 * filled: a meteor shower has a rate, an eclipse is an event, and the Moon is
 * never in doubt. Those are admitted by the rules that understand them.
 *
 * Conjunctions are not judged here either, and that is a decision rather than a
 * gap: Tracker only forms a pairing between bodies it already considers worth
 * naming, so both members are bright, and `ConjunctionPosition` carries where
 * each one stands rather than how bright it is. Inventing a magnitude for the
 * pair from the bodies' names would be exactly the guess this file exists to
 * avoid.
 */
export function apparentMagnitudeOf(opportunity: Opportunity): number | null {
  const science = opportunity.science;
  if (science?.kind === "planet") return science.state?.magnitude ?? null;
  return null;
}

/** The altitude the recommendation is about, from the phenomenon's own profile. */
export function altitudeAt(opportunity: Opportunity, atUtc: string): number | null {
  let nearest: { altitudeDeg: number; distance: number } | null = null;
  const target = Date.parse(atUtc);
  for (const sample of opportunity.profile) {
    if (sample.altitudeDeg === undefined) continue;
    const distance = Math.abs(Date.parse(sample.atUtc) - target);
    if (!nearest || distance < nearest.distance) {
      nearest = { altitudeDeg: sample.altitudeDeg, distance };
    }
  }
  return nearest?.altitudeDeg ?? null;
}

/**
 * Whether this opportunity belongs in the rail under the reader's rule.
 *
 * Two clauses, in this order, because they fail for different reasons and the
 * reader is owed the right one:
 *
 * 1. Does the rule admit the equipment it needs? A galaxy is not a naked-eye
 *    object on any night, and saying "too faint tonight" would imply that some
 *    other night it would not be.
 * 2. Under the naked-eye rule, can a person actually see it *tonight*? This is
 *    the clause that stops "above the horizon" from being the whole test.
 *
 * Aided rules skip the second clause deliberately. Binoculars and a telescope
 * change the limiting magnitude by several magnitudes each, and Tracker has no
 * calibrated model of by how much for a given instrument — so rather than
 * invent one, an aided rule admits what its equipment tier admits and leaves the
 * brightness judgement to the ranking, which already weighs how well placed a
 * thing is.
 */
export function admissible(
  rule: EquipmentRule,
  opportunity: Opportunity,
  context: ObservingContext,
): AdmissionVerdict {
  const needed = opportunity.guidance.equipment;
  if (!admits(rule, needed)) {
    return {
      admitted: false,
      reason:
        needed === "telescope"
          ? "Needs a telescope, and the current rule is what you can see without one."
          : "Needs binoculars, and the current rule is what you can see without them.",
    };
  }
  if (rule !== "eyes") {
    return { admitted: true, reason: "Within reach of the equipment you have said you are using." };
  }

  const verdict = nakedEyeCheck(opportunity, context);
  return { admitted: verdict.visible, reason: verdict.reason };
}

/**
 * The naked-eye verdict for an opportunity, across the night rather than at an
 * instant.
 *
 * ## Why it is not judged at one moment
 *
 * The first version asked the question at the recommended instant, which is the
 * obvious thing and is wrong: an object rises. Mars is below the horizon at the
 * moment a night's *best* window happens to fall and perfectly visible two
 * hours earlier, and judging the instant removed it from the rail entirely. The
 * reader's question is "can I see it tonight", so the rule walks the
 * phenomenon's own profile and admits it if there is a moment when the answer
 * is yes — reporting that moment's verdict, which is the one worth telling them
 * about.
 *
 * Every eighth sample, because a profile is sampled far more finely than the
 * sky changes and each one costs three ephemeris evaluations. The best sample
 * is always included whatever the stride lands on, so thinning can lower the
 * cost and never the answer.
 */
export function nakedEyeCheck(
  opportunity: Opportunity,
  context: ObservingContext,
): NakedEyeVerdict {
  const magnitude = apparentMagnitudeOf(opportunity);
  if (magnitude === null) {
    return {
      visible: true,
      reason: "Judged on its own terms rather than on brightness.",
      headroom: null,
    };
  }

  const withAltitude = opportunity.profile.filter((sample) => sample.altitudeDeg !== undefined);
  if (withAltitude.length === 0) {
    return {
      visible: true,
      reason: "Judged on its own terms rather than on brightness.",
      headroom: null,
    };
  }

  const best = withAltitude.reduce((top, sample) =>
    sample.relative > top.relative ? sample : top,
  );
  const candidates = withAltitude.filter((sample, index) => index % 8 === 0 || sample === best);

  let bestVerdict: NakedEyeVerdict | null = null;
  for (const sample of candidates) {
    const verdict = nakedEyeVerdict(
      {
        apparentMagnitude: magnitude,
        altitudeDeg: sample.altitudeDeg as number,
        terrainHorizonDeg: context.terrainHorizonDeg ?? null,
      },
      skyConditionsAt(
        context.latitudeDeg,
        context.longitudeDeg,
        sample.atUtc,
        context.artificialLightRadiance,
      ),
    );
    if (verdict.visible) return verdict;
    // Keep the least-bad reason, which is the most informative one to report:
    // "too faint" beats "below the horizon" as an explanation of the night.
    if (
      bestVerdict === null ||
      (verdict.headroom !== null && (bestVerdict.headroom === null || verdict.headroom > bestVerdict.headroom))
    ) {
      bestVerdict = verdict;
    }
  }
  return bestVerdict ?? { visible: false, reason: "Not visible from here tonight.", headroom: null };
}
