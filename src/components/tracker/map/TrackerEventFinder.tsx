import { useMemo, useState, useCallback} from "react";
import { CalendarSearch, Search, X } from "lucide-react";
import { searchEvents, type CatalogueEvent } from "../../../data/tracker/eventCatalogue";
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
  onSelect: (event: CatalogueEvent) => void;
  onClear: () => void;
}

/** Offered before anything is typed, because a blank box teaches nothing. */
const SUGGESTIONS = ["Next solar eclipse", "Next lunar eclipse", "Perseids", "Geminids"];

export function TrackerEventFinder({ from, selected, onSelect, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const closeSurface = useCallback(() => setOpen(false), []);
  // While this is open, a click on the map dismisses it rather than
  // moving the reader's observing location.
  useDismissableSurface(open, closeSurface);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    if (query.trim().length === 0) return [];
    return searchEvents(query, from, 8);
  }, [query, from]);

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
                  onSelect(results[0]);
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
          ) : results.length === 0 ? (
            <p className="tk-eventfinder-empty">
              Nothing matching in the next four years.
            </p>
          ) : (
            <ul className="tk-eventfinder-results">
              {results.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(event);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="tk-eventfinder-title">{event.title}</span>
                    <span className="tk-eventfinder-when">{whenWords(event)}</span>
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
