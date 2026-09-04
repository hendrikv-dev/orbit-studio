/**
 * What Tracker ranks, and how.
 *
 * V1 §4 is the requirement this file exists to satisfy, and one sentence of it
 * governs the design:
 *
 * > Scientific significance, rarity, visual spectacle, practical opportunity,
 * > and confidence are different qualities. The implementation must not collapse
 * > them into an opaque score that produces implausible recommendations.
 *
 * So they are kept as separate named qualities on every opportunity, they stay
 * separate through ranking, and they are all still there afterwards for the
 * explanation to be generated from (TRACKER_PRD R5.2 — a rank whose explanation
 * is written separately will drift from it).
 *
 * ## Why this is not a weighted sum
 *
 * A weighted sum can express "spectacle matters more than rarity". It cannot
 * express any of the four things V1 §4 actually asks for, because each of them
 * is a rule about what may *never* happen:
 *
 * - An event that cannot be seen from here tonight is not a low-scoring event;
 *   it is not a candidate. No amount of rarity or spectacle rescues it.
 * - A telescope target may never outrank a naked-eye target that is itself
 *   worth going out for — "the default ranking should favor opportunities that
 *   can be seen without special equipment".
 * - Rarity may promote, but never dominate: a once-a-decade event low on the
 *   horizon in twilight is not worth going outside for, and a ranking that says
 *   otherwise is wrong (R5.4).
 * - Below a floor, nothing is promoted to the hero position merely to fill it —
 *   "weak events should not be promoted merely to populate the interface".
 *
 * Each of those is a gate or a cap, and the ranking applies them explicitly and
 * records which ones fired. The continuous part only orders what survives.
 */

import type {
  EnvironmentalEvidenceStatus,
  OpportunitySample,
  TransparencyDemand,
} from "./conditions";
import type { LunarPhase } from "./lunarPhase";
import type { LunarEclipseTiming } from "./lunarEclipse";
import type { PlanetaryOpposition } from "./planetaryEvents";
import { ROUTINE, priorityFor, type PlanetState, type Significance } from "./significance";
import type { AngularSeparationDegrees } from "./scientificUnits";

export type OpportunityKind =
  | "meteors"
  | "moon"
  | "planet"
  | "conjunction"
  | "lunar-eclipse"
  /**
   * Solar eclipses, which happen in daylight.
   *
   * Their own kind rather than a variant of the lunar one, because everything
   * about how they are gated is different: a lunar eclipse is a night event and
   * qualifies by the Moon being up during the observing window, while a solar
   * eclipse qualifies by happening on this calendar date with the Sun above the
   * horizon. Ranking a date's opportunities by "is it up tonight" excluded them
   * entirely, which meant Tracker could not show a reader the total eclipse
   * passing over their own house.
   */
  | "solar-eclipse"
  | "deep-sky"
  /**
   * A spacecraft passing overhead, which is an event rather than a target.
   *
   * Its own kind and not a variant of anything: it is up for four minutes
   * rather than a night, its brightness comes from reflected sunlight and so
   * ends the moment it enters the Earth's shadow, and the thing a reader is
   * told is a track across the sky rather than a direction to face.
   */
  | "satellite";

/**
 * Whether an opportunity stays discoverable when the weather prevents it.
 *
 * ## Why this is not the significance tier
 *
 * Cloud suppression used to ask the significance model: `favourable` and
 * `notable` survived a closed sky, everything else was withheld. Those are
 * answers to a different question. Significance says *how good an observing
 * opportunity this is*; this says *whether missing it costs the reader
 * anything they can get back*. They correlate and they are not the same, and
 * the gap between them is where the defect lived: a 3° Moon–Venus pairing rates
 * `favourable`, so it survived a closed sky — while the Moon passes a bright
 * planet most months, and the code that ranks it says so in its own comment.
 * Meanwhile a modest occultation could rate `good-example` and vanish.
 *
 * So it is its own property, on the opportunity, decided where the opportunity
 * is built and by the physics of the thing rather than by how it scored.
 *
 * ## The two values
 *
 * `routine` — it comes round again. Withholding it on a night nobody could see
 * it costs the reader nothing, and offering five things none of which are
 * visible is a catalogue with apologies attached.
 *
 * `time-critical` — this window is the window. It stays on the rail with the
 * obstruction stated plainly, because a satellite pixel knows nothing about the
 * gap over the next valley and the reader is the one entitled to weigh a drive
 * against a forecast.
 *
 * It is required rather than optional on purpose: a new kind of opportunity has
 * to decide, and cannot inherit an answer by omission.
 */
export type ObstructionPersistence = "routine" | "time-critical";

/** What you need to see it. Ordered: each tier includes the ones before it. */
export type Equipment = "eyes" | "binoculars" | "telescope";

export const EQUIPMENT_ORDER: Record<Equipment, number> = {
  eyes: 0,
  binoculars: 1,
  telescope: 2,
};

/**
 * The separate qualities. Each is 0–1 and each means something different; the
 * point of the type is that they are never interchangeable.
 */
export interface Qualities {
  /**
   * Whether it is actually observable from here tonight — above the horizon,
   * high enough, dark enough, for long enough. This is the gate, not a weight.
   */
  observability: number;
  /** How striking it is if you do see it. */
  spectacle: number;
  /** How likely you are to notice it and know that you have. */
  recognisability: number;
  /** How little effort it costs: staying up until 3am is not free. */
  ease: number;
  /** How much of this is geometry and how much is a forecast. */
  confidence: number;
  /** How rarely this is available from here. Capped in ranking, see below. */
  rarity: number;
}

export interface ObservationGuidance {
  /** What you will actually see, in plain terms. Never an astrophotograph. */
  appearance: string;
  /** When to go outside. */
  whenUtc: string;
  /** How long the window lasts, in minutes. */
  durationMinutes: number;
  /** Which way to face. Null where it does not matter — meteors, for one. */
  direction: string | null;
  /** How high to look. */
  elevation: string;
  /** How long to give it. */
  howLong: string;
  equipment: Equipment;
  /** Anything specific to this target: averted vision, dark adaptation. */
  technique: string | null;
  /**
   * Mandatory and unsuppressable where it applies (TRACKER_PRD R5.6). Anything
   * involving the Sun sets this, and every surface must show it before any other
   * guidance rather than behind a disclosure control.
   */
  safety: string | null;
}

/**
 * Per-phenomenon geometry, kept out of OpportunitySample deliberately.
 *
 * Discriminated so a consumer has to ask what kind of event it is holding
 * before drawing it. A drawing that treats a radiant like a planet, or a
 * planet like a radiant, is wrong in a way that looks plausible.
 */
export type PhenomenonGeometry =
  | {
      kind: "radiant";
      /** Where the radiant is, sampled across the night. */
      track: { atUtc: string; altitudeDeg: number; azimuthDeg: number }[];
    }
  | {
      kind: "target";
      /** Rise, culmination and set, where they fall inside the period. */
      riseUtc: string | null;
      culminationUtc: string | null;
      setUtc: string | null;
    };

export interface Opportunity {
  id: string;
  kind: OpportunityKind;
  /** What it is called, as a person would say it. */
  title: string;
  /**
   * Whether cloud may take this off the rail. See `ObstructionPersistence`.
   *
   * Answered by every producer, because the answer is about the event and only
   * the code that knows what the event is can give it.
   */
  persistence: ObstructionPersistence;
  /**
   * A short name for a place too narrow for the title.
   *
   * Optional, and supplied where the full title would otherwise be clipped into
   * something worse than either half of it. A closed rail card is about 190px:
   * "The Space Station passes overhead" became "The Space Stati…", which names
   * nothing. "ISS" names it exactly.
   *
   * Deliberately a field rather than a function that shortens the title. There
   * is no rule that turns "The Moon, a waning gibbous" into "Waning gibbous
   * Moon" — that is editorial, it belongs where the title is written, and a
   * heuristic that guessed it would be wrong somewhere nobody was looking.
   */
  shortTitle?: string;
  /** One line: what you can see. */
  summary: string;
  qualities: Qualities;
  guidance: ObservationGuidance;
  /**
   * Why this kind of thing happens at all, independent of the observer
   * (TRACKER_PRD R5.7). Not the same question as `tonight`.
   */
  phenomenon: string;
  /** Why it is visible from here, at this time. The other half of R5.7. */
  tonight: string;
  /** Inputs that were unavailable. Ranked without them, and said so (R5.3). */
  missingInputs: string[];
  /** Caveats that apply to the numbers actually produced. */
  limitations: string[];
  /**
   * How much of an event this is, as opposed to how good a view it is.
   *
   * Supplied by the phenomenon, because only the phenomenon knows what makes
   * one of its own showings unusual — days from opposition for a planet,
   * contact geometry for an eclipse, the rate actually produced for a shower.
   * Absent means routine, which is the safe default: a phenomenon that has not
   * been taught what is unusual about itself must not claim to be unusual.
   */
  significance?: Significance;
  /**
   * Unit-bearing scientific meaning consumed by every Tracker projection.
   * Titles, Calendar labels, detail copy, and imagery must derive from this
   * structure rather than reinterpret dependency numbers independently.
   */
  science?:
    | { kind: "lunar-phase"; phase: LunarPhase }
    | {
        kind: "solar-eclipse";
        /** Greatest fraction of the Sun covered from here, 0–1. */
        obscuration: number;
        /** `total`, `annular`, `partial`. */
        eclipseKind: string;
        peakUtc: string;
        centralDurationSeconds: number | null;
      }
    | {
        kind: "lunar-eclipse";
        timing: LunarEclipseTiming;
        obscurationFraction: number;
        localContactAltitudesDeg: Readonly<Record<string, number>>;
      }
    | {
        kind: "planet";
        body: string;
        event: PlanetaryOpposition | null;
        /**
         * The measured circumstances behind this showing.
         *
         * Carried so the page can quote the facts that decided the ranking —
         * days from opposition, apparent size, ring tilt — rather than a score.
         * Null where no physical constants are recorded for the body.
         */
        state?: PlanetState | null;
      }
    | {
        kind: "conjunction";
        bodies: readonly [string, string];
        separationDeg: AngularSeparationDegrees;
        /**
         * Where each body actually stands at the moment being recommended.
         *
         * Carried so a visual can be *drawn from the event* rather than
         * illustrated with a photograph of a different one. Every conjunction
         * used to show the same picture of the Moon and Venus — wrong planet,
         * wrong phase, wrong separation — under a "Representative example"
         * badge, which is not a licence to contradict the thing being depicted.
         */
        positions: readonly [ConjunctionPosition, ConjunctionPosition];
        /** The instant the positions describe. */
        atUtc: string;
        /** The Moon's real phase then, where the Moon is one of the pair. */
        moon: { illuminatedFraction: number; waning: boolean } | null;
      };
  /**
   * How good the phenomenon itself is across the night, each value relative to
   * its own best. Weather is applied against this rather than against the
   * single recommended instant, because the point of combining them is to find
   * a clear gap that is not the peak.
   */
  profile: OpportunitySample[];
  /**
   * Geometry that belongs to this phenomenon and to no other.
   *
   * A meteor shower has no target position — you do not look *at* a shower —
   * so its samples carry no altitude or azimuth. What it has instead is a
   * radiant, which moves through the night and which the observing advice is
   * built around ("keep the north-east in view, but do not stare at it").
   * Forcing that into the sample's altitude/azimuth would make a radiant look
   * like something to point at, which is the one thing it is not.
   */
  geometry?: PhenomenonGeometry;
  /**
   * How much this needs a genuinely transparent sky. The Moon survives cloud
   * that ends a meteor watch, so the same forecast means different things to
   * different phenomena.
   */
  transparency: TransparencyDemand;
  /**
   * A second way to see the same thing, with more equipment.
   *
   * Saturn and Saturn's rings were two entries in the list, ranked separately
   * and reading as unrelated events. They are one thing in the sky: a point you
   * can find with your eyes, which becomes a ringed planet through a telescope.
   * Splitting them made the list longer and the night harder to understand.
   */
  /**
   * Facts the hero picture needs that the guidance does not carry.
   *
   * The Moon card drew a half-lit disc under the words "a waxing crescent",
   * because the scene defaulted to a half phase and nothing told it otherwise.
   * A picture that contradicts its own caption is worse than no picture.
   */
  sceneHints?: { illuminatedFraction?: number; waning?: boolean };
  alsoWith?: {
    equipment: Equipment;
    /** "With a telescope" — the lead-in, not a title. */
    lead: string;
    appearance: string;
    technique: string | null;
  };
}

/** One body's position at the recommended instant, in the observer's sky. */
export interface ConjunctionPosition {
  body: string;
  altitudeDeg: number;
  azimuthDeg: number;
}

/** Below this an opportunity is not observable enough to be ranked at all. */
const OBSERVABILITY_GATE = 0.15;

/** Below this an opportunity may appear in the list but never lead it. */
const HERO_FLOOR = 0.35;

/**
 * A naked-eye opportunity at or above this strength cannot be displaced from
 * the hero position by anything needing equipment, however good it is. Set where
 * "genuinely worth going out for" starts.
 */
const NAKED_EYE_PROTECTION = 0.45;

/**
 * How far needing equipment demotes an opportunity.
 *
 * V1 §4 asks for two things that pull against each other: the default ranking
 * should favour what can be seen without equipment, and "an equipment-dependent
 * event may still be prominent". A hard reordering satisfies the first and
 * breaks the second — and it also produced a list whose numbers contradicted
 * themselves, an item labelled *exceptional* sitting below one labelled *very
 * good*, because the order and the label were no longer computed from the same
 * thing. A demotion satisfies both: naked-eye wins every close call, an
 * outstanding telescope target still rises, and the hero rule below is the hard
 * guarantee that the *first* thing offered never assumes equipment.
 */
const EQUIPMENT_DEMOTION: Record<Equipment, number> = {
  eyes: 1,
  binoculars: 0.85,
  telescope: 0.7,
};

/**
 * The most rarity may move an item *within its significance band*.
 *
 * This used to be the whole of Tracker's novelty model, and it was the defect:
 * one band was not enough to lift a locally visible lunar eclipse over a planet
 * that is up most nights of the year, so Saturn led a page on eclipse night.
 * Novelty now decides which band an opportunity is ordered in — see
 * `significance.ts` — and this small term survives only as a tie-break inside
 * a band, where two showings of comparable significance differ slightly in how
 * uncommon they are.
 */
const RARITY_CAP = 0.08;

export type Band = "exceptional" | "very good" | "good" | "fair" | "marginal";

export interface RankedOpportunity {
  opportunity: Opportunity;
  /** Position in the ranked list, 1-based. */
  rank: number;
  band: Band;
  /**
   * How good this opportunity is. Not the ordering value.
   *
   * Quality labels, the eligibility floor and the hero floor are all calibrated
   * on this, and it deliberately kept its meaning when novelty was introduced:
   * "how good is the view" and "how much is this worth noticing" are different
   * questions and Tracker answers them with different numbers.
   */
  strength: number;
  /** How much of an event it is, with the facts that decided it. */
  significance: Significance;
  /**
   * What the list is actually ordered by: the significance band, with
   * `strength` deciding the position inside it.
   */
  priority: number;
  /** How much of `strength` came from rarity, after the cap. */
  rarityContribution: number;
  /** True where it may take the hero position. */
  promotable: boolean;
  /** Which gates and caps fired, in the words used to explain them. */
  appliedRules: string[];
}

export interface Ranking {
  /** Ranked, strongest first. Everything that cleared the observability gate. */
  ranked: RankedOpportunity[];
  /**
   * The opportunity that leads the view, or null where nothing clears the
   * floor. Null is a real answer and must not be filled by promoting the least
   * bad option (V1 §5, V1 A7).
   */
  hero: RankedOpportunity | null;
  /** Cleared no gate. Kept, because "not tonight" is worth being able to see. */
  notTonight: Opportunity[];
}

/**
 * The continuous part, applied only to what survives the gates.
 *
 * `observability` multiplies rather than adds, because it is a precondition
 * and not a virtue: something half-observable is genuinely half as worth
 * recommending, whereas something half as rare is not.
 */
function baseStrength(qualities: Qualities): number {
  const { observability, spectacle, recognisability, ease, confidence } = qualities;
  const merit = 0.5 * spectacle + 0.25 * recognisability + 0.25 * ease;
  return observability * merit * (0.6 + 0.4 * confidence);
}

/**
 * Thresholds are set so that "exceptional" means it: a total lunar eclipse or a
 * major shower at maximum in a dark sky, and not a bright planet on an ordinary
 * evening. Reaching for the strongest word on a routine night is how a product
 * stops being believed, and V1 §5 forbids overstating brightness or certainty.
 */
export function bandFor(strength: number): Band {
  if (strength >= 0.72) return "exceptional";
  if (strength >= 0.55) return "very good";
  if (strength >= 0.38) return "good";
  if (strength >= 0.22) return "fair";
  return "marginal";
}

/**
 * Rank a night's candidates.
 *
 * The order of operations is the specification: gate, score, cap rarity, then
 * apply the equipment rule to the ordering rather than to the scores. Applying
 * equipment as a score penalty instead would let a spectacular enough telescope
 * target creep back above a naked-eye one, which is the outcome V1 §4 forbids.
 */
export function rankOpportunities(candidates: Opportunity[]): Ranking {
  const notTonight: Opportunity[] = [];
  const scored: RankedOpportunity[] = [];

  for (const opportunity of candidates) {
    const rules: string[] = [];
    const { qualities } = opportunity;

    if (qualities.observability < OBSERVABILITY_GATE) {
      notTonight.push(opportunity);
      continue;
    }

    const base = baseStrength(qualities);
    const rarityContribution = Math.min(RARITY_CAP, qualities.rarity * RARITY_CAP);
    if (qualities.rarity > 0.5 && rarityContribution >= RARITY_CAP) {
      rules.push("Rare, but rarity only moves it so far — it still has to be worth seeing.");
    }

    const equipment = opportunity.guidance.equipment;
    const strength = (base + rarityContribution) * EQUIPMENT_DEMOTION[equipment];
    if (equipment !== "eyes") {
      rules.push(equipment === "telescope" ? "Telescope required." : "Binoculars required.");
      rules.push("Ranked below what you can see with your eyes alone, which comes first by default.");
    }

    const promotable = strength >= HERO_FLOOR;
    if (!promotable) {
      rules.push(
        "Below the floor for leading the page: nothing weak is promoted merely to fill the hero slot.",
      );
    }

    /**
     * Novelty first, then how good the view is.
     *
     * The band comes from the phenomenon's own measured state; `strength`
     * places the opportunity inside that band. So a routine target can be the
     * best routine target of the night and still sit below an unusual event
     * that is merely decent — which is the ordering the product's headline
     * question implies and the previous model could not produce.
     */
    const significance = opportunity.significance ?? ROUTINE;
    const priority = priorityFor(significance, strength);
    if (significance.tier !== "routine") {
      rules.push(...significance.reasons);
    }

    scored.push({
      opportunity,
      rank: 0,
      band: bandFor(strength),
      strength,
      significance,
      priority,
      rarityContribution,
      promotable,
      appliedRules: rules,
    });
  }

  const ordered = scored.sort((a, b) =>
    b.priority === a.priority
      ? a.opportunity.id.localeCompare(b.opportunity.id)
      : b.priority - a.priority,
  );
  ordered.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  // The hard guarantee: the first thing Tracker offers never assumes equipment
  // the user may not own, as long as there is a naked-eye option genuinely worth
  // going out for. Below that floor an equipment target may lead, because the
  // honest answer is then "there is something good, but you will need a
  // telescope" rather than a weak naked-eye target dressed up as the best of the
  // night.
  const nakedEyeHero = ordered.find(
    (entry) =>
      entry.promotable &&
      entry.opportunity.guidance.equipment === "eyes" &&
      entry.strength >= NAKED_EYE_PROTECTION,
  );
  if (nakedEyeHero && ordered[0] !== nakedEyeHero && ordered[0].opportunity.guidance.equipment !== "eyes") {
    nakedEyeHero.appliedRules.push(
      "Led with because it needs nothing but your eyes.",
    );
  }

  const hero = nakedEyeHero ?? ordered.find((entry) => entry.promotable) ?? null;

  return { ranked: ordered, hero, notTonight };
}

/**
 * The explanation, generated from the same values the rank used.
 *
 * Written here rather than at each phenomenon so that it cannot drift from the
 * ranking (R5.2). A phenomenon supplies numbers; this turns the numbers it
 * actually ranked on into sentences.
 */
export function explainRank(entry: RankedOpportunity): string[] {
  const { qualities } = entry.opportunity;
  const lines: string[] = [];

  lines.push(
    qualities.observability >= 0.8
      ? "Well placed from where you are tonight."
      : qualities.observability >= 0.5
        ? "Observable from here tonight, though not ideally placed."
        : "Only marginally observable from here tonight.",
  );

  if (qualities.spectacle >= 0.7) lines.push("Genuinely striking to look at.");
  else if (qualities.spectacle <= 0.35) lines.push("Quiet rather than spectacular.");

  if (qualities.recognisability <= 0.4) {
    lines.push("Easy to miss unless you know what you are looking for.");
  }

  if (qualities.ease <= 0.4) lines.push("Takes some effort — the timing or the wait is the cost.");

  if (qualities.confidence >= 0.9) {
    lines.push("The timing is geometry, so it is as certain as the ephemeris.");
  } else if (qualities.confidence <= 0.6) {
    lines.push("Partly a forecast, so treat the numbers as an estimate.");
  }

  lines.push(...entry.appliedRules);
  return lines;
}

/**
 * How much sky access may move an item in the list.
 *
 * The follow-on specification allows conditions to "reorder events whose
 * intrinsic value is reasonably close" — and no more than that. A rare event
 * must stay discoverable behind cloud rather than dropping out of the list, so
 * the adjustment is bounded to a quarter of an item's strength: enough to swap
 * two comparable evenings, never enough to bury a total lunar eclipse because
 * the forecast is poor.
 */
const SKY_ACCESS_SWING = 0.25;

export interface SkyAdjustedOpportunity extends RankedOpportunity {
  /** Sky access at this item's best moment, 0–1, or null where unknown. */
  skyAccess: number | null;
  /** Where it sat before the weather was applied. */
  rankBeforeConditions: number;
}

/**
 * Re-order a ranking once the sky is known.
 *
 * The phenomenon's own strength is left untouched — this returns a separate
 * ordering value rather than overwriting `strength`, so "the shower is
 * excellent and the sky is shut" is still expressible afterwards. That
 * separation is the whole requirement, and folding the weather back into
 * `strength` would quietly destroy it.
 *
 * What the weather is applied *to* is `priority`, which already carries the
 * significance band. That ordering matters: a quarter-swing on an ordering
 * value that starts at 0.6 for a notable event cannot push it below a routine
 * one that tops out at 0.34, so cloud can shuffle comparable events and can
 * never bury an eclipse. Applying the same swing to `strength` — which knows
 * nothing about novelty — is what would have allowed exactly that.
 */
export function applySkyAccess(
  ranked: RankedOpportunity[],
  accessById: Map<string, number>,
): SkyAdjustedOpportunity[] {
  const adjusted = ranked.map((entry) => {
    const access = accessById.get(entry.opportunity.id) ?? null;
    const factor = access === null ? 1 : 1 - SKY_ACCESS_SWING + SKY_ACCESS_SWING * access;
    return {
      ...entry,
      skyAccess: access,
      rankBeforeConditions: entry.rank,
      // `strength` and `priority` both keep their own meanings; only the
      // ordering below sees the weather.
      ordering: entry.priority * factor,
    };
  });

  adjusted.sort((a, b) => b.ordering - a.ordering);
  return adjusted.map(({ ordering: _ordering, ...entry }, index) => ({
    ...entry,
    rank: index + 1,
  }));
}


/**
 * Choose what leads the view, over a set that may have shrunk since ranking.
 *
 * The hero rule lives here rather than at the call site because it has already
 * been broken once by being reimplemented there. Filtering out the
 * opportunities that had already set left the interface picking "the first
 * promotable one", which handed the hero to a telescope target while a
 * naked-eye target of the same band sat directly beneath it — the exact
 * outcome `NAKED_EYE_PROTECTION` exists to prevent.
 *
 * `excludedIds` covers anything ineligible now for a reason ranking could not
 * know: chiefly that its window tonight has passed.
 */
/**
 * Split what is left into what can still be observed and what cannot.
 *
 * Tracker's job is prioritisation, so an object that is below the horizon for
 * the rest of the period is not a recommendation — it is context. "The Moon, a
 * waxing crescent / Already set tonight" was occupying a slot in a ranked list
 * of things to go outside for, which inverts the whole point of ranking.
 *
 * Kept as a partition rather than a filter, and written here rather than at the
 * call site, because the unavailable set is still worth showing in its own
 * right: the Moon being down is the reason the rest of the night is dark, and a
 * reader who looked for it and could not find it deserves to be told why rather
 * than left wondering whether Tracker forgot it.
 *
 * `excludedIds` is whatever the caller has established cannot be observed for
 * the remainder of the period — the same set `chooseHero` refuses to lead with.
 * Deriving both from one input keeps the hero and the list from disagreeing
 * about what is observable, which is a class of bug this file has had before.
 */
export function partitionByAvailability<T extends RankedOpportunity>(
  entries: readonly T[],
  excludedIds: ReadonlySet<string>,
): { observable: T[]; unavailable: T[] } {
  const observable: T[] = [];
  const unavailable: T[] = [];
  for (const entry of entries) {
    (excludedIds.has(entry.opportunity.id) ? unavailable : observable).push(entry);
  }
  return { observable, unavailable };
}

export function chooseHero<T extends RankedOpportunity>(
  ranked: T[],
  excludedIds: ReadonlySet<string> = new Set(),
): T | null {
  const eligible = ranked.filter(
    (entry) => entry.promotable && !excludedIds.has(entry.opportunity.id),
  );
  if (eligible.length === 0) return null;

  const nakedEye = eligible.find(
    (entry) =>
      entry.opportunity.guidance.equipment === "eyes" &&
      entry.strength >= NAKED_EYE_PROTECTION,
  );
  // Below the protection floor an equipment target may lead, because the honest
  // answer is then "there is something good, but you will need a telescope"
  // rather than a weak naked-eye target dressed up as the best of the night.
  return nakedEye ?? eligible[0];
}


/**
 * The one sentence that says how tonight actually looks, for this thing.
 *
 * Showing "very good" and "unlikely" side by side is technically complete and
 * practically useless: the reader has to work out that the first is about the
 * shower and the second about the clouds. The requirement is to translate them
 * — "Excellent shower, but clouds make viewing unlikely from this location
 * tonight" — and translation means one sentence with the relationship in it,
 * not two labels next to each other.
 */
export function viewingConclusion(
  title: string,
  kind: OpportunityKind,
  phenomenonBand: Band,
  viewingBand: "excellent" | "good" | "possible" | "unlikely" | "unknown",
  /** The sky as a noun phrase — "cloud", "rain or snow" — not as a chip label. */
  skyPhrase: string,
  evidenceStatus: EnvironmentalEvidenceStatus,
  hasPassed: boolean,
): string {
  const plural = kind === "meteors";
  const is = plural ? "are" : "is";
  const them = plural ? "them" : "it";

  if (hasPassed) {
    return `${title} ${is} below the horizon for the rest of tonight.`;
  }
  if (evidenceStatus === "stale") {
    return phenomenonBand === "exceptional" || phenomenonBand === "very good"
      ? "Astronomically promising, but the forecast is out of date. Check current conditions before going."
      : "Potentially worth a look, but the forecast is out of date. Check current conditions first.";
  }
  if (evidenceStatus !== "available" || !skyPhrase) {
    return phenomenonBand === "exceptional" || phenomenonBand === "very good"
      ? "Astronomically promising, but conditions are unknown. Check the sky before you commit."
      : "Conditions are unknown. Check the sky before deciding whether to go.";
  }

  const strong = phenomenonBand === "exceptional" || phenomenonBand === "very good";

  if (viewingBand === "excellent") {
    if (strong) return `A genuinely good night for it, and ${skyPhrase} to see it through. Go.`;
    return kind === "moon"
      ? `Not a rare sight, but ${skyPhrase} and no effort at all.`
      : kind === "meteors"
        ? `A quiet night for them, though ${skyPhrase} gives you a fair chance.`
        : `Nothing dramatic, but ${skyPhrase} makes this an easy one to actually see.`;
  }
  if (viewingBand === "good") {
    return strong
      ? `Well worth going out for, with ${skyPhrase} at the best time.`
      : `A fair target, and ${skyPhrase} gives you a real chance.`;
  }
  if (viewingBand === "possible") {
    return strong
      ? `Excellent in itself, but ${skyPhrase} makes it a gamble from here tonight.`
      : `A quiet target under ${skyPhrase} — worth a glance, not a trip.`;
  }
  return strong
    ? `${plural ? "They are" : "It is"} at ${phenomenonBand === "exceptional" ? "its best" : "a good point"}, but ${skyPhrase} makes seeing ${them} unlikely from here tonight.`
    : `${skyPhrase.charAt(0).toUpperCase()}${skyPhrase.slice(1)} tonight — save this one for a clearer evening.`;
}

/* ------------------------------------------------------------- the verdict */

/**
 * What Tracker actually recommends, in words a person can act on.
 *
 * The product's value is judgement, not enumeration. "Excellent" is a grade;
 * "Worth staying up for" is a decision, and it is the decision the reader came
 * for. Bands still exist underneath and still drive ordering — this is the
 * sentence the band is for.
 *
 * Written once, here, because the same judgement is rendered in the hero, in
 * the secondary rail and in the planning views, and three call sites deciding
 * independently what "excellent but already setting" means is how the hero rule
 * went wrong once before.
 */
export type Verdict =
  | "GO OUT NOW"
  | "WORTH STAYING UP FOR"
  | "BEST LATER TONIGHT"
  | "EASY IF YOU'RE ALREADY OUTSIDE"
  | "ONLY IF CONDITIONS IMPROVE"
  | "NOT WORTH A SPECIAL TRIP"
  | "WORTH A DARKER SITE"
  | "CONDITIONS UNKNOWN — CHECK BEFORE GOING"
  | "BELOW THE HORIZON";

export interface VerdictInput {
  band: Band;
  /** True where the object cannot be observed for the rest of the period. */
  unavailable: boolean;
  /** Sky access at the recommended moment, 0–1, or null where unknown. */
  skyAccess: number | null;
  /** Minutes until the window opens; negative once it is open. */
  minutesUntilWindow: number | null;
  /** True where the phenomenon needs a genuinely dark site to be worth it. */
  needsDarkSite: boolean;
  /** Confidence is categorical; an absent forecast cannot masquerade as clear. */
  evidenceStatus: EnvironmentalEvidenceStatus;
}

/** How poor the sky has to be before conditions become the headline. */
const CONDITIONS_LIMITING = 0.45;

export function verdictFor(input: VerdictInput): Verdict {
  const { band, unavailable, skyAccess, minutesUntilWindow, needsDarkSite, evidenceStatus } = input;

  if (unavailable) return "BELOW THE HORIZON";
  if (evidenceStatus !== "available") return "CONDITIONS UNKNOWN — CHECK BEFORE GOING";

  // Conditions lead when they are what is actually deciding it. Said before
  // any praise of the phenomenon, because "exceptional" followed by "under
  // thick cloud" sends people outside for nothing.
  if (skyAccess !== null && skyAccess < CONDITIONS_LIMITING) {
    return band === "exceptional" || band === "very good"
      ? "ONLY IF CONDITIONS IMPROVE"
      : "NOT WORTH A SPECIAL TRIP";
  }

  const open = minutesUntilWindow !== null && minutesUntilWindow <= 0;
  const soon = minutesUntilWindow !== null && minutesUntilWindow > 0 && minutesUntilWindow <= 90;

  if (band === "exceptional" || band === "very good") {
    if (open) return "GO OUT NOW";
    if (soon) return "WORTH STAYING UP FOR";
    if (needsDarkSite) return "WORTH A DARKER SITE";
    return "BEST LATER TONIGHT";
  }

  if (band === "good") {
    if (open) return "EASY IF YOU'RE ALREADY OUTSIDE";
    return "BEST LATER TONIGHT";
  }

  return "NOT WORTH A SPECIAL TRIP";
}

/* ------------------------------------------- two vocabularies, not one word */

/**
 * How strongly Tracker recommends going out.
 *
 * Kept deliberately apart from how the sky looks. The interface previously used
 * one GOOD/EXCELLENT scale for both, which produced states that read as
 * self-contradictory — a target described as not worth a special trip sitting
 * beside a badge saying GOOD, where the badge was talking about the weather and
 * the sentence was talking about the target. A reader had to reverse-engineer
 * the scoring model to tell which was which.
 *
 * These are the words for the recommendation. The forecast has its own.
 *
 * ## Why none of them is a verdict any more
 *
 * They used to be: "Worth going out for", "Good if you're already outside",
 * "Not worth a special trip". Every one of those is a judgement about how the
 * reader should spend their evening, and the brief is right that it is both
 * presumptuous and useless — it tells somebody standing at a window nothing
 * they can act on. Worse, the same page carried three of them at once from
 * three different scales, which is how "Worth it: Excellent" came to sit above
 * "not worth a special trip".
 *
 * What replaced them describes the *situation*: how well placed the thing is,
 * and what is limiting the view. Tracker still computes the judgement — it has
 * to, to rank at all — it simply stops narrating it. The reader is given a
 * direction, a height and a time, and makes the decision themselves.
 */
export type RecommendationLevel =
  /** Strong phenomenon, sky expected to cooperate. */
  | "well-placed"
  /** Observable and unremarkable; nothing is limiting it but itself. */
  | "modest"
  /** The sky is what decides this one. */
  | "conditions-limited"
  /** No forecast reached here. Says nothing about how good the sky will be. */
  | "conditions-unknown"
  /** Below the horizon, or its window has gone. */
  | "unavailable";

export function recommendationFor(
  band: Band,
  unavailable: boolean,
  skyAccess: number | null,
  evidenceStatus: EnvironmentalEvidenceStatus = skyAccess === null ? "unavailable" : "available",
): RecommendationLevel {
  if (unavailable) return "unavailable";
  // An absent forecast is its own state and may never be reported as a good
  // sky. The review harness asserts exactly this, which is why it is a distinct
  // value rather than a wording variant of one of the others.
  if (evidenceStatus !== "available") return "conditions-unknown";
  // Conditions lead when they are what is actually deciding it — said before
  // any praise of the phenomenon, because a striking event under thick cloud
  // still sends people outside for nothing.
  if (skyAccess !== null && skyAccess < 0.45) return "conditions-limited";
  if (band === "exceptional" || band === "very good" || band === "good") return "well-placed";
  return "modest";
}
