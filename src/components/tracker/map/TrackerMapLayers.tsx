import { useEffect, useRef, useState, useCallback} from "react";
import { Check, Cloud as CloudIcon, Layers, Lightbulb, Sparkles, Sunset, X } from "lucide-react";
import { useDismissableSurface } from "../../../data/tracker/dismissable";

/**
 * What is drawn over the geography.
 *
 * ## Why this stopped being a row of chips
 *
 * A chip per layer is fine for two and impossible for eight. The row was
 * already the widest thing on a phone at three, and every field Tracker
 * eventually draws — a gridded cloud forecast, an aerosol field, whatever comes
 * after them — arrives into that same row. Every mature map product solves this
 * the same way, with one control that opens a panel, and there is no reason for
 * Tracker to invent a different answer to a solved problem.
 *
 * ## What is deliberately not in here
 *
 * The selected event's overlay. It is not a layer: it belongs to one event
 * rather than to the place, it changes when the event changes, and it goes away
 * when the reader stops looking at that event. Putting it in this list as one
 * more checkbox would say the opposite — that "the eclipse" is a property of
 * the map in the way that darkness is. The panel shows it, and the map draws
 * it, for as long as an event is selected.
 *
 * ## Availability is stated, and capability is not implied
 *
 * A layer Tracker can draw but has no data for *right now* is listed and
 * disabled with the reason: hiding it leaves a reader wondering whether they
 * missed a control, and disabling it says "this exists, and here is why it is
 * not available for this date".
 *
 * A layer Tracker cannot draw at all is not listed. Cloud and smoke used to
 * appear here permanently disabled, reading "Needs a gridded forecast, not yet
 * fetched" — internal language for "we never built this", printed in the
 * product as though it were a temporary outage. A control that can never turn
 * on is not a disclosure, it is an advertisement for a feature that does not
 * exist, so the two went until there was a field behind them.
 *
 * Cloud is back, because there is one: GOES for what the sky is doing and a
 * numerical model for what it will do. Smoke is still absent, on the same terms
 * as before — Tracker has an aerosol figure for a point and no field.
 */

export type MapLayerId = "twilight" | "aurora" | "light-pollution" | "cloud";

export interface MapLayerDefinition {
  id: MapLayerId;
  label: string;
  /** One line, said in the panel under the name. */
  blurb: string;
  icon: typeof Sunset;
  group: "conditions" | "context";
}

/**
 * The layers, grouped by the question they answer.
 *
 * "Sky context" is about the light: whether it is dark, and what else is in the
 * sky. "Observing conditions" is about the ground: what the place itself does
 * to the sky above it. Three fit without grouping; the grouping is here because
 * the list grows, and it is the thing that will stop a reader reading all of it
 * when it does.
 */
export const MAP_LAYERS: MapLayerDefinition[] = [
  {
    id: "twilight",
    label: "Twilight and darkness",
    blurb: "Day, the three twilights, and true astronomical darkness",
    icon: Sunset,
    group: "context",
  },
  {
    id: "aurora",
    label: "Aurora",
    blurb: "NOAA's short-term forecast of visible aurora",
    icon: Sparkles,
    group: "context",
  },
  {
    id: "light-pollution",
    label: "Light pollution",
    blurb: "Upward light measured from orbit, at 500 m",
    icon: Lightbulb,
    group: "conditions",
  },
  {
    id: "cloud",
    label: "Cloud cover",
    blurb: "What the satellite sees now, and what the model expects later",
    icon: CloudIcon,
    group: "conditions",
  },
];

/** Every layer id, for narrowing whatever a URL happens to carry. */
export const MAP_LAYER_IDS: readonly MapLayerId[] = MAP_LAYERS.map((layer) => layer.id);

const GROUPS: { id: MapLayerDefinition["group"]; label: string }[] = [
  { id: "context", label: "Sky context" },
  { id: "conditions", label: "Observing conditions" },
];

interface Props {
  active: ReadonlySet<string>;
  onToggle: (layer: MapLayerId) => void;
  /** Layers with no data behind them, and why, so the row can say so. */
  unavailable?: Partial<Record<MapLayerId, string>>;
  /** Named when an event is selected, so the panel can say what else is drawn. */
  eventOverlayLabel?: string | null;
  /**
   * What each active layer says at the selected point, keyed by layer.
   *
   * A layer draws a field across a continent; the reader is standing at one
   * spot in it. Without this they are matching a colour against a legend and
   * guessing, which is the thing a map is supposed to save them from. It sits
   * under the switch that turned the layer on because that is the control that
   * raised the question.
   */
  readings?: Partial<Record<MapLayerId, { value: string; detail: string | null }>>;
  /**
   * The selected event's reading, for when no observing card can carry it.
   *
   * An event's reading normally sits on that event's own card, which is where
   * the reader is already looking. But an event can be selected and drawn while
   * being unobservable from the chosen place — a total eclipse whose path is
   * two thousand kilometres away — and then there is no card, and "you are
   * outside the path" is precisely the answer the reader needs. So it falls
   * back to here, beside the name of the thing on the map.
   *
   * Passed only when the card cannot show it, so the two never both appear.
   */
  eventReading?: {
    value: string;
    detail: string | null;
    facts: { label: string; value: string }[];
  } | null;
  onClearEvent?: () => void;
  /**
   * Told to the shell, so a phone can get out of its own way.
   *
   * On a narrow screen this panel and an expanded observing card are both
   * near-full-height sheets, and opening one over the other left a sliver of
   * map between them — with the reader unable to see the field they had just
   * turned on. The shell suppresses the card's expanded *presentation* while
   * this is open and restores it afterwards; nothing about the selection
   * changes, because the selection is in the URL and this is a matter of what
   * is on screen.
   */
  onOpenChange?: (open: boolean) => void;
}

export function TrackerMapLayers({
  active,
  onToggle,
  unavailable = {},
  eventOverlayLabel = null,
  onClearEvent,
  readings,
  eventReading = null,
  onOpenChange,
}: Props) {
  const [open, setOpenState] = useState(false);
  /**
   * Opening tells the shell in the same commit, not the one after.
   *
   * Routed through a `useEffect` this was a render late, so on a phone the
   * expanded card stayed unfolded for a frame after the panel appeared and
   * stayed folded for a frame after it went — a visible flicker at both ends,
   * and a test that read the DOM straight after the panel and saw the wrong
   * answer twice. The ref is what makes it safe to do outside an updater:
   * React may call an updater more than once, and StrictMode does, so the next
   * value is decided here and the parent is told exactly once.
   */
  const openRef = useRef(false);
  const notifyOpen = useRef(onOpenChange);
  notifyOpen.current = onOpenChange;
  const setOpen = useCallback((next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    setOpenState(next);
    notifyOpen.current?.(next);
  }, []);
  const closeSurface = useCallback(() => setOpen(false), [setOpen]);
  // While this is open, a click on the map dismisses it rather than
  // moving the reader's observing location.
  useDismissableSurface(open, closeSurface);
  const root = useRef<HTMLDivElement>(null);

  /**
   * Closes on Escape and on a click elsewhere, like every other menu.
   *
   * Not a modal: the map behind it stays live, because comparing what a layer
   * does is the reason the control exists and a dialog would put the answer
   * behind the question.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, setOpen]);

  const activeCount = MAP_LAYERS.filter((layer) => active.has(layer.id)).length;

  return (
    <div className="tk-layers" ref={root}>
      {/*
        Icon only, and shaped like the zoom and recentre buttons beside it.
        The written label put it in the top bar next to Find an event, which
        grouped it with the product's navigation — but choosing what the map
        draws is map manipulation, the same family as zooming and recentring,
        and every mature map product puts that family on the map's own edge.
        The tooltip and the accessible name both say "Layers", so nothing is
        lost by dropping the printed word.
      */}
      <button
        type="button"
        className="tk-layers-trigger tk-map-control"
        title="Layers"
        /*
          Named "Layers", with the count folded in when there is one. The count
          used to live in a visually-hidden span, which an `aria-label` on the
          same button suppresses entirely — so the badge was visible to sighted
          readers and silent to everybody else.
        */
        aria-label={activeCount === 0 ? "Layers" : `Layers, ${activeCount} on`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!openRef.current)}
      >
        <Layers size={17} aria-hidden />
        {/* What is on, without opening anything. A control that hides its own
            state makes the reader open it to find out what they already did. */}
        {activeCount > 0 ? (
          <span className="tk-layers-count" aria-hidden>
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="tk-layers-panel" role="group" aria-label="Map layers">
          <header className="tk-layers-panel-head">
            <h2>Layers</h2>
            <button
              type="button"
              className="tk-icon-button"
              onClick={() => setOpen(false)}
              aria-label="Close the layer list"
            >
              <X size={15} aria-hidden />
            </button>
          </header>

          {GROUPS.map((group) => (
            <section key={group.id} className="tk-layers-group">
              <h3>{group.label}</h3>
              <ul>
                {MAP_LAYERS.filter((layer) => layer.group === group.id).map((layer) => {
                  const Icon = layer.icon;
                  const isOn = active.has(layer.id);
                  const reason = unavailable[layer.id];
                  return (
                    <li key={layer.id}>
                      <button
                        type="button"
                        className="tk-layers-item"
                        role="switch"
                        aria-checked={isOn}
                        disabled={Boolean(reason)}
                        onClick={() => onToggle(layer.id)}
                      >
                        <Icon size={16} aria-hidden />
                        <span className="tk-layers-item-text">
                          <span className="tk-layers-item-name">{layer.label}</span>
                          <span className="tk-layers-item-blurb">{reason ?? layer.blurb}</span>
                        </span>
                        <span className="tk-layers-check" aria-hidden>
                          {isOn ? <Check size={14} /> : null}
                        </span>
                      </button>
                      {isOn && readings?.[layer.id] ? (
                        <p className="tk-map-layer-reading">
                          <span className="tk-map-layer-value">{readings[layer.id]!.value}</span>
                          {readings[layer.id]!.detail ? (
                            <span className="tk-map-layer-detail">{readings[layer.id]!.detail}</span>
                          ) : null}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {/* The selected event, named here so the reader can see everything
              currently drawn in one place — but as a statement of what is on
              the map, not as another layer they turn on and off. */}
          {eventOverlayLabel ? (
            <section className="tk-layers-group is-event">
              <h3>Selected event</h3>
              <div className="tk-layers-event">
                <span>{eventOverlayLabel}</span>
                {/*
                  Named for what it does, because of where it sits. This button
                  said "Clear", directly between "Perseids observing potential"
                  and the verdict below it — so the panel read "Perseids
                  observing potential · Clear · Not favourable", and the word
                  the reader met first was a weather word standing where the
                  answer goes. It removes an overlay from the map, and that is
                  what it now says.
                */}
                {onClearEvent ? (
                  <button type="button" className="tk-layers-clear" onClick={onClearEvent}>
                    Remove from map
                  </button>
                ) : null}
              </div>
              {eventReading ? (
                <div className="tk-map-event-reading">
                  <span className="tk-map-event-value">{eventReading.value}</span>
                  {eventReading.detail ? (
                    <span className="tk-map-layer-detail">{eventReading.detail}</span>
                  ) : null}
                  {/* The facts are the whole point of the fallback: the value
                      above is a verdict, and the reader is owed the reason —
                      that the radiant never rises from here. */}
                  {eventReading.facts.length > 0 ? (
                    <ul className="tk-map-event-facts">
                      {eventReading.facts.map((fact) => (
                        <li key={fact.label}>
                          <span>{fact.label}</span>
                          <span>{fact.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
