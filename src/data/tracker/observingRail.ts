import type { CardMedia } from "./cardMedia";
import type { BestWindow } from "./conditions";
import type { EventPresentation } from "./eventPresentation";
import type { Opportunity } from "./opportunity";
import type { Significance } from "./significance";

/**
 * What goes on the rail, and in what order.
 *
 * ## Why this is not just the ranking
 *
 * The ranking answers "which of tonight's opportunities is best", and it
 * answers it for a page with room to explain itself. A rail across the bottom
 * of a map has room for four or five things, and the reader is skimming rather
 * than reading — so the question changes to "what is worth telling this person
 * about at a glance", and the honest answer is usually shorter than the
 * ranking.
 *
 * The order is the ranking's, because two authorities disagreeing about what is
 * best is a defect this project has already fixed once. What this adds is a
 * floor: routine things drop off rather than filling the rail to a target
 * count. A rail of two on a quiet night is the truth; a rail of five with three
 * of them "the Moon is up" is a catalogue.
 *
 * ## The Moon rule
 *
 * The Moon is both a target and a condition, and the risk is showing it twice.
 * It used to have a card of its own in the corner of the map, which meant a
 * bright Moon could appear there *and* on the rail, saying the same thing in
 * two places and taking map space to do it.
 *
 * The rule now has three parts:
 *
 *   1. The Moon is **always** on the rail. It is the one object that is worth
 *      knowing about every night — its phase and its timing decide what else is
 *      possible — so it does not have to clear the floor the other candidates
 *      do. On a night with nothing else, it is the answer.
 *   2. A **lunar eclipse replaces it** rather than joining it. They are the
 *      same body, and two Moon cards side by side is the duplication this rule
 *      exists to prevent — the eclipse is strictly the more informative of the
 *      two, so it takes the place.
 *   3. Its influence on *other* targets stays where it belongs: in the
 *      moonlight condition and in the meteor model's own Moon term, where it is
 *      a modifier rather than a thing to look at.
 */

export interface RailCandidate {
  id: string;
  presentation: EventPresentation;
  opportunity: Opportunity;
  rank: number;
  significance?: Significance;
  /**
   * What this card shows, resolved once by `cardMediaFor`.
   *
   * Replaces a bare image URL, which could only express "a photograph" or
   * "nothing" — and "nothing" is what a conjunction got, because a pairing has
   * no photograph that is true of it.
   */
  media: CardMedia;
  /** The recommended observing interval, for the card's own sky path. */
  window: BestWindow | null;
}

export interface RailCard extends RailCandidate {
  /** Why this earned a place, for the tests and for the reasoning to be legible. */
  reason: "exceptional" | "strong" | "notable-circumstance" | "routine";
}

/**
 * The significance tiers, ordered.
 *
 * Tiers rather than a number, deliberately. The ranking's own priority is a
 * continuous score and the brief forbids exposing one — "0.46" is
 * unfalsifiable where "37 days from opposition" is not — so the rail reasons in
 * the same vocabulary the significance model already publishes.
 */
const TIER_ORDER: Record<string, number> = {
  routine: 0,
  "good-example": 1,
  favourable: 2,
  notable: 3,
};

function tierRank(candidate: RailCandidate): number {
  return TIER_ORDER[candidate.significance?.tier ?? "routine"] ?? 0;
}

/** As many as fit before the reader is scrolling rather than choosing. */
export const RAIL_SOFT_LIMIT = 5;

/**
 * Kinds that are events in their own right rather than objects that are up.
 *
 * An eclipse or a shower peak is a thing that is happening; a planet is a thing
 * that exists and is currently visible. The first always outranks the second
 * at equal priority, because "there is an eclipse today" is news and "Saturn is
 * up, as it has been for months" is not.
 */
const EVENT_KINDS = new Set(["solar-eclipse", "lunar-eclipse", "meteors"]);

function reasonFor(candidate: RailCandidate): RailCard["reason"] {
  const tier = tierRank(candidate);
  // Notable is exceptional wherever it comes from; an event kind reaching
  // merely favourable is exceptional too, because "there is an eclipse today"
  // is news in a way that "Saturn is up, as it has been for months" is not.
  if (tier >= TIER_ORDER.notable) return "exceptional";
  if (EVENT_KINDS.has(candidate.opportunity.kind) && tier >= TIER_ORDER.favourable) {
    return "exceptional";
  }
  if (tier >= TIER_ORDER.favourable) return "strong";
  if (tier >= TIER_ORDER["good-example"]) return "notable-circumstance";
  return "routine";
}

/** Whether a candidate is the Moon as an object, rather than an event involving it. */
function isPlainMoon(candidate: RailCandidate): boolean {
  return candidate.opportunity.kind === "moon";
}

/**
 * Whether an event has the Moon as one of its subjects.
 *
 * An eclipse of the Moon obviously does. So does a conjunction the Moon is half
 * of — and that case is the one this exists for: "The Moon and Saturn" sitting
 * directly beside "The Moon", with the same rise time, the same direction and
 * the same phase drawn on both cards, is the interface saying one thing twice.
 *
 * Read from the science rather than from the title, because a title is prose
 * and "The Moon and Saturn" only happens to contain the word.
 */
function involvesMoon(candidate: RailCandidate): boolean {
  const { opportunity } = candidate;
  if (opportunity.kind === "lunar-eclipse") return true;
  const science = opportunity.science;
  if (science?.kind === "conjunction") {
    return (
      science.moon !== null ||
      science.bodies.some((body) => body.toLowerCase().includes("moon"))
    );
  }
  return false;
}

export interface RailShape {
  /**
   * How many routine opportunities to show before stopping.
   *
   * Three on an ordinary night: the rail is an answer, and five things that are
   * merely up is a list rather than an answer. A reader who has said they are
   * observing with binoculars or a telescope has asked a different question —
   * the deep sky is routine by construction, available for months at a time,
   * and it is the entire content of what they asked for — so the cap rises with
   * the rule rather than the objects pretending to be rare.
   */
  routineLimit?: number;
  /** The most cards to show at all. */
  limit?: number;
  /**
   * Equipment the reader has said they are using, when it is not their eyes.
   *
   * The rail then guarantees room for a few things that actually *need* it.
   * Without that the control does nothing on most nights: a telescope target is
   * demoted by the ranking for needing a telescope — correctly, because the
   * default question is what you can see without one — so it sits below the
   * same three planets the reader sees every night, and "Telescope" produces
   * the naked-eye answer with a longer tail.
   */
  aided?: "binoculars" | "telescope";
}

export function buildRail(candidates: RailCandidate[], shape: RailShape = {}): RailCard[] {
  const routineLimit = shape.routineLimit ?? 3;
  const limit = shape.limit ?? RAIL_SOFT_LIMIT;
  /**
   * The Moon is taken out before the loop, not found during it.
   *
   * It is exempt from the soft limit, and a loop that breaks on that limit can
   * stop before ever reaching it — on a night with five stronger events the
   * card that is documented as always present was silently dropped.
   */
  const moonCandidate = candidates.find(isPlainMoon) ?? null;
  const moon: RailCard | null = moonCandidate
    ? { ...moonCandidate, reason: reasonFor(moonCandidate) }
    : null;

  const cards: RailCard[] = [];
  for (const candidate of candidates) {
    if (isPlainMoon(candidate)) continue;
    const reason = reasonFor(candidate);
    if (reason === "routine" && cards.length >= routineLimit) continue;
    cards.push({ ...candidate, reason });
    if (cards.length >= limit) break;
  }

  /**
   * And what the equipment adds, which is what the reader asked about.
   *
   * Appended in rank order rather than promoted into the list: the ranking's
   * judgement about what is best tonight is not wrong, and a galaxy should not
   * displace a planet at opposition. What was wrong was the rail stopping
   * before it reached anything the reader's equipment was for.
   */
  if (shape.aided) {
    const already = new Set(cards.map((card) => card.id));
    let added = 0;
    const take = (wanted: (candidate: RailCandidate) => boolean) => {
      for (const candidate of candidates) {
        if (added >= 3) return;
        if (already.has(candidate.id) || !wanted(candidate)) continue;
        cards.push({ ...candidate, reason: reasonFor(candidate) });
        already.add(candidate.id);
        added += 1;
      }
    };
    /**
     * The tier the reader named first, then anything else their rule admits.
     *
     * "What your equipment adds" has to mean the equipment they said. A
     * telescope reader offered three more binocular objects has been told
     * nothing about their telescope — and binocular objects outrank telescope
     * ones by construction, because the ranking demotes for needing equipment,
     * so first-come order fills with them every time.
     */
    take((candidate) => candidate.opportunity.guidance.equipment === shape.aided);
    take((candidate) => candidate.opportunity.guidance.equipment !== "eyes");
  }

  /**
   * A notable event about the Moon stands in for the Moon.
   *
   * Decided against the cards that actually surfaced, not against every
   * candidate: an event the rail did not find room for has not said anything to
   * the reader, so it cannot stand in for anything. A routine one does not
   * displace either — the rule is about a notable event making the plain card
   * redundant, not about the word "moon" appearing anywhere on the rail.
   */
  const moonEventSurfaced = cards.some(
    (card) => involvesMoon(card) && card.reason !== "routine",
  );
  if (moonEventSurfaced) return cards;

  if (!moon) return cards;
  /**
   * Placed where the ranking put it, not appended.
   *
   * The Moon is guaranteed a card, not a guaranteed position: on the night of a
   * good comet it belongs below the comet, and pinning it to either end would
   * be the rail disagreeing with the ranking about what matters.
   */
  const at = cards.findIndex((card) => card.rank > moon!.rank);
  if (at === -1) cards.push(moon);
  else cards.splice(at, 0, moon);
  return cards;
}
