import type { AuroraVisibility } from "./aurora";
import type { Opportunity } from "./opportunity";

/**
 * What earns a place in Best tonight.
 *
 * ## The problem this fixes
 *
 * Best tonight was a fixed inventory. Aurora, Meteors and the Moon appeared
 * every night from every location, because Tracker supports those categories
 * and they are technically present in the sky — and once something is in a
 * ranked list it must be given a position and a quality label, which is how
 * "Aurora · Excellent" came to sit above a page explaining the oval was too far
 * north to see. Relabelling it "Poor" would have been a smaller lie in the same
 * shape: aurora was not the sixth-best thing to do that night, it was not
 * something to do at all.
 *
 * ## The stages, deliberately separate
 *
 *   phenomenon → eligible? → how good? → rank among the eligible → copy
 *
 * Eligibility asks whether there is a real reason to go outside for this thing
 * tonight. Quality asks how good that reason is. Collapsing them into one
 * threshold is what produces a ranked list of things nobody should rank.
 *
 * ## What eligibility may not depend on
 *
 * Weather. Cloud, smoke and haze change how good an existing opportunity is;
 * they cannot create one. A clear sky over a quiet auroral oval is a clear
 * sky over nothing. Every rule below reads the phenomenon, never the forecast.
 */

export interface EligibilityVerdict {
  eligible: boolean;
  /** Why, in Tracker's own words — used for the direct-lookup explanation. */
  reason: string;
}

/**
 * Where "there is something here" begins.
 *
 * Deliberately *not* `HERO_FLOOR`, which is 0.35 and whose documented meaning
 * is "not strong enough tonight to be worth a special trip". That is a stronger
 * standard than this list needs. Best tonight answers "is there a meaningful
 * reason for someone here to deliberately look for this tonight" — Saturn well
 * placed qualifies even though nobody should drive an hour for it.
 *
 * 0.22 is not a new number: it is the existing boundary in `bandFor` between
 * "marginal" and "fair". Below it the ranking already calls an opportunity
 * marginal, and a marginal opportunity is one nobody would deliberately go and
 * look for. Reusing that boundary keeps one definition of "there is something
 * here" rather than inventing a second.
 *
 * Measured against a real night from Portland: Saturn 0.54 and Mars 0.32 clear
 * it — both are naked-eye planets somebody could go out and find. Jupiter at
 * 0.14 does not: a thirty-minute window low in the pre-dawn sky is not a reason
 * to set an alarm.
 */
export const BEST_TONIGHT_FLOOR = 0.22;

/**
 * How high a distant aurora must stand, and how strong it must be, to count.
 *
 * Five degrees is roughly a fist's width at arm's length above the horizon —
 * about where a display clears an ordinary treeline and the thickest haze.
 * Thirty percent is where NOAA's own figure stops describing a possibility and
 * starts describing something people photograph.
 */
export const AURORA_MINIMUM_USEFUL_ELEVATION_DEG = 5;
export const AURORA_MINIMUM_USEFUL_PERCENT = 30;

/**
 * Aurora, which is eligible only when it could actually be seen.
 *
 * The three inputs the brief names — credible activity, plausible local
 * visibility, and darkness to see it in — reduce to one question the visibility
 * model already answers: is the aurora overhead, or within reach of the
 * horizon? Both of those require real activity *and* a location the oval
 * reaches. "Unlikely", "unavailable" and "expired" are not opportunities: the
 * first says there is nothing to see, and the other two say Tracker does not
 * know, which is not a reason to go outside either.
 */
export function auroraEligibility(
  visibility: AuroraVisibility | null,
  hasDarkness: boolean,
): EligibilityVerdict {
  if (!visibility) {
    return { eligible: false, reason: "No space-weather data has been read yet." };
  }
  if (!hasDarkness) {
    return { eligible: false, reason: "It does not get dark enough here tonight to see aurora." };
  }
  switch (visibility.kind) {
    case "overhead":
      return { eligible: true, reason: "NOAA puts the aurora over this location." };
    case "horizon": {
      /**
       * Geometry above the horizon is not a viewing opportunity.
       *
       * `AuroraVisibility` answers whether emission clears the Earth's curve,
       * which a faint oval two thousand kilometres away technically does at
       * one degree of elevation. Nobody sees that: it is below the haze, behind
       * whatever is on the horizon, and dim to begin with.
       *
       * Two further conditions, both about the display rather than the
       * geometry. It has to stand far enough up to clear an ordinary skyline,
       * and NOAA has to give the source cell a probability worth travelling to
       * a dark northern view for — aurora seen from far outside the oval is
       * only ever the bright kind.
       */
      const elevation = visibility.apparentElevationDeg ?? 0;
      const probability = visibility.source?.probabilityPercent ?? 0;
      if (elevation < AURORA_MINIMUM_USEFUL_ELEVATION_DEG) {
        return {
          eligible: false,
          reason: "Any aurora would sit too low on the horizon to see from here.",
        };
      }
      if (probability < AURORA_MINIMUM_USEFUL_PERCENT) {
        return {
          eligible: false,
          reason: "The nearest aurora is too weak to be worth looking for from here.",
        };
      }
      return { eligible: true, reason: "The aurora is close enough to show above the horizon." };
    }
    case "unlikely":
      return { eligible: false, reason: "No aurora is expected from here tonight." };
    case "expired":
      return { eligible: false, reason: "The last aurora nowcast has expired." };
    case "unavailable":
    default:
      return { eligible: false, reason: "Aurora data is unavailable." };
  }
}

/**
 * Meteors, which need a shower that is actually producing.
 *
 * A named radiant is necessary and not sufficient. Minor showers are active for
 * weeks at rates indistinguishable from the sporadic background, and a row
 * saying "Meteors" on a night offering three an hour is the same fixed-inventory
 * mistake as a permanent aurora row.
 *
 * So the gate is the observed rate at the best moment of the night —
 * `perHour`, which already folds in radiant altitude, the population index and
 * the limiting magnitude, and is therefore about what this observer would
 * actually see rather than about the shower's headline ZHR under ideal skies.
 *
 * The threshold is set where a rate stops being background. Sporadics run
 * around five an hour; at fifteen a watcher notices a shower is on without
 * being told.
 */
export const METEOR_MATERIAL_PER_HOUR = 15;

export function meteorEligibility(
  opportunity: Opportunity,
  expectedPerHour: number | null,
): EligibilityVerdict {
  if (opportunity.geometry?.kind !== "radiant") {
    return {
      eligible: false,
      reason: "No meteor shower is active tonight. Sporadic meteors are still possible.",
    };
  }
  if (expectedPerHour === null) {
    return { eligible: false, reason: "There is no usable rate for tonight." };
  }
  if (expectedPerHour < METEOR_MATERIAL_PER_HOUR) {
    return {
      eligible: false,
      reason: `A shower is active, but only about ${Math.round(expectedPerHour)} an hour from here — close to the background rate.`,
    };
  }
  return {
    eligible: true,
    reason: `A shower is running at about ${Math.round(expectedPerHour)} an hour from here.`,
  };
}

/**
 * The Moon, which is eligible when something is happening to it.
 *
 * Not when it merely has a name. Full, First Quarter and Last Quarter were
 * treated as qualifying, and they are not: they recur every month, they are
 * visible for days either side, and "the Moon is full" is not a reason to go
 * outside tonight rather than tomorrow. Naming a phase is not an opportunity
 * signal, it is a calendar fact.
 *
 * The lunar opportunities that do qualify reach Best tonight as other kinds
 * entirely — `lunar-eclipse` for an eclipse, `conjunction` for a pairing — and
 * are judged on their own strength like anything else. What is left under
 * `lunar-phase` is the ordinary Moon, and the honest answer for the ordinary
 * Moon is that it is up and there is nothing particular to see on it.
 *
 * If Tracker later models something that genuinely distinguishes one Full Moon
 * from another — perigee, a favourable libration, a bright graze — that belongs
 * here as a signal. Until it exists, the gate does not pretend to have it.
 */
export function moonEligibility(opportunity: Opportunity): EligibilityVerdict {
  const science = opportunity.science;
  if (science?.kind !== "lunar-phase") {
    // An eclipse or an occultation arriving under the Moon's own kind is a real
    // event; it is judged on strength rather than excluded here.
    return generalEligibility(0.5);
  }
  if (science.phase.name === "New Moon") {
    return {
      eligible: false,
      reason: "There is no Moon in the sky tonight, which makes it a good night for faint objects.",
    };
  }
  return {
    eligible: false,
    reason: "The Moon is up tonight, but there is no particular lunar event to watch.",
  };
}

/**
 * Everything else — planets, deep-sky, pairings — on its own merit.
 *
 * These carry a strength combining how observable, how striking and how easy
 * the thing is. The gate asks whether there is a meaningful reason to look for
 * it deliberately, not whether it is exceptional: a well-placed planet belongs
 * in the list, a marginal one low in the pre-dawn sky does not.
 */
export function generalEligibility(strength: number): EligibilityVerdict {
  if (strength >= BEST_TONIGHT_FLOOR) {
    return { eligible: true, reason: "Well enough placed tonight to be worth finding." };
  }
  return {
    eligible: false,
    reason: "Above the horizon tonight, but too marginal to be worth looking for.",
  };
}
