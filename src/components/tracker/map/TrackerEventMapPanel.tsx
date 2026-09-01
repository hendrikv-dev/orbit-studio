import { useMemo } from "react";

import { TrackerMapCanvas } from "./TrackerMapCanvas";
import { cameraForEvent } from "../../../data/tracker/eventCamera";
import type { EventOverlay, EventReading } from "../../../data/tracker/eventOverlay";
import type { LightPollutionArchive } from "../../../data/tracker/lightPollution";
import type { AuroraGrid } from "../../../data/tracker/aurora";

/**
 * The event's geography, on the event page, drawn by the map itself.
 *
 * ## What this replaces
 *
 * Three hand-written SVG renderers — an eclipse map, an aurora map and a
 * general geographic map — that between them reimplemented projection, panning,
 * zooming, a legend, a coastline treatment, a location marker and a colour
 * system, and then looked like a different product from the map the reader had
 * just come from. Two cartographies for one eclipse is the seam this pass exists
 * to remove, and the fix is not to restyle the copy: it is to stop having one.
 *
 * ## Why it is inert
 *
 * Because it is a glance, not a workspace. It sits in a fixed slot beside the
 * recommendation, on a page that scrolls, and a map that captured drags there
 * would fight the page for the same gesture. The reader who wants to work with
 * the geography presses "View visibility map" and gets the real map, framed on
 * the event, with everything it can do.
 *
 * It shares the style, the sources, the overlay code and the camera model with
 * that map, so the two cannot drift apart. What it does not share is history:
 * a panel has no viewport state of its own to write.
 */

interface Props {
  /**
   * The event's own geography, where it has some.
   *
   * Null for the aurora, whose geography is a *layer* rather than an event: the
   * oval is a field over the planet like darkness and light pollution are, and
   * the map draws it from the same nowcast grid the full map uses.
   */
  overlay: EventOverlay | null;
  reading: EventReading | null;
  title: string;
  /** When the field was observed and how long it speaks for, where that matters. */
  timing?: string | null;
  /**
   * Whether the field being drawn has passed its validity.
   *
   * Dims the drawing and marks the panel, so the picture withdraws when the
   * words do rather than going on asserting a sky nobody has looked at for
   * hours.
   */
  expired?: boolean;
  place: { latitudeDeg: number; longitudeDeg: number } | null;
  placeLabel: string | null;
  lightPollution: LightPollutionArchive | null;
  /** NOAA's nowcast, when the panel is showing the aurora. */
  auroraGrid?: AuroraGrid | null;
  /** Environment layers to draw, for phenomena that are layers rather than events. */
  layers?: ReadonlySet<string>;
  /** Where to look when there is no event frame to fit. */
  fallbackBounds?: { west: number; south: number; east: number; north: number } | null;
  /** Opens the real map, framed on this event. */
  onOpenFullMap: (() => void) | null;
}

export function TrackerEventMapPanel({
  overlay,
  reading,
  title,
  timing = null,
  expired = false,
  place,
  placeLabel,
  lightPollution,
  auroraGrid = null,
  layers,
  fallbackBounds = null,
  onOpenFullMap,
}: Props) {
  /**
   * The same frame the full map would use, computed the same way.
   *
   * Anchored on the reader's own longitude so the panel picks the near copy of
   * the world rather than spinning across the Pacific to reach a track that is
   * two hundred degrees away in the other direction.
   */
  const camera = useMemo(() => {
    if (overlay) return cameraForEvent(overlay, place, place?.longitudeDeg ?? 0);
    if (!fallbackBounds) return null;
    // A layer has no track to fit, so the caller says what region matters.
    return { bounds: fallbackBounds, maxZoom: 4 };
  }, [fallbackBounds, overlay, place]);

  const centre = camera
    ? {
        latitudeDeg: (camera.bounds.south + camera.bounds.north) / 2,
        longitudeDeg: (camera.bounds.west + camera.bounds.east) / 2,
      }
    : (place ?? { latitudeDeg: 0, longitudeDeg: 0 });

  return (
    <div className={`tk-viz-panel tk-eventmap${expired ? " is-expired" : ""}`}>
      <div className="tk-viz-head">
        <div className="tk-viz-heading">
          <p className="tk-viz-title">{title}</p>
          {timing ? <p className="tk-viz-timing">{timing}</p> : null}
        </div>
        {onOpenFullMap ? (
          <button type="button" className="tk-viz-open" onClick={onOpenFullMap}>
            Open full map
          </button>
        ) : null}
      </div>

      <div className="tk-eventmap-frame">
        <TrackerMapCanvas
          inert
          centre={centre}
          // A starting zoom only: the camera below fits the event's own frame
          // as soon as the style is up, which is what actually decides the view.
          zoom={2}
          onMove={() => undefined}
          onPick={() => undefined}
          pin={place ? { latitudeDeg: place.latitudeDeg, longitudeDeg: place.longitudeDeg } : null}
          pinLabel={placeLabel}
          daylightAt={null}
          auroraGrid={auroraGrid}
          auroraExpired={expired}
          lightPollution={lightPollution}
          layers={layers ?? new Set<string>()}
          eventOverlay={overlay}
          cameraTarget={camera}
          cameraKey={`${title}-panel`}
          label={`Map of ${title}`}
        />
      </div>

      {/*
        The words, because a drawing is not an answer for everybody.

        The old panels each carried their own summary for the same reason; this
        one takes it from `readEventAt`, which is the single place that decides
        what an event means at a coordinate — so the panel, the card and the
        full map quote one answer rather than three.
      */}
      {reading ? (
        <div className="tk-eventmap-reading">
          <p className="tk-eventmap-value">{reading.value}</p>
          {reading.detail ? <p className="tk-eventmap-detail">{reading.detail}</p> : null}
          {/*
            The numbers behind the sentence.

            The panels this replaced carried them — an eclipse's maximum, its
            partial phase, how long totality lasts here — and dropping them
            would have made the new panel say less than the old one while
            claiming to be the same thing done properly.
          */}
          {reading.facts.length > 0 ? (
            <dl className="tk-eventmap-facts">
              {reading.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
