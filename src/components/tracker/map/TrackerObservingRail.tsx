import { useEffect, useRef } from "react";
import { ChevronRight, Mountain, X } from "lucide-react";

import { CardFigure } from "../media/CardFigures";
import { dismissOpenSurfaces } from "../../../data/tracker/dismissable";
import type { ConditionCard } from "../../../data/tracker/conditionCards";
import type { RailCard } from "../../../data/tracker/observingRail";

/**
 * What is worth looking at from here, as a rail rather than a panel.
 *
 * ## What this replaces
 *
 * A 376-pixel panel down the left of the map carrying a place name, one big
 * opportunity, a short list of others, some conditions and a button. It was a
 * good panel and it was the wrong shape: it took a quarter of the map to say
 * things most of which the reader had already read, and it made "what else is
 * there" a list to scan rather than a thing to flick through.
 *
 * The rail says the same things in a strip along the bottom. The map keeps the
 * space, the options are all visible at once, and choosing one is a single tap
 * that expands it in place rather than a navigation.
 *
 * ## Expansion is the interaction, not a route to one
 *
 * A compact card is a summary; the expanded card is the answer. Nothing
 * navigates, nothing opens over the map, and the map itself changes to match
 * the selection — an eclipse draws its path, a shower draws its field, a planet
 * gets a direction. `View full details` is still there for the deep page, and
 * it is deliberately the least prominent thing on the card.
 */

export interface RailFacts {
  /** Short label/value pairs shown when the card is expanded. */
  facts: { label: string; value: string }[];
  /** The terrain line, when one has been computed for this card. */
  terrain: { headline: string; detail: string | null } | null;
  /** Whether terrain is still being worked out, so the card can say so. */
  terrainPending: boolean;
  /** Conditions worth showing beside this specific opportunity. */
  conditions: ConditionCard[];
  /** One sentence on why this is notable, where there is one. */
  note: string | null;
  /**
   * What this event's own geography says at the selected point.
   *
   * Only events that draw something on the map have one — an eclipse path, a
   * shower's radiant geometry. It is the answer to "and what does that band
   * mean where I am standing", which is the question drawing the band creates.
   */
  event: {
    label: string;
    value: string;
    detail: string | null;
    facts: { label: string; value: string }[];
  } | null;
}

interface Props {
  cards: RailCard[];
  expandedId: string | null;
  onExpand: (id: string) => void;
  onCollapse: () => void;
  onOpenDetail: (id: string) => void;
  /** Everything the expanded card needs, computed by the caller for that card. */
  factsFor: (card: RailCard) => RailFacts;
  /** Shown as the rail's own heading, so the place is still named. */
  place: string;
  loading: boolean;
}

/** The three facts the ranking already built: when, what, where. */
function summaryOf(card: RailCard) {
  const [when, , where] = card.presentation.metrics;
  return { when: when.value, where: where.value };
}

/**
 * The name a card wears while it is closed.
 *
 * Titles here are written to be read in full — "The Moon, a waning gibbous"
 * says the useful thing about tonight's Moon. In a 190px closed card that
 * became "The Moon, a wa…", which is worse than either the name or the phase
 * alone. So the closed card drops the qualifier after the comma and the open
 * card, which has the width, carries the whole sentence.
 *
 * Titles with no comma are already short enough and pass through untouched.
 */
function compactName(title: string): string {
  const comma = title.indexOf(", ");
  return comma > 2 ? title.slice(0, comma) : title;
}

/**
 * Sub-pixel differences are not clipping.
 *
 * Layout arithmetic lands fractionally either side of an edge all the time, and
 * a rail that scrolled a third of a pixel every time a card was chosen would be
 * the twitch this whole effect exists to remove.
 */
const TOLERANCE = 1;

/** A little air between a card and the controls, so they do not read as touching. */
const CONTROL_CLEARANCE = 8;

export function TrackerObservingRail({
  cards,
  expandedId,
  onExpand,
  onCollapse,
  onOpenDetail,
  factsFor,
  place,
  loading,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  /**
   * The rail publishes how tall it is, so the map's controls can sit above it.
   *
   * The controls used to clear the rail with a fixed offset, which was correct
   * for exactly one of the rail's two heights: expanding a card grew the rail
   * upwards and swallowed the zoom and locate buttons on a phone. A measured
   * height is the only version of this that stays true as cards open, close and
   * reflow, so the rail writes its own and the controls read it.
   */
  useEffect(() => {
    const node = rail.current;
    const shell = node?.closest<HTMLElement>(".tk-map-shell");
    if (!node || !shell) return;
    const publish = () => {
      shell.style.setProperty("--tk-rail-height", `${Math.round(node.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--tk-rail-height");
    };
  }, []);
  const expandedRef = useRef<HTMLLIElement>(null);

  /**
   * The rail moves only when it has to, and only as far as it has to.
   *
   * ## What this replaces
   *
   * Bringing the selected card to the front. That was right about the problem —
   * a card chosen from the middle of a phone's rail opened half off the edge —
   * and wrong about the fix: it scrolled on every selection, including the many
   * where the card was already entirely visible and the reader was looking
   * straight at it. Moving the rail under somebody who did not ask for it is
   * its own defect, and it is the more common one.
   *
   * So the rule is containment, not position. If the whole card is visible,
   * nothing happens. If part of it is not, the rail moves by exactly the
   * overflow and no further.
   *
   * ## Why it waits
   *
   * A card animates its width over 260 ms, and its neighbours move with it, so
   * the rectangle at the moment of the click is not the rectangle the reader
   * ends up looking at. Deciding from that one produced two wrong answers: a
   * scroll for a card that was about to fit anyway, and a correction aimed at
   * a position everything then slid away from. One measurement, after the
   * widths have stopped, is both simpler and the only one that is true.
   *
   * That means one scroll call rather than a first attempt and a correction
   * chasing it, which is what the competing smooth scrolls used to be.
   */
  useEffect(() => {
    const strip = scroller.current;
    const card = expandedRef.current;
    if (!expandedId || !strip || !card) return;

    /**
     * The part of the strip a card can actually be seen in.
     *
     * Not the strip's own box. The map's zoom and locate buttons float over its
     * right-hand end, and a card that reaches under them is not visible however
     * much of it is inside the scroller. The controls are found rather than
     * assumed, and only counted when they really do overlap the rail's band —
     * on a layout that puts them elsewhere the whole strip is usable.
     */
    const viewport = () => {
      const box = strip.getBoundingClientRect();
      const controls = document.querySelector<HTMLElement>(".tk-map-controls-view");
      const over = controls?.getBoundingClientRect();
      const overlaps =
        over !== undefined &&
        over.left < box.right &&
        over.right > box.left &&
        over.top < box.bottom &&
        over.bottom > box.top;
      return {
        left: box.left,
        right: overlaps ? Math.min(box.right, over!.left - CONTROL_CLEARANCE) : box.right,
      };
    };

    /**
     * How far the rail has to move, which is usually not at all.
     *
     * Positive scrolls the content left. The two clauses are exclusive by
     * construction: a card cannot overflow both edges unless it is wider than
     * the space it is being shown in, and in that case revealing the left edge
     * is the answer — the card reads from the left, and pulling its right edge
     * into view would push its name out of sight.
     */
    const overflow = () => {
      const view = viewport();
      const box = card.getBoundingClientRect();
      const usable = view.right - view.left;
      if (box.width > usable) return box.left - view.left;
      if (box.left < view.left - TOLERANCE) return box.left - view.left;
      if (box.right > view.right + TOLERANCE) return box.right - view.right;
      return 0;
    };

    const align = (behavior: ScrollBehavior) => {
      const delta = overflow();
      if (delta === 0) return false;
      // Clamped at both ends: a target past either bound is silently truncated
      // by the browser, and the verification below has to be able to tell the
      // difference between "we arrived" and "we asked for more than exists".
      const furthest = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const left = Math.min(Math.max(0, strip.scrollLeft + delta), furthest);
      if (Math.abs(strip.scrollLeft - left) < 1) return false;
      strip.scrollTo({ left, behavior });
      return true;
    };

    let done = false;
    let frame = 0;
    let check = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const settle = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      strip.removeEventListener("transitionend", onEnd);
      if (!align(reduced ? "auto" : "smooth")) return;
      /**
       * One verification, and no more.
       *
       * A smooth scroll can be interrupted — by a clamp at either end, or by a
       * reader who starts swiping while it runs — so the containment it was
       * asked for is not guaranteed to be the containment that happened. One
       * silent correction covers that. A loop would fight anybody scrolling by
       * hand, which is worse than a card an inch off the edge.
       */
      check = window.setTimeout(() => {
        frame = window.requestAnimationFrame(() => align("auto"));
      }, reduced ? 0 : 500);
    };

    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName === "width") settle();
    };
    strip.addEventListener("transitionend", onEnd);
    // Nothing transitions when nothing changed width — a card chosen with none
    // already open, or reduced motion — so the decision is not left waiting.
    const timer = window.setTimeout(settle, reduced ? 0 : 320);

    return () => {
      done = true;
      window.clearTimeout(timer);
      window.clearTimeout(check);
      window.cancelAnimationFrame(frame);
      strip.removeEventListener("transitionend", onEnd);
    };
  }, [expandedId]);

  if (loading) {
    return (
      <div className="tk-rail" aria-busy="true">
        <div className="tk-rail-scroll">
          <ul className="tk-rail-list">
            {[0, 1, 2].map((index) => (
              <li key={index} className="tk-rail-card is-loading" aria-hidden>
                <span className="tk-map-skeleton is-title" />
                <span className="tk-map-skeleton is-line" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (cards.length === 0) return null;

  return (
    <div className="tk-rail" ref={rail}>
      <p className="tk-visually-hidden" role="status" aria-live="polite">
        {`${cards.length} things to look for from ${place}`}
      </p>
      {/*
        The strip takes the pointer so it can be scrolled, and hands back what
        is not its own.

        It used to be transparent to the pointer entirely, so that a click
        beside a card reached the map and dismissed the card. That worked for
        the mouse and broke touch: a browser will not start a scroll gesture on
        an element that does not receive pointer events, so a swipe that began
        anywhere but exactly on a card did nothing at all — and with a card
        expanded there is very little "exactly on a card" left on a phone.

        So the strip is scrollable, and a click that lands on the strip rather
        than on a card runs the same dismissal contract the map runs. One
        contract, two entry points; nothing is trapped.
      */}
      <div
        className="tk-rail-scroll"
        ref={scroller}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest(".tk-rail-card")) return;
          dismissOpenSurfaces();
        }}
      >
        <ul className="tk-rail-list">
          {cards.map((card) => {
            const expanded = card.id === expandedId;
            const { when, where } = summaryOf(card);
            const facts = expanded ? factsFor(card) : null;
            return (
              <li
                key={card.id}
                ref={expanded ? expandedRef : undefined}
                className="tk-rail-card"
                data-expanded={expanded ? "true" : "false"}
                data-reason={card.reason}
                data-card={card.id}
              >
                <button
                  type="button"
                  className="tk-rail-card-head"
                  aria-expanded={expanded}
                  onClick={() => (expanded ? onCollapse() : onExpand(card.id))}
                >
                  {/* Never a blank square: `cardMediaFor` is total, so every
                      phenomenon resolves to a photograph, a drawing made from
                      its own numbers, or a deliberate mark. */}
                  <span className="tk-rail-card-image">
                    <CardFigure media={card.media} />
                  </span>
                  <span className="tk-rail-card-text">
                    <span className="tk-rail-card-name">
                      {expanded ? card.presentation.title : compactName(card.presentation.title)}
                    </span>
                    {/* Concrete facts, never a grade. What it is, when, and
                        which way to face is the whole of the compact card. */}
                    <span className="tk-rail-card-when">{when}</span>
                    <span className="tk-rail-card-where">{where}</span>
                  </span>
                  {expanded ? (
                    <X size={15} aria-hidden className="tk-rail-card-toggle" />
                  ) : (
                    <ChevronRight size={15} aria-hidden className="tk-rail-card-toggle" />
                  )}
                </button>

                {/* Rendered only when expanded, so the collapsed rail carries no
                    hidden layout that could reflow when it opens. */}
                {expanded && facts ? (
                  <div className="tk-rail-card-body">
                    {facts.note ? <p className="tk-rail-note">{facts.note}</p> : null}

                    {/* The event's own geography read at this point, above the
                        generic facts, because it is the reason this event is
                        drawn on the map at all. */}
                    {facts.event ? (
                      <div className="tk-map-event-reading">
                        <span className="tk-map-layer-label">{facts.event.label}</span>
                        <span className="tk-map-event-value">{facts.event.value}</span>
                        {facts.event.detail ? (
                          <span className="tk-map-layer-detail">{facts.event.detail}</span>
                        ) : null}
                        {facts.event.facts.length > 0 ? (
                          <ul className="tk-map-event-facts">
                            {facts.event.facts.map((fact) => (
                              <li key={fact.label}>
                                <span>{fact.label}</span>
                                <span>{fact.value}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}

                    {facts.facts.length > 0 ? (
                      <ul className="tk-rail-facts">
                        {facts.facts.map((fact) => (
                          <li key={fact.label}>
                            <span>{fact.label}</span>
                            <span>{fact.value}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {/* Terrain, phrased as terrain. Never "your view": a DEM is
                        bare earth and knows nothing about the trees. */}
                    {facts.terrainPending ? (
                      <p className="tk-rail-terrain is-pending">
                        <Mountain size={13} aria-hidden />
                        <span>Checking the terrain horizon…</span>
                      </p>
                    ) : facts.terrain ? (
                      <p className="tk-rail-terrain">
                        <Mountain size={13} aria-hidden />
                        <span>
                          <span className="tk-rail-terrain-head">{facts.terrain.headline}</span>
                          {facts.terrain.detail ? (
                            <span className="tk-rail-terrain-detail">{facts.terrain.detail}</span>
                          ) : null}
                        </span>
                      </p>
                    ) : null}

                    {facts.conditions.length > 0 ? (
                      <ul className="tk-rail-conditions">
                        {facts.conditions.map((condition) => (
                          <li key={condition.id} className={`is-${condition.tone}`}>
                            <span>{condition.label}</span>
                            <span>{condition.value}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <button
                      type="button"
                      className="tk-rail-details"
                      onClick={() => onOpenDetail(card.id)}
                    >
                      View full details
                      <ChevronRight size={14} aria-hidden />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
