import { useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Button,
  ComboBox,
  ComboBoxStateContext,
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
 * geolocation state machine and the address-aware ranking
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
  /** True when restored from the browser's local confirmed-place record. */
  restored?: boolean;
}

interface Props {
  place: SelectedPlace | null;
  onSelect: (place: SelectedPlace) => void;
  /**
   * The trigger, so another control can send the reader here.
   *
   * A local event search — "next eclipse visible here" — needs a place before
   * it means anything, and the right answer to having none is this flow rather
   * than a second copy of it or a guess from an IP address.
   */
  triggerRef?: RefObject<HTMLButtonElement>;
  /**
   * `bar` is the compact trigger that opens a popover, used once a place is
   * chosen. `inline` is the entry state's own control: the same panel, rendered
   * open and in the page.
   *
   * The entry screen used to open the popover variant, which meant the expanded
   * panel floated over the composition it was supposed to be part of, and a
   * second copy of the same control sat in the bar behind it. Inline removes
   * both problems: nothing overlaps, because nothing is layered.
   */
  variant?: "bar" | "inline";
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

/** Closes the actual React Aria combobox state before native Tab advances
 * focus. Keeping this inside the ComboBox context avoids a second, competing
 * open-state owner in Tracker. */
function PlaceSearchInput({ autoFocus }: { autoFocus: boolean }) {
  const state = useContext(ComboBoxStateContext);
  return (
    <Input
      autoFocus={autoFocus}
      placeholder="Address, campsite, park, trailhead, town…"
      autoComplete="off"
      onKeyDownCapture={(event) => {
        // Mark focus gone as well as closing. With menuTrigger="focus", merely
        // calling close while the key event still owns focus causes the
        // combobox effect to reopen before the browser advances Tab.
        if (event.key === "Tab") state?.setFocused(false);
      }}
    />
  );
}

export function TrackerPlace({ place, onSelect, variant = "bar", triggerRef }: Props) {
  if (variant === "inline") {
    return (
      <div className="tk-locate">
        <PlacePanel onSelect={onSelect} close={() => {}} inline />
      </div>
    );
  }

  return (
    <DialogTrigger>
      <Button
        ref={triggerRef}
        className="tracker-place-current"
        data-location-authority="confirmed"
      >
        <MapPin size={15} aria-hidden />
        <span className="tracker-place-name">{place ? place.name : "Choose where you are"}</span>
        {place?.context ? <span className="tracker-place-context">{place.context}</span> : null}
        {/* "Restored" used to sit here. It described where the value came from
            inside the application — a local record rather than a fresh pick —
            which is a fact about storage and not about the observer's night.
            Whether the place is right is answered by its name being right; how
            it got into the field is not the reader's problem. The record is
            still flagged internally, and the privacy panel still explains that
            a confirmed place is kept in this browser. */}
        <ChevronDown size={15} aria-hidden className="tracker-place-chevron" />
      </Button>
      {/* Popover measures the space available and sets its own max-height, so
          the panel must not carry a taller one of its own — that override was
          what let the contents spill back out of it. */}
      <Popover className="tracker-place-popover" placement="bottom end" offset={8}>
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
  inline = false,
}: {
  onSelect: (place: SelectedPlace) => void;
  close: () => void;
  /** Rendered in the page rather than in a popover. */
  inline?: boolean;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const searchVersion = useRef(0);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ phase: GeolocationPhase; outcome: GeolocationOutcome | null }>({
    phase: "idle",
    outcome: null,
  });
  const [blockedUpFront, setBlockedUpFront] = useState(false);

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
    const version = ++searchVersion.current;
    const trimmed = query.trim();
    setResults([]);
    setSearchError(null);
    if (trimmed.length < 3 || parseCoordinates(trimmed)) {
      setSearching(false);
      return;
    }
    const adapter = geocoderFor();
    if (!adapter) {
      setSearching(false);
      setSearchError("Place search is not supported here.");
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      setSearchError(null);
      adapter
        .search(trimmed, controller.signal)
        .then((found) => {
          if (!controller.signal.aborted && version === searchVersion.current) setResults(found);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || version !== searchVersion.current) return;
          setSearchError(
            cause instanceof Error
              ? `Place search is not responding (${cause.message}).`
              : "Place search is not responding.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted && version === searchVersion.current) setSearching(false);
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
      onSelect({
        name: "Where you are",
        context: `Within about ${Math.round(outcome.coords.accuracyM)} m`,
        latitude: outcome.coords.latitude,
        longitude: outcome.coords.longitude,
        fromDevice: true,
        accuracyM: outcome.coords.accuracyM,
      });
      close();
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
          name: "Where you are",
          context: "Use these coordinates",
          latitude: pin.latitude,
          longitude: pin.longitude,
          kind: null,
          isAddress: false,
          matchPrecision: "place",
        } satisfies PlaceResult,
      ];
    }
    return results;
  }, [pin, results]);


  const resultList = (
    <ListBox<PlaceResult> className="tracker-place-results" renderEmptyState={() => null}>
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
            ) : item.matchPrecision === "exact-address" ? (
              <em>Exact address</em>
            ) : null}
          </span>
          <span className="tracker-place-result-context">{item.context}</span>
        </ListBoxItem>
      )}
    </ListBox>
  );

  return (
    <div
      className={[
        "tracker-place-body",
        blockedUpFront ? "is-blocked" : "",
        inline ? "is-inline" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-search-state={
        searching
          ? "querying"
          : searchError
            ? "failed"
            : query.trim().length < 3
              ? "idle"
              : options.length > 0
                ? "results"
                : "no-results"
      }
    >
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

      {/* The phase composes the class, so the full set is named here as well as
          in the stylesheet: tracker-place-status-denied,
          tracker-place-status-timeout, tracker-place-status-unavailable,
          tracker-place-status-unsupported. A template literal is invisible to
          anything that looks for a class by name. */}
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
        selectedKey={null}
        onInputChange={(value) => {
          searchVersion.current += 1;
          setResults([]);
          setSearchError(null);
          setQuery(value);
        }}
        allowsEmptyCollection
        menuTrigger="focus"
        onSelectionChange={(key) => {
          const chosen = options.find((entry) => entry.id === key);
          if (!chosen) return;
          /**
           * Chosen is chosen. There is no "are you sure" step here any more.
           *
           * The confirmation existed because selecting a place used to be
           * expensive to undo: it replaced the whole page and there was no way
           * back to the list. On a map the pin *is* the location, a wrong one
           * costs a click to replace, and Back returns to the previous one — so
           * the extra press asked the reader to ratify a decision that was
           * never hard to reverse. Leaving it on search while a click on the
           * map committed immediately made one action feel like two.
           */
          onSelect({
            name: chosen.name,
            context: chosen.context,
            latitude: chosen.latitude,
            longitude: chosen.longitude,
            fromDevice: false,
          });
          close();
        }}
      >
        {/* A real label. The placeholder was doing this job before, which it
            cannot: it disappears on the first keystroke and is not a name. */}
        <Label className="tracker-visually-hidden">Search for a place to observe from</Label>
        <div className="tracker-place-search" ref={fieldRef}>
          <Search size={15} aria-hidden />
          {/* Focused on open. Without it the dialog itself took focus, so the
              first thing typed went nowhere and a keyboard user had to tab past
              the location button to reach the field they came for. */}
          {/* Autofocused only in the popover, where the reader opened it on
              purpose. Stealing focus on page load is hostile. */}
          <PlaceSearchInput autoFocus={!inline} />
        </div>
        <Text slot="description" className="tracker-visually-hidden">
          Type at least three characters, or paste a latitude and longitude.
        </Text>

        {/* Announced by the combobox itself as the collection changes.
            Inline, the list is an overlay rather than part of the flow. That is
            not a visual preference: React Aria's combobox calls
            ariaHideOutside whenever it is open, passing the input and its
            popover. With no popover to pass, it hid the rest of the page around
            a bare input — which left the skip link and the photograph's credit
            link focusable inside an aria-hidden subtree, a WCAG failure the
            accessibility gate caught. Inside a popover the same call is the
            ordinary overlay behaviour. It also stops the suggestions shoving
            the rest of the column downwards on every keystroke. */}
        {inline ? (
          <Popover
            className="tracker-place-overlay"
            // Anchored to the field, not to the input inside it. Left to
            // itself the popover measures the input, which sits inside the
            // field's padding — so the list came out inset and narrower than
            // the box it belonged to.
            triggerRef={fieldRef}
            // Measured rather than derived. --trigger-width is the input's
            // width: the field minus its border, its padding and the search
            // icon, a chain of unrelated numbers to reproduce in CSS and wrong
            // the moment any of them changes.
            style={fieldRef.current ? { width: fieldRef.current.offsetWidth } : undefined}
            // Anchored to the field, not to the input inside it. Left to itself
            // the popover measures the input, which sits inside the field's
            // padding — so the list came out inset and narrower than the box it
            // belonged to.
            // Measured rather than derived. --trigger-width is the input's
            // width, which is the field minus its border, its padding and the
            // search icon — a chain of unrelated numbers to reproduce in CSS,
            // and wrong the moment any of them changes. The popover only mounts
            // when it opens, by which time the field has been laid out.
            offset={6}
            placement="bottom start"
          >
            {resultList}
          </Popover>
        ) : (
          resultList
        )}
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
