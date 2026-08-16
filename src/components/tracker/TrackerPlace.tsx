import { useEffect, useRef, useState } from "react";
import {
  geocoderFor,
  parseCoordinates,
  type PlaceResult,
} from "../../data/tracker/geocoding";

/**
 * Choosing where you are standing, or where you are going.
 *
 * The rebuild removed the latitude and longitude boxes, the UTC date control
 * and the row of test cities. None of them belonged in front of somebody
 * deciding whether to go outside: they were a developer's controls left where
 * the product should have been.
 *
 * What replaces them is the contract: current location after permission, a
 * single search that finds campgrounds and trailheads as readily as cities, and
 * a coordinate pin as the fallback for somewhere too remote to be in any
 * database. A place chosen by hand stays chosen — nothing here silently returns
 * to the device's location, because someone planning a trip to a dark-sky site
 * would lose their plan the moment the page re-rendered.
 */

export interface SelectedPlace {
  name: string;
  context: string;
  latitude: number;
  longitude: number;
  /** True where this came from the device rather than a search. */
  fromDevice: boolean;
}

interface Props {
  place: SelectedPlace | null;
  locating: boolean;
  permissionDenied: boolean;
  onUseCurrentLocation: () => void;
  onSelect: (place: SelectedPlace) => void;
}

const KIND_HINT: Record<string, string> = {
  camp_site: "Campsite",
  caravan_site: "Campsite",
  wilderness_hut: "Hut",
  park: "Park",
  national_park: "National park",
  nature_reserve: "Reserve",
  protected_area: "Protected area",
  peak: "Summit",
  viewpoint: "Viewpoint",
  trailhead: "Trailhead",
};

export function TrackerPlace({
  place,
  locating,
  permissionDenied,
  onUseCurrentLocation,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced, because a geocoder that is free to use is still somebody's
  // server and a request per keystroke is not a reasonable way to treat it.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      return;
    }
    const pin = parseCoordinates(trimmed);
    if (pin) {
      setResults([]);
      return;
    }
    const adapter = geocoderFor();
    if (!adapter) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setError(null);
      adapter
        .search(trimmed, controller.signal)
        .then((found) => setResults(found))
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Search failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const pin = parseCoordinates(query.trim());

  return (
    <div className="tracker-place" ref={containerRef}>
      <button
        type="button"
        className="tracker-place-current"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <PinIcon />
        <span className="tracker-place-name">
          {locating
            ? "Finding you…"
            : place
              ? place.name
              : "Choose where you are"}
        </span>
        {place?.context ? <span className="tracker-place-context">{place.context}</span> : null}
        <ChevronIcon />
      </button>

      {open ? (
        <div className="tracker-place-panel">
          <button
            type="button"
            className="tracker-place-device"
            onClick={() => {
              onUseCurrentLocation();
              setOpen(false);
            }}
          >
            <CrosshairIcon />
            Use my current location
          </button>
          {permissionDenied ? (
            <p className="tracker-place-note">
              Location is blocked in your browser. Search for a place instead.
            </p>
          ) : null}

          <label className="tracker-place-search">
            <SearchIcon />
            <input
              type="search"
              // Off, deliberately: the browser offers the reader's own saved
              // postal address here, which is never the campsite they are
              // searching for and reads as the app having guessed wrong.
              autoComplete="off"
              value={query}
              placeholder="Campsite, park, trailhead, town…"
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
          </label>

          {pin ? (
            <button
              type="button"
              className="tracker-place-result"
              onClick={() => {
                onSelect({
                  name: `${pin.latitude.toFixed(3)}, ${pin.longitude.toFixed(3)}`,
                  context: "Dropped pin",
                  latitude: pin.latitude,
                  longitude: pin.longitude,
                  fromDevice: false,
                });
                setOpen(false);
                setQuery("");
              }}
            >
              <span className="tracker-place-result-name">
                {pin.latitude.toFixed(3)}, {pin.longitude.toFixed(3)}
              </span>
              <span className="tracker-place-result-context">
                Use these coordinates
              </span>
            </button>
          ) : null}

          {searching ? <p className="tracker-place-note">Searching…</p> : null}
          {error ? <p className="tracker-place-note">{error}</p> : null}
          {!searching && !error && query.trim().length >= 3 && !pin && results.length === 0 ? (
            <p className="tracker-place-note">
              Nothing found. Somewhere really remote? Paste its latitude and longitude.
            </p>
          ) : null}

          <ul className="tracker-place-results">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  className="tracker-place-result"
                  onClick={() => {
                    onSelect({
                      name: result.name,
                      context: result.context,
                      latitude: result.latitude,
                      longitude: result.longitude,
                      fromDevice: false,
                    });
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="tracker-place-result-name">
                    {result.name}
                    {result.kind && KIND_HINT[result.kind] ? (
                      <em>{KIND_HINT[result.kind]}</em>
                    ) : null}
                  </span>
                  <span className="tracker-place-result-context">{result.context}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const iconProps = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function PinIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg {...iconProps} className="tracker-place-chevron">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CrosshairIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}
