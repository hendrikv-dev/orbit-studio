import { useMemo, useState, useCallback} from "react";
import { CalendarSearch, MapPin, Search, X } from "lucide-react";
import { type CatalogueEvent } from "../../../data/tracker/eventCatalogue";
import { searchEventsNear, type SearchPlace } from "../../../data/tracker/eventSearch";
import { useDismissableSurface } from "../../../data/tracker/dismissable";

/**
 * Finding a notable event by name instead of by date.
 *
 * ## Why this exists
 *
 * The date control is the right primary temporal control and a hopeless way to
 * *find* anything. Nobody knows when the next annular eclipse is — that is the
 * question, not the input — so the only way to reach one was to already know
 * the answer. Stepping a day at a time through eleven months to reach the
 * Perseids is not a workflow.
 *
 * ## Why it is not a second Upcoming
 *
 * It sets the date and selects the event, and then gets out of the way. There
 * is no browse, no calendar, no parallel list of destinations: the reader lands
 * on the map, on that date, with the event drawn on it, and the date control is
 * still the thing that says which night they are looking at.
 */

interface Props {
  /** The instant to search forward from. */
  from: Date;
  selected: CatalogueEvent | null;
  /** The reader's chosen coordinates, which is the only thing "here" means. */
  place: SearchPlace | null;
  onSelect: (event: CatalogueEvent) => void;
  onClear: () => void;
  /** Opens the existing place flow, for a local query with no place chosen. */
  onChoosePlace?: () => void;
}

/**
 * Offered before anything is typed, because a blank box teaches nothing.
 *
 * Two of the four say `here`, which is how the reader finds out the word does
 * anything at all. A feature nobody discovers is a feature nobody has.
 */
const SUGGESTIONS = [
  "Next solar eclipse",
  "Next solar eclipse here",
  "Next lunar eclipse visible here",
  "Perseids",
];

export function TrackerEventFinder({
  from,
  selected,
  place,
  onSelect,
  onClear,
  onChoosePlace,
}: Props) {
  const [open, setOpen] = useState(false);
  const closeSurface = useCallback(() => setOpen(false), []);
  // While this is open, a click on the map dismisses it rather than
  // moving the reader's observing location.
  useDismissableSurface(open, closeSurface);
  const [query, setQuery] = useState("");

  const search = useMemo(
    () => searchEventsNear(query, from, place, 8),
    [query, from, place],
  );
  const results = search.results;
  /** A local query with nowhere to be local to: the one case that needs asking. */
  const needsPlace = search.scope === "here" && !place;

  if (selected && !open) {
    return (
      <div className="tk-eventfinder is-selected">
        <button
          type="button"
          className="tk-eventfinder-current"
          aria-label={`Showing ${selected.title}. Choose a different event`}
          onClick={() => {
            setOpen(true);
            setQuery("");
          }}
        >
          <CalendarSearch size={14} aria-hidden />
          <span className="tk-eventfinder-current-name">{selected.title}</span>
        </button>
        <button
          type="button"
          className="tk-eventfinder-clear"
          onClick={onClear}
          aria-label={`Stop showing ${selected.title}`}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="tk-eventfinder">
      {open ? (
        <div className="tk-eventfinder-open">
          <div className="tk-eventfinder-field">
            <Search size={14} aria-hidden />
            <input
              autoFocus
              type="search"
              value={query}
              placeholder="Find an event"
              aria-label="Find a notable astronomical event"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
                if (event.key === "Enter" && results.length > 0) {
                  onSelect(results[0].event);
                  setOpen(false);
                  setQuery("");
                }
              }}
            />
            <button
              type="button"
              className="tk-icon-button"
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
              aria-label="Close event search"
            >
              <X size={14} aria-hidden />
            </button>
          </div>

          {query.trim().length === 0 ? (
            <ul className="tk-eventfinder-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" onClick={() => setQuery(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          ) : needsPlace ? (
            /* "Here" has to be somewhere. Rather than guessing from an IP
               address, this hands the reader back to the flow that already
               exists for choosing a place. */
            <div className="tk-eventfinder-needs-place">
              <p>Choose a place first, and “here” will mean that place.</p>
              {onChoosePlace ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onChoosePlace();
                  }}
                >
                  <MapPin size={13} aria-hidden />
                  Choose a place
                </button>
              ) : null}
            </div>
          ) : results.length === 0 ? (
            <p className="tk-eventfinder-empty">
              {search.exhausted
                ? /* Not "there is no such event". Totality returns to a given
                     town about once every three or four centuries, and the
                     catalogue looks forward four years — so the honest answer
                     names the limit rather than implying the sky is empty. */
                  "None visible from here within the four years this catalogue covers."
                : "Nothing matching in the next four years."}
            </p>
          ) : (
            <ul className="tk-eventfinder-results">
              {results.map((result) => (
                <li key={result.event.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(result.event);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="tk-eventfinder-title">{result.event.title}</span>
                    <span className="tk-eventfinder-when">{whenWords(result.event)}</span>
                    {/* What it does at the reader's own coordinates, which is
                        the fact that decides whether the row matters. */}
                    {result.local ? (
                      <span
                        className="tk-eventfinder-local"
                        data-visible={result.local.visible ? "true" : "false"}
                      >
                        {result.local.label}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="tk-eventfinder-trigger"
          // Named here rather than by the label, which the mobile layout hides:
          // a button whose only text is display:none has no accessible name at
          // all, and axe is right to call that critical.
          aria-label="Find a notable astronomical event"
          onClick={() => setOpen(true)}
        >
          <CalendarSearch size={15} aria-hidden />
          <span aria-hidden>Find an event</span>
        </button>
      )}
    </div>
  );
}

/** The date, and how far off it is, because both matter when choosing. */
function whenWords(event: CatalogueEvent): string {
  const at = new Date(event.atUtc);
  const date = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(at);
  const days = Math.round((at.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return date;
  if (days < 30) return `${date} · in ${days} days`;
  const months = Math.round(days / 30.4);
  return `${date} · in ${months} month${months === 1 ? "" : "s"}`;
}
