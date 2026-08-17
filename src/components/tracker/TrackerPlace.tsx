import { useEffect, useRef, useState } from "react";
import {
  geocoderFor,
  parseCoordinates,
  type PlaceResult,
} from "../../data/tracker/geocoding";
import {
  detectBrowser,
  permissionState,
  recoverySteps,
  requestPosition,
  type GeolocationOutcome,
  type GeolocationPhase,
} from "../../lib/geolocation";

/**
 * Choosing where you are standing, or where you are going.
 *
 * This is onboarding: for most readers it is the only thing between arriving
 * and being told what to look at, so every path through it has to end somewhere
 * the reader can act on.
 *
 * It previously did not. Two faults, both reproduced before being fixed:
 *
 * - A full street address returned "Nothing found", because the adapter kept
 *   only results with a `name` and a house has none. Fixed in `geocoding.ts`.
 * - "Use my current location" did nothing visible in a browser that had already
 *   blocked the site. Chrome does not re-prompt after a block, so the callback
 *   fired instantly, the state moved from denied to denied, and the button
 *   looked inert. Now the permission is checked before asking, every phase is
 *   rendered, and a block produces the steps for the browser in use.
 *
 * A chosen place is also confirmed before anything is computed from it. A
 * geocoder will happily return something near what was typed, and the reader is
 * the only one who can say whether it is the right place.
 */

export interface SelectedPlace {
  name: string;
  context: string;
  latitude: number;
  longitude: number;
  /** True where this came from the device rather than a search. */
  fromDevice: boolean;
  /** Reported accuracy in metres, for a device fix. */
  accuracyM?: number;
}

interface Props {
  place: SelectedPlace | null;
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

export function TrackerPlace({ place, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ phase: GeolocationPhase; outcome: GeolocationOutcome | null }>({
    phase: "idle",
    outcome: null,
  });
  const [blockedUpFront, setBlockedUpFront] = useState(false);
  /** A place chosen but not yet confirmed. Nothing is computed from it yet. */
  const [pending, setPending] = useState<SelectedPlace | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Whether asking can even produce a prompt, known before the button is
  // pressed, so a blocked browser can be told the truth rather than offered a
  // request that cannot happen.
  useEffect(() => {
    let cancelled = false;
    void permissionState().then((state) => {
      if (!cancelled) setBlockedUpFront(state === "denied");
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Debounced, because a geocoder that is free to use is still somebody's
  // server and a request per keystroke is not a reasonable way to treat it.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 || parseCoordinates(trimmed)) {
      setResults([]);
      setSearching(false);
      return;
    }
    const adapter = geocoderFor();
    if (!adapter) return;

    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      setSearchError(null);
      adapter
        .search(trimmed, controller.signal)
        .then((found) => {
          if (!controller.signal.aborted) setResults(found);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setSearchError(
            cause instanceof Error
              ? `Place search is not responding (${cause.message}).`
              : "Place search is not responding.",
          );
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

  const useCurrentLocation = async () => {
    setGeo({ phase: "idle", outcome: null });
    const outcome = await requestPosition((phase) =>
      setGeo((current) => ({ phase, outcome: current.outcome })),
    );
    setGeo({ phase: outcome.phase, outcome });
    setBlockedUpFront(outcome.phase === "denied");
    if (outcome.coords) {
      setPending({
        name: "Where you are",
        context: `Within about ${Math.round(outcome.coords.accuracyM)} m`,
        latitude: outcome.coords.latitude,
        longitude: outcome.coords.longitude,
        fromDevice: true,
        accuracyM: outcome.coords.accuracyM,
      });
    }
  };

  const confirm = (chosen: SelectedPlace) => {
    onSelect(chosen);
    setPending(null);
    setOpen(false);
    setQuery("");
    setResults([]);
    setGeo({ phase: "idle", outcome: null });
  };

  const pin = parseCoordinates(query.trim());
  const busy = geo.phase === "prompting" || geo.phase === "locating";

  return (
    <div className="tracker-place" ref={containerRef}>
      <button
        type="button"
        className="tracker-place-current"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <PinIcon />
        <span className="tracker-place-name">{place ? place.name : "Choose where you are"}</span>
        {place?.context ? <span className="tracker-place-context">{place.context}</span> : null}
        <ChevronIcon />
      </button>

      {open ? (
        <div className="tracker-place-panel">
          {pending ? (
            /* Nothing is computed until the reader agrees this is the place.
               A geocoder returns what is near what was typed, and only the
               reader knows whether that is where they will be standing. */
            <div className="tracker-place-confirm">
              <p className="tracker-place-confirm-lead">Use this place?</p>
              <p className="tracker-place-confirm-name">{pending.name}</p>
              <p className="tracker-place-confirm-context">
                {pending.context}
                {pending.context ? " · " : ""}
                {pending.latitude.toFixed(4)}, {pending.longitude.toFixed(4)}
              </p>
              <div className="tracker-place-confirm-actions">
                <button type="button" className="tracker-primary" onClick={() => confirm(pending)}>
                  Yes, use this
                </button>
                <button
                  type="button"
                  className="tracker-secondary"
                  onClick={() => setPending(null)}
                >
                  Choose another
                </button>
              </div>
            </div>
          ) : (
            <div className={blockedUpFront ? "tracker-place-body is-blocked" : "tracker-place-body"}>
              {/* When the browser has blocked the site, the search is the only
                  path that can work, so it goes first. Leading with a control
                  that cannot function — above three paragraphs explaining why —
                  is how the original made itself feel broken. */}
              <button
                type="button"
                className="tracker-place-device tracker-place-order-device"
                onClick={() => void useCurrentLocation()}
                disabled={busy}
              >
                <CrosshairIcon />
                {geo.phase === "prompting"
                  ? "Waiting for your browser…"
                  : geo.phase === "locating"
                    ? "Finding you…"
                    : blockedUpFront
                      ? "Location is blocked"
                      : "Use my current location"}
              </button>

              {/* Every outcome is rendered. The silence this replaces was the
                  whole of the reported fault. */}
              {geo.outcome && geo.phase !== "granted" ? (
                <div
                  className={`tracker-place-status tracker-place-status-${geo.phase}`}
                  role="status"
                >
                  <p>{geo.outcome.message}</p>
                  {geo.outcome.recovery ? (
                    <ol>
                      {geo.outcome.recovery.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  ) : null}
                  {geo.outcome.retryable ? (
                    <button type="button" onClick={() => void useCurrentLocation()}>
                      Try again
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* Known to be blocked before anything is pressed. */}
              {blockedUpFront && !geo.outcome ? (
                <div className="tracker-place-status tracker-place-status-denied" role="status">
                  <p>
                    Your browser is blocking location for this site, so it will not ask. You can
                    unblock it, or just search for a place below.
                  </p>
                  <ol>
                    {recoverySteps(detectBrowser()).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
              ) : null}

              <label className="tracker-place-search tracker-place-order-search">
                <SearchIcon />
                <input
                  type="search"
                  // Off, deliberately: the browser offers the reader's own saved
                  // postal address here, which is never the campsite they are
                  // searching for and reads as the app having guessed wrong.
                  autoComplete="off"
                  value={query}
                  placeholder="Address, campsite, park, trailhead, town…"
                  onChange={(event) => setQuery(event.target.value)}
                  autoFocus
                />
              </label>

              {pin ? (
                <button
                  type="button"
                  className="tracker-place-result"
                  onClick={() =>
                    setPending({
                      name: `${pin.latitude.toFixed(3)}, ${pin.longitude.toFixed(3)}`,
                      context: "Dropped pin",
                      latitude: pin.latitude,
                      longitude: pin.longitude,
                      fromDevice: false,
                    })
                  }
                >
                  <span className="tracker-place-result-name">
                    {pin.latitude.toFixed(3)}, {pin.longitude.toFixed(3)}
                  </span>
                  <span className="tracker-place-result-context">Use these coordinates</span>
                </button>
              ) : null}

              {searching ? <p className="tracker-place-note">Searching…</p> : null}
              {searchError ? <p className="tracker-place-note">{searchError}</p> : null}
              {!searching && !searchError && query.trim().length >= 3 && !pin && results.length === 0 ? (
                <p className="tracker-place-note">
                  No match for that. Try adding a town or postcode — or if you are somewhere with
                  no address at all, paste its latitude and longitude.
                </p>
              ) : null}

              {results.length > 0 ? (
                <p className="tracker-place-note tracker-place-count">
                  {results.length === 1 ? "One match" : `${results.length} close matches`} — pick
                  the right one:
                </p>
              ) : null}

              <ul className="tracker-place-results">
                {results.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      className="tracker-place-result"
                      onClick={() =>
                        setPending({
                          name: result.name,
                          context: result.context,
                          latitude: result.latitude,
                          longitude: result.longitude,
                          fromDevice: false,
                        })
                      }
                    >
                      <span className="tracker-place-result-name">
                        {result.name}
                        {result.kind && KIND_HINT[result.kind] ? (
                          <em>{KIND_HINT[result.kind]}</em>
                        ) : result.isAddress ? (
                          <em>Address</em>
                        ) : null}
                      </span>
                      <span className="tracker-place-result-context">{result.context}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
