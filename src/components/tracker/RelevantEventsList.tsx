import type { ReactNode } from "react";
import { ChevronRight, Clock } from "lucide-react";
import type { HeroImagery } from "../../data/tracker/imagery";
import type { EventPresentation } from "../../data/tracker/eventPresentation";
import { TrackerScene } from "./TrackerScene";

/**
 * The ranked list, as rows.
 *
 * Rows rather than cards, and rows rather than a table. A carousel would hide
 * the ranking behind a scroll; large cards would make five things look like
 * five equally important things; a dense analytics table would turn a decision
 * into a spreadsheet. What is left is the shape that says "these are ordered,
 * the top one is the answer, the rest are alternatives" without any of them
 * competing with the hero above.
 *
 * Each row carries only what a person scanning needs: where it sits in the
 * order, what it looks like, what it is, what state it is in, when to be
 * outside, and how good the view will be. Everything else is one click away by
 * selecting it, which swaps the hero rather than opening a new page.
 */

export interface RelevantEventRow {
  presentation: EventPresentation;
  /** A photograph, where one honestly depicts this event. */
  imagery: HeroImagery | null;
  /**
   * A drawing, for the events with no photograph.
   *
   * Aurora and solar eclipses have no rights-cleared photograph in the set, and
   * substituting a starfield put a picture of an ordinary night beside the words
   * "68% partial solar eclipse". A small drawing of the actual event is both
   * honest and more informative than a stock frame.
   */
  thumb?: ReactNode;
  /**
   * The Moon's actual phase, for the one image that is composited.
   *
   * Defaulted to a half Moon once, which put a half-lit disc on a row reading
   * "The Full Moon". A picture that contradicts its own label is worse than no
   * picture, and the thumbnail is no more exempt from that than the hero.
   */
  illuminatedFraction?: number;
  waning?: boolean;
  /** True for the event currently held by the hero. */
  active: boolean;
}

export function RelevantEventsList({
  rows,
  onSelect,
  heading = "Relevant near you",
  caption = "Sorted by time, visibility, and your location.",
}: {
  rows: RelevantEventRow[];
  onSelect: (id: string) => void;
  heading?: string;
  caption?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="tk-relevant" id="tracker-more" aria-label={heading}>
      <div className="tk-relevant-head">
        <h2>{heading}</h2>
        <p>{caption}</p>
      </div>
      <ol className="tk-relevant-list">
        {rows.map((row, index) => (
          <li key={row.presentation.id}>
            <button
              type="button"
              className="tk-relevant-row"
              aria-current={row.active ? "true" : undefined}
              onClick={() => onSelect(row.presentation.id)}
            >
              <span className="tk-relevant-rank">{index + 1}</span>
              <span className="tk-relevant-thumb">
                {row.imagery ? (
                  <TrackerScene
                    imagery={row.imagery}
                    className="tk-relevant-scene"
                    illuminatedFraction={row.illuminatedFraction ?? 0.5}
                    waning={row.waning ?? false}
                  />
                ) : (
                  row.thumb
                )}
              </span>
              <span className="tk-relevant-name">{row.presentation.title}</span>
              <span className="tk-relevant-state">
                <i className={`tk-relevant-dot is-${row.presentation.row.quality.tone}`} aria-hidden />
                {row.presentation.row.state}
              </span>
              <span className="tk-relevant-window">
                <Clock size={14} aria-hidden />
                {row.presentation.row.window}
              </span>
              <span className={`tk-relevant-quality is-${row.presentation.row.quality.tone}`}>
                {row.presentation.row.quality.value}
              </span>
              <ChevronRight size={16} aria-hidden className="tk-relevant-chevron" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
