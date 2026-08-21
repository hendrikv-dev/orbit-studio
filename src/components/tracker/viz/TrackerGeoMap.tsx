import { useMemo, type ReactNode } from "react";
import landGeometry from "../../../data/natural-earth/ne_110m_land.geojson.json";

/**
 * The one map.
 *
 * Aurora and eclipses both need geography and they need the *same* geography,
 * drawn the same size, in the same box, with the observer marked the same way.
 * Two maps built separately drift apart within a week — different extents,
 * different coastline weights, different legends — and the reader ends up
 * learning two interfaces for one idea.
 *
 * So this owns everything that is common: the projection, the coastlines, the
 * graticule, the observer's marker, the frame and the legend rail. What it does
 * not own is the field drawn on top, which is the only thing that differs
 * between an auroral oval and an eclipse track.
 *
 * ## Why a plain equirectangular projection
 *
 * Because the alternative is worse for this job. Every question the map answers
 * is local — how far is the oval from me, which side of the track am I on — and
 * over the twenty to sixty degrees of longitude a Tracker map spans, the
 * distortion of a plate carrée is small and uniform. A conic or an orthographic
 * would look more cartographic and would make the reader's own position harder
 * to find, which is the one thing they are looking for.
 *
 * Latitude is compressed by the cosine of the box's middle latitude, so a
 * degree of longitude and a degree of latitude cover comparable ground and
 * coastlines keep their shape.
 */

export interface MapBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface MapProjection {
  x(longitudeDeg: number): number;
  y(latitudeDeg: number): number;
  width: number;
  height: number;
  bounds: MapBounds;
}

interface Props {
  bounds: MapBounds;
  /** Where the observer is. Always drawn, always on top of the field. */
  marker: { latitudeDeg: number; longitudeDeg: number; label: string };
  /** The phenomenon field, drawn under the coastlines' highlights. */
  children: (projection: MapProjection) => ReactNode;
  legend: { swatch: string; label: string }[];
  /** What the map is of, and when it is valid for. */
  title: string;
  timing: string;
  /** Opens the fuller view; the map itself is never the whole answer. */
  action?: { label: string; onSelect: () => void };
  ariaLabel: string;
}

const VIEW_WIDTH = 640;

interface LandFeature {
  geometry: { type: string; coordinates: unknown };
}

/**
 * Every land ring as a flat list of coordinate arrays.
 *
 * Natural Earth 110m ships polygons and multipolygons; both reduce to the same
 * thing once the holes are kept as separate rings, which is all a filled
 * coastline needs at this scale.
 */
const LAND_RINGS: [number, number][][] = (() => {
  const rings: [number, number][][] = [];
  for (const feature of (landGeometry as { features: LandFeature[] }).features) {
    const { type, coordinates } = feature.geometry;
    if (type === "Polygon") {
      for (const ring of coordinates as [number, number][][]) rings.push(ring);
    } else if (type === "MultiPolygon") {
      for (const polygon of coordinates as [number, number][][][]) {
        for (const ring of polygon) rings.push(ring);
      }
    }
  }
  return rings;
})();

export function TrackerGeoMap({
  bounds,
  marker,
  children,
  legend,
  title,
  timing,
  action,
  ariaLabel,
}: Props) {
  const projection = useMemo<MapProjection>(() => {
    const lonSpan = bounds.east - bounds.west;
    const latSpan = bounds.north - bounds.south;
    const middleLatitude = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
    // Height follows from the aspect the projection produces, then is clamped.
    //
    // The clamp exists because the cosine correction runs away near the poles:
    // an aurora map centred on Fairbanks has a middle latitude near 70°, where
    // cos is 0.35, and the true aspect makes the drawing taller than it is
    // wide. That is cartographically correct and useless in a panel — the map
    // becomes a vertical strip and the coastline the reader is looking for
    // falls off both ends.
    //
    // Inside the clamp the projection is exact. Outside it the drawing is
    // stretched by at most a factor of about two in one axis, which changes
    // where a coastline appears to bulge and changes nothing about which side
    // of a line the observer is on — the only thing these maps are read for.
    const trueHeight =
      (VIEW_WIDTH * latSpan) / Math.max(1e-6, lonSpan * Math.cos(middleLatitude));
    const height = Math.round(
      Math.max(VIEW_WIDTH * 0.42, Math.min(VIEW_WIDTH * 0.72, trueHeight)),
    );
    return {
      width: VIEW_WIDTH,
      height,
      bounds,
      x(longitudeDeg: number) {
        // Unwrap onto the box: a map centred on the Pacific still receives
        // longitudes either side of the antimeridian.
        let lon = longitudeDeg;
        while (lon < bounds.west - 180) lon += 360;
        while (lon > bounds.east + 180) lon -= 360;
        return ((lon - bounds.west) / lonSpan) * VIEW_WIDTH;
      },
      y(latitudeDeg: number) {
        return ((bounds.north - latitudeDeg) / latSpan) * height;
      },
    };
  }, [bounds]);

  const landPath = useMemo(() => {
    const parts: string[] = [];
    for (const ring of LAND_RINGS) {
      // Skip rings entirely outside the box, which is most of the world for a
      // regional map and by far the cheapest optimisation available.
      let minLon = Infinity;
      let maxLon = -Infinity;
      let minLat = Infinity;
      let maxLat = -Infinity;
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      if (maxLat < bounds.south - 5 || minLat > bounds.north + 5) continue;
      const westEdge = bounds.west - 5;
      const eastEdge = bounds.east + 5;
      const overlaps =
        (maxLon >= westEdge && minLon <= eastEdge) ||
        (maxLon + 360 >= westEdge && minLon + 360 <= eastEdge) ||
        (maxLon - 360 >= westEdge && minLon - 360 <= eastEdge);
      if (!overlaps) continue;

      parts.push(
        `M ${ring
          .map(([lon, lat]) => `${projection.x(lon).toFixed(1)},${projection.y(lat).toFixed(1)}`)
          .join(" L ")} Z`,
      );
    }
    return parts.join(" ");
  }, [bounds, projection]);

  const graticule = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const lonStep = bounds.east - bounds.west > 80 ? 30 : 10;
    const latStep = bounds.north - bounds.south > 50 ? 20 : 10;
    for (let lon = Math.ceil(bounds.west / lonStep) * lonStep; lon <= bounds.east; lon += lonStep) {
      lines.push({ x1: projection.x(lon), y1: 0, x2: projection.x(lon), y2: projection.height });
    }
    for (let lat = Math.ceil(bounds.south / latStep) * latStep; lat <= bounds.north; lat += latStep) {
      lines.push({ x1: 0, y1: projection.y(lat), x2: projection.width, y2: projection.y(lat) });
    }
    return lines;
  }, [bounds, projection]);

  const markerX = projection.x(marker.longitudeDeg);
  const markerY = projection.y(marker.latitudeDeg);

  return (
    <div className="tk-geomap">
      <div className="tk-geomap-head">
        <div>
          <p className="tk-viz-title">{title}</p>
          <p className="tk-viz-timing">{timing}</p>
        </div>
        {action ? (
          <button type="button" className="tk-viz-open" onClick={action.onSelect}>
            {action.label}
          </button>
        ) : null}
      </div>

      <div className="tk-geomap-frame">
        <svg
          viewBox={`0 0 ${projection.width} ${projection.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            {/* The field is a sampled grid, and a grid drawn as squares reads as
                a screenshot of a spreadsheet. Blurring it back into a continuous
                surface is honest here: the underlying quantity genuinely is
                continuous, and the legend states the sampling resolution. */}
            {/* Enough blur to dissolve the sampling lattice without dissolving
                the shape it describes. Under about 7 the cell edges survive as
                stair-steps, which read as a rendering fault; much over it and
                a narrow band of high coverage stops being narrow. */}
            <filter id="tk-geomap-smooth" x="-12%" y="-12%" width="124%" height="124%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
            <clipPath id="tk-geomap-clip">
              <rect x="0" y="0" width={projection.width} height={projection.height} />
            </clipPath>
          </defs>

          <g clipPath="url(#tk-geomap-clip)">
            <rect
              x="0"
              y="0"
              width={projection.width}
              height={projection.height}
              className="tk-geomap-sea"
            />

            {/* The field, under the coastline so geography stays readable. */}
            {children(projection)}

            <path d={landPath} className="tk-geomap-land" />

            {graticule.map((line, index) => (
              <line
                key={index}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                className="tk-geomap-graticule"
              />
            ))}

            {/* The observer, last, because finding yourself is the first thing
                anybody does with a map like this. */}
            <g className="tk-geomap-marker">
              <circle cx={markerX} cy={markerY} r={11} className="tk-geomap-marker-halo" />
              <path
                d={`M ${markerX} ${markerY} l -5.5 -8.5 a 6.6 6.6 0 1 1 11 0 Z`}
                className="tk-geomap-marker-pin"
              />
              <circle cx={markerX} cy={markerY - 10.5} r={2.4} className="tk-geomap-marker-dot" />
              <text x={markerX + 11} y={markerY - 6} className="tk-geomap-marker-label">
                {marker.label}
              </text>
            </g>
          </g>
        </svg>
      </div>

      <ul className="tk-geomap-legend">
        {legend.map((entry) => (
          <li key={entry.label}>
            <span style={{ background: entry.swatch }} aria-hidden />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
