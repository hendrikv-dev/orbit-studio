import { useState, type ReactNode } from "react";
import { Crosshair, Minus, Navigation, Plus } from "lucide-react";
import {
  requestPosition,
  type GeolocationOutcome,
  type GeolocationPhase,
} from "../../../lib/geolocation";

/**
 * What you do to the view, grouped where the hand already is.
 *
 * ## The grouping
 *
 * Two stacks in the lower right: the view controls together — recentre, in,
 * out — and the one that changes *where you are* set apart below them. The gap
 * is the point. Zooming is reversible and idle; asking the browser for a
 * location is neither, and putting it in the same run of buttons as `+` invites
 * the press nobody meant to make.
 *
 * ## Why recentre comes and goes
 *
 * It only exists when it would do something: a location is selected and the map
 * has been dragged away from it. A permanent button that is usually a no-op
 * teaches the reader that the controls are decoration, which is the defect this
 * project has now fixed in three separate places.
 */

interface Props {
  /**
   * The layer control, rendered at the top of this stack.
   *
   * Passed in rather than built here because its data belongs to the shell —
   * which layers are on, what each reads at the selected point. What this
   * component owns is where map controls live and what they look like, and
   * choosing what the map draws is a map control.
   */
  layersControl?: ReactNode;
  onZoom: (factor: number) => void;
  /** Given a fix, centre the map on it and select it. */
  onLocate: (latitudeDeg: number, longitudeDeg: number, accuracyM: number) => void;
  /** Present only when the map has wandered off the selected place. */
  onRecentre: (() => void) | null;
}

export function TrackerMapControls({ layersControl, onZoom, onLocate, onRecentre }: Props) {
  const [phase, setPhase] = useState<GeolocationPhase | null>(null);
  const [outcome, setOutcome] = useState<GeolocationOutcome | null>(null);

  async function locate() {
    setOutcome(null);
    const result = await requestPosition(setPhase);
    setPhase(result.phase);
    if (result.coords) {
      setOutcome(null);
      onLocate(result.coords.latitude, result.coords.longitude, result.coords.accuracyM);
      return;
    }
    // A refusal is not a dead end here: the map and the search still work, and
    // the message says so rather than leaving a control that silently does
    // nothing. Tracker never blocks on this permission.
    setOutcome(result);
  }

  const locating = phase === "locating" || phase === "prompting";

  return (
    <>
      <div className="tk-map-controls-view">
        {/*
          Layers sits above zoom and recentre, in the same family and with a
          little more air between it and them: one group is "what is drawn", the
          other is "where I am looking". Separated by a gap rather than by being
          somewhere else entirely.
        */}
        {layersControl ? <div className="tk-map-controlgroup is-layers">{layersControl}</div> : null}
        <div className="tk-map-controlgroup">
          {onRecentre ? (
            <button
              type="button"
              className="tk-map-control"
              onClick={onRecentre}
              aria-label="Recentre on the selected place"
            >
              <Navigation size={15} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            className="tk-map-control"
            onClick={() => onZoom(1)}
            aria-label="Zoom in"
          >
            <Plus size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="tk-map-control"
            onClick={() => onZoom(-1)}
            aria-label="Zoom out"
          >
            <Minus size={16} aria-hidden />
          </button>
        </div>
        <div className="tk-map-controlgroup">
          <button
            type="button"
            className="tk-map-control"
            onClick={locate}
            aria-label="Use my current location"
            data-state={locating ? "busy" : undefined}
          >
            <Crosshair size={16} aria-hidden />
          </button>
        </div>
      </div>

      {outcome ? (
        <div className="tk-map-notice" role="status">
          <p>{outcome.message}</p>
          <p className="tk-map-notice-alt">
            Search for a place, or click anywhere on the map.
          </p>
          <button type="button" className="tk-map-notice-close" onClick={() => setOutcome(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
