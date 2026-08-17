import { useEffect, useMemo, useState } from "react";
import {
  Button,
  ComboBox,
  DialogTrigger,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Dialog,
  Text,
} from "react-aria-components";
import { Crosshair, MapPin, Search, ChevronDown } from "lucide-react";
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
 * Built on React Aria rather than by hand, because the hand-built version was
 * not operable without a mouse. An audit of it found: no combobox role, no
 * accessible name (the placeholder was doing that job, which it cannot), no
 * `aria-expanded` or `aria-activedescendant`, results appearing with no live
 * region to announce them, no arrow-key navigation, and Escape doing nothing.
 * This is onboarding — for a keyboard or screen-reader user it was the entire
 * product, and it did not work.
 *
 * React Aria's `ComboBox` supplies all of that, and its `Popover` positions
 * itself against the viewport. That second part removes a bug rather than a
 * risk: the panel used to open downward from a trigger low in the hero and put
 * its own results below the fold, and the fix for it was a hardcoded "open
 * upward on the welcome screen" that would have broken again at the next
 * viewport size.
 *
 * What stays bespoke is the part that is actually about this product: the
 * geolocation state machine, the address-aware ranking, and the confirmation
 * step. Nothing is computed from a place until the reader agrees it is the
 * right one.
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
  /** The welcome screen renders a larger, primary-styled trigger. */
  prominent?: boolean;
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

export function TrackerPlace({ place, onSelect, prominent = false }: Props) {
  return (
    <DialogTrigger>
      <Button
        className={
          prominent
            ? "tracker-place-current tracker-place-current-prominent"
            : "tracker-place-current"
        }
      >
        <MapPin size={15} aria-hidden />
        <span className="tracker-place-name">{place ? place.name : "Choose where you are"}</span>
        {place?.context ? <span className="tracker-place-context">{place.context}</span> : null}
        <ChevronDown size={15} aria-hidden className="tracker-place-chevron" />
      </Button>
      {/* Popover measures the space available and sets its own max-height, so
          the panel must not carry a taller one of its own — that override was
          what let the contents spill back out of it.
          The prominent trigger sits low in the hero by design, so it opens
          upward from the start rather than relying on a flip. */}
      <Popover
        className="tracker-place-popover"
        placement={prominent ? "top start" : "bottom end"}
        offset={8}
      >
        <Dialog className="tracker-place-panel" aria-label="Choose where you are">
          {({ close }) => <PlacePanel onSelect={onSelect} close={close} />}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

function PlacePanel({
  onSelect,
  close,
}: {
  onSelect: (place: SelectedPlace) => void;
  close: () => void;
}) {
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
  }, []);

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

  const pin = parseCoordinates(query.trim());
  const busy = geo.phase === "prompting" || geo.phase === "locating";

  // A coordinate pair is offered as an ordinary option, so one list and one set
  // of arrow keys covers every way of naming a place.
  const options = useMemo(() => {
    if (pin) {
      return [
        {
          id: "pin",
          name: `${pin.latitude.toFixed(3)}, ${pin.longitude.toFixed(3)}`,
          context: "Use these coordinates",
          latitude: pin.latitude,
          longitude: pin.longitude,
          kind: null,
          isAddress: false,
        } satisfies PlaceResult,
      ];
    }
    return results;
  }, [pin, results]);

  if (pending) {
    return (
      /* Nothing is computed until the reader agrees this is the place. A
         geocoder returns what is near what was typed, and only the reader knows
         whether that is where they will be standing. */
      <div className="tracker-place-confirm">
        <p className="tracker-place-confirm-lead">Use this place?</p>
        <p className="tracker-place-confirm-name">{pending.name}</p>
        <p className="tracker-place-confirm-context">
          {pending.context}
          {pending.context ? " · " : ""}
          {pending.latitude.toFixed(4)}, {pending.longitude.toFixed(4)}
        </p>
        <div className="tracker-place-confirm-actions">
          {/* `autoFocus` rather than a ref and an effect: focusing the node
              directly took it outside React Aria's focus scope, and Escape then
              dropped focus onto the body instead of returning it to the
              trigger. */}
          <Button
            autoFocus
            className="tracker-primary"
            onPress={() => {
              onSelect(pending);
              close();
            }}
          >
            Yes, use this
          </Button>
          <Button className="tracker-secondary" onPress={() => setPending(null)}>
            Choose another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={blockedUpFront ? "tracker-place-body is-blocked" : "tracker-place-body"}>
      {/* When the browser has blocked the site, the search is the only path
          that can work, so it is ordered first. Leading with a control that
          cannot function — above three paragraphs explaining why — is what made
          the original feel broken. */}
      <Button
        className="tracker-place-device tracker-place-order-device"
        onPress={() => void useCurrentLocation()}
        isDisabled={busy}
      >
        <Crosshair size={15} aria-hidden />
        {geo.phase === "prompting"
          ? "Waiting for your browser…"
          : geo.phase === "locating"
            ? "Finding you…"
            : blockedUpFront
              ? "Location is blocked"
              : "Use my current location"}
      </Button>

      {geo.outcome && geo.phase !== "granted" ? (
        <div className={`tracker-place-status tracker-place-status-${geo.phase}`} role="status">
          <p>{geo.outcome.message}</p>
          {geo.outcome.recovery ? (
            <ol>
              {geo.outcome.recovery.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          {geo.outcome.retryable ? (
            <Button onPress={() => void useCurrentLocation()}>Try again</Button>
          ) : null}
        </div>
      ) : null}

      {blockedUpFront && !geo.outcome ? (
        <div className="tracker-place-status tracker-place-status-denied" role="status">
          <p>
            Your browser is blocking location for this site, so it will not ask. You can unblock
            it, or just search for a place below.
          </p>
          <ol>
            {recoverySteps(detectBrowser()).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <ComboBox
        className="tracker-place-combobox tracker-place-order-search"
        items={options}
        inputValue={query}
        onInputChange={setQuery}
        allowsEmptyCollection
        menuTrigger="focus"
        onSelectionChange={(key) => {
          const chosen = options.find((entry) => entry.id === key);
          if (!chosen) return;
          setPending({
            name: chosen.name,
            context: chosen.context,
            latitude: chosen.latitude,
            longitude: chosen.longitude,
            fromDevice: false,
          });
        }}
      >
        {/* A real label. The placeholder was doing this job before, which it
            cannot: it disappears on the first keystroke and is not a name. */}
        <Label className="tracker-visually-hidden">Search for a place to observe from</Label>
        <div className="tracker-place-search">
          <Search size={15} aria-hidden />
          {/* Focused on open. Without it the dialog itself took focus, so the
              first thing typed went nowhere and a keyboard user had to tab past
              the location button to reach the field they came for. */}
          <Input
            autoFocus
            placeholder="Address, campsite, park, trailhead, town…"
            autoComplete="off"
          />
        </div>
        <Text slot="description" className="tracker-visually-hidden">
          Type at least three characters, or paste a latitude and longitude.
        </Text>

        {/* Announced by the combobox itself as the collection changes. */}
        <ListBox className="tracker-place-results" renderEmptyState={() => null}>
          {(item: PlaceResult) => (
            <ListBoxItem
              id={item.id}
              textValue={`${item.name}, ${item.context}`}
              className="tracker-place-result"
            >
              <span className="tracker-place-result-name">
                {item.name}
                {item.kind && KIND_HINT[item.kind] ? (
                  <em>{KIND_HINT[item.kind]}</em>
                ) : item.isAddress ? (
                  <em>Address</em>
                ) : null}
              </span>
              <span className="tracker-place-result-context">{item.context}</span>
            </ListBoxItem>
          )}
        </ListBox>
      </ComboBox>

      {/* Status messages live outside the listbox so they are announced as
          status rather than offered as options. */}
      <div className="tracker-place-messages" role="status" aria-live="polite">
        {searching ? <p className="tracker-place-note">Searching…</p> : null}
        {searchError ? <p className="tracker-place-note">{searchError}</p> : null}
        {!searching && !searchError && query.trim().length >= 3 && !pin && results.length === 0 ? (
          <p className="tracker-place-note">
            No match for that. Try adding a town or postcode — or if you are somewhere with no
            address at all, paste its latitude and longitude.
          </p>
        ) : null}
        {options.length > 0 && !pin ? (
          <p className="tracker-place-note tracker-place-count">
            {options.length === 1 ? "One match" : `${options.length} close matches`} — pick the
            right one.
          </p>
        ) : null}
      </div>
    </div>
  );
}
