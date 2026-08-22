import { ChevronRight } from "lucide-react";
import { heroImageryFor } from "../../data/tracker/imagery";
import { categoryOf } from "../../data/tracker/eventCategories";
import type { PhenomenonCategoryId } from "../../data/tracker/phenomenonCategories";
import type { UpcomingEvent } from "../../data/tracker/upcomingEvents";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import type { SelectedPlace } from "./TrackerPlace";
import { TrackerScene } from "./TrackerScene";
import { TrackerAuroraArt } from "./viz/TrackerAuroraArt";
import { TrackerEclipseArt } from "./viz/TrackerEclipseArt";

/**
 * Upcoming as a gallery of dates.
 *
 * This replaces a single featured event with a strip of alternatives beneath
 * it. The feature layout was answering a question nobody asked — "which one
 * future event is most significant" — while making the actual question, "what
 * is coming up and when", require clicking through a strip to find out.
 *
 * A month has a handful of dates worth moving something for. Showing all of
 * them at once, in date order, is the whole job. Choosing one opens the
 * universal event page rather than expanding a panel here, so a future eclipse
 * gets exactly the same treatment as tonight's meteor shower.
 *
 * Ordering is chronological and the heading says so. The significance judgement
 * has already been applied — it decided what is *on* this list — and applying
 * it twice, once to membership and once to order, produced a diary you could
 * not read forwards.
 */

interface Props {
  events: UpcomingEvent[];
  place: SelectedPlace;
  clock: PlaceClock;
  onSelect: (id: string) => void;
  /** Which filter produced this list, so an empty one can explain itself. */
  category?: PhenomenonCategoryId;
  /** Route out of an empty list, to the view that can answer. */
  onGoTonight?: () => void;
}

function dateParts(dateKey: string): { day: string; month: string; year: string | null } {
  const [year, month, day] = dateKey.split("-").map(Number);
  const at = new Date(year, month - 1, day);
  return {
    day: new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(at),
    month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(at).toUpperCase(),
    // Shown only when it is not this year. Most of this list is the next few
    // weeks; an eclipse two years out looked like next Tuesday without it.
    year: year === new Date().getFullYear() ? null : String(year),
  };
}

/**
 * The card's picture.
 *
 * Null where no photograph honestly depicts the event: a solar eclipse and an
 * aurora both get a drawing instead. The lunar-eclipse photograph is a picture
 * of a *lunar* eclipse and must never stand in for a solar one.
 */
function imageryFor(event: UpcomingEvent) {
  if (event.kind === "solar-eclipse" || event.kind === "aurora") return null;
  return heroImageryFor(event.notable.entry.opportunity.id, event.notable.entry.opportunity.kind);
}

export function TrackerHighlights({ events, place, clock, category, onSelect, onGoTonight }: Props) {
  if (events.length === 0) {
    /**
     * An empty filter is not the same statement for every phenomenon.
     *
     * For aurora it is a statement about the *forecast horizon*, not about
     * aurora: nobody can name a night three weeks out, so an empty diary is the
     * correct and permanent answer rather than a failure. Saying only "nothing
     * to put in the diary" let that read as "Tracker cannot show auroras",
     * which is false and left the reader at a dead end — the current state was
     * a click away in Tonight and nothing said so.
     */
    const aurora = category === "auroras";
    return (
      <div className="tk-highlights tk-highlights-empty" data-planning-state="ready">
        <h2 className="tk-display">
          {aurora ? "Auroras cannot be diarised" : "Nothing to put in the diary"}
        </h2>
        <p className="tk-view-lede">
          {aurora ? (
            <>
              Useful aurora forecasting reaches about three days, and the nowcast that
              says where the oval actually is runs about half an hour ahead. Nothing
              honest can be written in a diary beyond that, so this list stays empty
              until a storm is close enough to forecast. What can be answered is
              tonight.
            </>
          ) : (
            <>
              No eclipse, shower peak or close pairing falls in the next month from{" "}
              {place.name}, and no geomagnetic storm is forecast inside the three days
              anybody can forecast. Tonight is still worth checking.
            </>
          )}
        </p>
        {onGoTonight ? (
          <button type="button" className="tk-action is-primary" onClick={onGoTonight}>
            {aurora ? "Aurora conditions tonight" : "See tonight"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tk-highlights" data-planning-state="ready">
      <ol className="tk-upcoming-gallery">
        {events.map((event) => {
          const parts = dateParts(event.dateKey);
          const category = categoryOf(event.category);
          const imagery = imageryFor(event);
          return (
            <li key={event.id}>
              <button
                type="button"
                className="tk-upcoming-card"
                data-tone={category.tone}
                onClick={() => onSelect(event.id)}
              >
                <span className="tk-upcoming-card-media">
                  {imagery ? (
                    <TrackerScene
                      imagery={imagery}
                      className="tk-upcoming-card-scene"
                      illuminatedFraction={
                        event.kind === "notable"
                          ? event.notable.entry.opportunity.sceneHints?.illuminatedFraction ?? 0.5
                          : 0.5
                      }
                      waning={
                        event.kind === "notable"
                          ? event.notable.entry.opportunity.sceneHints?.waning ?? false
                          : false
                      }
                    />
                  ) : event.kind === "solar-eclipse" ? (
                    <TrackerEclipseArt
                      obscurationFraction={event.local.obscurationFraction}
                      kind={event.local.kind}
                    />
                  ) : (
                    <TrackerAuroraArt probabilityPercent={null} />
                  )}
                  <span className="tk-upcoming-card-date">
                    <b>{parts.month}</b>
                    <i>{parts.day}</i>
                    {parts.year ? <u>{parts.year}</u> : null}
                  </span>
                </span>
                <span className="tk-upcoming-card-body">
                  <span className="tk-upcoming-card-kind">{event.label}</span>
                  <span className="tk-upcoming-card-name">{event.title}</span>
                  <span className="tk-upcoming-card-why">{event.reason}</span>
                  <span className="tk-upcoming-card-foot">
                    {formatClockTime(event.atUtc, clock)}
                    <ChevronRight size={15} aria-hidden />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
