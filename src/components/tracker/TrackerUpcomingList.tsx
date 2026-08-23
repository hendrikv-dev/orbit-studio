import { ChevronRight } from "lucide-react";
import { categoryOf } from "../../data/tracker/eventCategories";
import type { UpcomingEvent } from "../../data/tracker/upcomingEvents";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import type { SelectedPlace } from "./TrackerPlace";

/**
 * Upcoming as an actual list.
 *
 * ## Why this exists
 *
 * The mode control offered "List | Calendar" and what it called List was a grid
 * of picture cards — a gallery. That is a fine way to browse and a poor way to
 * scan: eight cards fill a screen, so a month of events cannot be taken in at
 * once, and the thing a list is *for* is exactly that.
 *
 * So there are three modes now, and this is the one that trades the pictures
 * for density. Same events, same filters, same underlying set — a different
 * question being asked of it.
 *
 * ## What earns a column
 *
 * Only what someone scanning a month is deciding between: when it is, what it
 * is, what kind of thing it is, what the night is worth, and one line on why it
 * matters. No thumbnails, because a 40-pixel photograph of a conjunction tells
 * nobody anything and costs a row a third of its height.
 *
 * The time is always labelled. "9:12 PM" alone could be maximum eclipse, an
 * exact phase, or the start of a window, and in a dense list — where the
 * surrounding copy is shortest — that ambiguity is at its worst.
 */

interface Props {
  events: UpcomingEvent[];
  place: SelectedPlace;
  clock: PlaceClock;
  onSelect: (id: string) => void;
}

function dayLabel(dateKey: string): { weekday: string; day: string; month: string } {
  const [year, month, day] = dateKey.split("-").map(Number);
  const at = new Date(year, month - 1, day);
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(at),
    day: new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(at),
    month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(at),
  };
}

/** The quality reading, where the event carries one worth showing. */
function qualityOf(event: UpcomingEvent): { value: string; tone: string } | null {
  if (event.kind !== "notable") return null;
  const quality = event.notable.entry.opportunity.qualities;
  // The phenomenon's own band, not the weather — the weather this far out is
  // usually unknown, and a list of "Not known" helps nobody.
  const strength = quality.observability * quality.spectacle;
  if (strength >= 0.45) return { value: "Excellent", tone: "good" };
  if (strength >= 0.25) return { value: "Good", tone: "good" };
  if (strength >= 0.12) return { value: "Fair", tone: "fair" };
  return { value: "Marginal", tone: "unknown" };
}

export function TrackerUpcomingList({ events, place, clock, onSelect }: Props) {
  if (events.length === 0) return null;

  return (
    <div className="tk-uplist" data-planning-state="ready">
      <table className="tk-uplist-table">
        <caption className="tk-uplist-caption">
          Everything worth planning for from {place.name}, soonest first.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Event</th>
            <th scope="col">Kind</th>
            <th scope="col">When</th>
            <th scope="col">Worth it</th>
            <th scope="col">
              <span className="tk-visually-hidden">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const day = dayLabel(event.dateKey);
            const category = categoryOf(event.category);
            const quality = qualityOf(event);
            return (
              <tr key={event.id} data-tone={category.tone}>
                <th scope="row" className="tk-uplist-date">
                  <span className="tk-uplist-weekday">{day.weekday}</span>
                  <span className="tk-uplist-day">{day.day}</span>
                  <span className="tk-uplist-month">{day.month}</span>
                </th>
                <td className="tk-uplist-name">
                  <button type="button" onClick={() => onSelect(event.id)}>
                    {event.title}
                  </button>
                  <span className="tk-uplist-why">{event.reason}</span>
                </td>
                <td className="tk-uplist-kind">
                  <span data-tone={category.tone}>{event.label}</span>
                </td>
                <td className="tk-uplist-when">
                  {/* Labelled, always. */}
                  <span className="tk-uplist-when-label">{event.timing.label}</span>{" "}
                  {event.timing.text ?? formatClockTime(event.timing.atUtc, clock)}
                </td>
                <td className={`tk-uplist-quality is-${quality?.tone ?? "unknown"}`}>
                  {quality?.value ?? "—"}
                </td>
                <td className="tk-uplist-go">
                  <ChevronRight size={15} aria-hidden />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
