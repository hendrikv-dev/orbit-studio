import { useEffect, useRef, useState, useCallback} from "react";
import {
  Check,
  Cloud,
  Layers,
  Lightbulb,
  Sparkles,
  Sunset,
  Waves,
  X,
} from "lucide-react";
import { useDismissableSurface } from "../../../data/tracker/dismissable";

/**
 * What is drawn over the geography.
 *
 * ## Why this stopped being a row of chips
 *
 * A chip per layer is fine for two and impossible for eight. The row was
 * already the widest thing on a phone at three, and the honest list — light
 * pollution, cloud, smoke, twilight, aurora, terrain, and whatever comes after
 * them — has nowhere to go. Every mature map product solves this the same way,
 * with one control that opens a panel, and there is no reason for Tracker to
 * invent a different answer to a solved problem.
 *
 * ## What is deliberately not in here
 *
 * The selected event's overlay. It is not a layer: it belongs to one event
 * rather than to the place, it changes when the event changes, and it goes away
 * when the reader stops looking at that event. Putting it in this list as a
 * ninth checkbox would say the opposite — that "the eclipse" is a property of
 * the map in the way that cloud cover is. The panel shows it, and the map draws
 * it, for as long as an event is selected.
 *
 * ## Availability is stated, not implied
 *
 * A layer with no data behind it is listed and disabled, with the reason, rather
 * than hidden. Hiding it makes the product look smaller than it is and leaves a
 * reader wondering whether they missed a control; disabling it says "this
 * exists, and here is why it is not available right now".
 */

export type MapLayerId = "twilight" | "aurora" | "light-pollution" | "cloud" | "smoke";

export interface MapLayerDefinition {
  id: MapLayerId;
  label: string;
  /** One line, said in the panel under the name. */
  blurb: string;
  icon: typeof Cloud;
  group: "conditions" | "context";
}

/**
 * The layers, grouped by the question they answer.
 *
 * "Sky context" is about the light: whether it is dark, and what else is in the
 * sky. "Observing conditions" is about the air and the ground: what is between
 * the reader and the sky. A reader looking for cloud does not look under
 * twilight, and the grouping is what stops them having to read all eight.
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
    blurb: "Forecast cloud over the observing window",
    icon: Cloud,
    group: "conditions",
  },
  {
    id: "smoke",
    label: "Smoke and haze",
    blurb: "Aerosol between you and the sky",
    icon: Waves,
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
}

export function TrackerMapLayers({
  active,
  onToggle,
  unavailable = {},
  eventOverlayLabel = null,
  onClearEvent,
  readings,
  eventReading = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const closeSurface = useCallback(() => setOpen(false), []);
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
  }, [open]);

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
        onClick={() => setOpen((value) => !value)}
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
                {onClearEvent ? (
                  <button type="button" className="tk-layers-clear" onClick={onClearEvent}>
                    Clear
                  </button>
                ) : null}
              </div>
              {eventReading ? (
                <div className="tk-map-event-reading">
                  <span className="tk-map-event-value">{eventReading.value}</span>
                  {eventReading.detail ? (
                    <span className="tk-map-layer-detail">{eventReading.detail}</span>
                  ) : null}
                  {/* The facts are the whole point of the fallback: "Not
                      favourable" is a verdict, and the reader is owed the
                      reason — that the radiant never rises from here. */}
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
