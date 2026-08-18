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

import type { OpportunitySample, TransparencyDemand } from "./conditions";

export type OpportunityKind =
  | "meteors"
  | "moon"
  | "planet"
  | "conjunction"
  | "lunar-eclipse"
  | "deep-sky";

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

export interface Opportunity {
  id: string;
  kind: OpportunityKind;
  /** What it is called, as a person would say it. */
  title: string;
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
   * How good the phenomenon itself is across the night, each value relative to
   * its own best. Weather is applied against this rather than against the
   * single recommended instant, because the point of combining them is to find
   * a clear gap that is not the peak.
   */
  profile: OpportunitySample[];
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

/** The most rarity may move an item. One band, never more. */
const RARITY_CAP = 0.08;

export type Band = "exceptional" | "very good" | "good" | "fair" | "marginal";

export interface RankedOpportunity {
  opportunity: Opportunity;
  /** Position in the ranked list, 1-based. */
  rank: number;
  band: Band;
  /** The ordering value. Exposed, never the only thing exposed. */
  strength: number;
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
        "Kept in the list rather than led with: not strong enough tonight to be worth a special trip.",
      );
    }

    scored.push({
      opportunity,
      rank: 0,
      band: bandFor(strength),
      strength,
      rarityContribution,
      promotable,
      appliedRules: rules,
    });
  }

  const ordered = scored.sort((a, b) => b.strength - a.strength);
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
      // `strength` deliberately keeps its phenomenon-only meaning; only the
      // ordering below sees the weather.
      ordering: entry.strength * factor,
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
  viewingBand: "excellent" | "good" | "possible" | "unlikely",
  /** The sky as a noun phrase — "cloud", "rain or snow" — not as a chip label. */
  skyPhrase: string,
  conditionsKnown: boolean,
  hasPassed: boolean,
): string {
  const plural = kind === "meteors";
  const is = plural ? "are" : "is";
  const them = plural ? "them" : "it";

  if (hasPassed) {
    return `${title} ${is} below the horizon for the rest of tonight.`;
  }
  if (!conditionsKnown || !skyPhrase) {
    return phenomenonBand === "exceptional" || phenomenonBand === "very good"
      ? "One of the best things in the sky tonight. No forecast for here, so check the sky yourself before you commit."
      : "Worth a look if you are out anyway. No forecast available for here.";
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
