import {
  Body,
  Equator,
  MakeTime,
  Observer,
  SiderealTime,
} from "astronomy-engine";

/**
 * Where the Sun is overhead, and therefore where it is night.
 *
 * ## Why the map needs this
 *
 * Half of every observing question is "is it dark there yet". On a map-first
 * product that is a geographic fact, and drawing it saves the reader working it
 * out from a clock and a longitude.
 *
 * ## What it is not
 *
 * Not a second theme. The brief is explicit that the daylit half must not turn
 * into a bright map, so this returns geometry and the drawing applies it as a
 * restrained shade over the same dark base. Everything stays legible on both
 * sides of the line.
 */

const DEG = Math.PI / 180;

/** The point with the Sun at the zenith, from its position of date. */
export function subsolarPoint(at: Date): { latitudeDeg: number; longitudeDeg: number } {
  const time = MakeTime(at);
  // `Equator` with an observer at the origin and `ofdate` gives right ascension
  // and declination against the equator and meridian of date, which is the
  // frame the subsolar longitude is defined in.
  const sun = Equator(Body.Sun, time, new Observer(0, 0, 0), true, true);
  const longitudeDeg = (((sun.ra - SiderealTime(time)) * 15 + 540) % 360) - 180;
  return { latitudeDeg: sun.dec, longitudeDeg };
}

/**
 * The Sun's altitude at a place, without building an observer for it.
 *
 * The spherical law of cosines against the subsolar point: the Sun's altitude
 * is ninety degrees minus the great-circle distance to where it is overhead.
 * Exact for this purpose, and cheap enough to run per map cell — which the
 * observer-based route is not.
 */
export function sunAltitudeAt(
  subsolar: { latitudeDeg: number; longitudeDeg: number },
  latitudeDeg: number,
  longitudeDeg: number,
): number {
  const φ1 = subsolar.latitudeDeg * DEG;
  const φ2 = latitudeDeg * DEG;
  const Δλ = (longitudeDeg - subsolar.longitudeDeg) * DEG;
  const cosine =
    Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosine))) / DEG;
}

/**
 * The twilight band Tracker cares about, as altitudes of the Sun.
 *
 * Astronomical twilight is where the sky stops being useful for faint objects,
 * and it is the boundary an observer actually plans around — so the shading has
 * three steps rather than a hard terminator, which is also what the sky looks
 * like.
 */
export const TWILIGHT_STEPS = [
  { belowDeg: 0, label: "Sunset" },
  { belowDeg: -6, label: "Civil twilight" },
  { belowDeg: -18, label: "Astronomical dark" },
] as const;

/**
 * The bands an observer actually plans around.
 *
 * Not a gradient and not a binary. These are the published boundaries, and each
 * one means something specific to somebody standing outside: civil is when the
 * brightest planets appear, nautical is when the horizon is lost and the
 * constellations fill in, astronomical is when the sky stops improving and
 * faint work becomes possible.
 *
 * Ordered from lightest to darkest, each with the Sun altitude at which it
 * begins, so a renderer can walk them and paint each region once.
 */
export const TWILIGHT_BANDS = [
  { id: "day", label: "Daylight", fromDeg: 0, toDeg: 90 },
  { id: "civil", label: "Civil twilight", fromDeg: -6, toDeg: 0 },
  { id: "nautical", label: "Nautical twilight", fromDeg: -12, toDeg: -6 },
  { id: "astronomical", label: "Astronomical twilight", fromDeg: -18, toDeg: -12 },
  { id: "night", label: "Astronomical darkness", fromDeg: -90, toDeg: -18 },
] as const;

export type TwilightBandId = (typeof TWILIGHT_BANDS)[number]["id"];

/**
 * Which band a solar altitude falls in.
 *
 * A boundary belongs to the darker side, which is how the almanacs read them:
 * civil twilight *ends* when the Sun reaches −6, so −6 is nautical. The same
 * rule puts sunset itself at the start of civil twilight rather than at the end
 * of the day.
 */
export function twilightBandFor(sunAltitudeDeg: number): (typeof TWILIGHT_BANDS)[number] {
  for (const band of TWILIGHT_BANDS) {
    if (sunAltitudeDeg > band.fromDeg && sunAltitudeDeg <= band.toDeg) return band;
  }
  return TWILIGHT_BANDS[TWILIGHT_BANDS.length - 1];
}

/**
 * The circle of constant solar altitude, as a closed ring of points.
 *
 * The same construction `capOutline` uses for the sub-lunar cap: walk a full
 * turn of bearings around the centre and step out by the cap's angular radius.
 * At altitude zero this is the terminator; at −18° it is the edge of true
 * darkness.
 */
export function solarAltitudeRing(
  subsolar: { latitudeDeg: number; longitudeDeg: number },
  altitudeDeg: number,
  steps = 180,
): { latitudeDeg: number; longitudeDeg: number }[] {
  const φ1 = subsolar.latitudeDeg * DEG;
  const λ1 = subsolar.longitudeDeg * DEG;
  const δ = (90 - altitudeDeg) * DEG;
  const points: { latitudeDeg: number; longitudeDeg: number }[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const bearing = (index / steps) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearing));
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
      );
    points.push({
      latitudeDeg: φ2 / DEG,
      longitudeDeg: (((λ2 / DEG + 540) % 360) - 180),
    });
  }
  return points;
}

/**
 * The region darker than a given solar altitude, as a GeoJSON multipolygon.
 *
 * ## The construction
 *
 * The Sun's altitude at a point is ninety degrees minus its distance from the
 * subsolar point, so "darker than A" is everywhere further than 90 − A from the
 * Sun — which is the same as everywhere *within* 90 + A of the antisolar point.
 * One spherical cap, no sampling, no seams.
 *
 * Two cases follow from that cap, and getting them the wrong way round is what
 * folded an earlier terminator into vertical stripes:
 *
 *   - When the cap swallows a pole its edge crosses every meridian exactly
 *     once, so the boundary really is a latitude for each longitude and the
 *     shape is closed by running along the top or bottom of the map.
 *   - When it clears both poles — which is most of the year for astronomical
 *     dark, and the weeks around an equinox for civil twilight — the edge is an
 *     ordinary closed loop that may or may not straddle the antimeridian.
 *
 * ## Why the output is clipped rather than left unwrapped
 *
 * The first version of this returned one polygon with longitudes running past
 * ±180, on the theory that the renderer would rather have a continuous ring
 * than a seam. It would not: coordinates outside ±180 are not valid GeoJSON,
 * MapLibre tiles a GeoJSON source in a worker before drawing it, and the tiler
 * simply never finished — so the map stayed "not loaded" forever, drew nothing,
 * and reported no error at all. Everything below keeps longitudes in range and
 * splits the shape at the antimeridian instead.
 */
export function nightPolygon(
  subsolar: { latitudeDeg: number; longitudeDeg: number },
  altitudeDeg: number,
  steps = 360,
): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  const antisolar = {
    latitudeDeg: -subsolar.latitudeDeg,
    // Half a turn away, wrapped back into range. Writing this as `+ 540` looks
    // like the same thing and is not: it normalises the subsolar longitude and
    // never flips it, which puts the cap over the daylit side.
    longitudeDeg: ((subsolar.longitudeDeg + 360) % 360) - 180,
  };
  const radiusDeg = 90 + altitudeDeg;

  const φ1 = antisolar.latitudeDeg * DEG;
  const λ1 = antisolar.longitudeDeg * DEG;
  const δ = radiusDeg * DEG;

  const ring: [number, number][] = [];
  for (let index = 0; index <= steps; index += 1) {
    const bearing = (index / steps) * 2 * Math.PI;
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearing),
    );
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
      );
    ring.push([λ2 / DEG, φ2 / DEG]);
  }

  // Which pole, if either, the cap contains. The distance from the cap's centre
  // to a pole is ninety minus its latitude going north, plus it going south.
  const containsNorth = 90 - antisolar.latitudeDeg < radiusDeg;
  const containsSouth = 90 + antisolar.latitudeDeg < radiusDeg;

  let outline: [number, number][];
  if (containsNorth || containsSouth) {
    /**
     * One latitude per longitude, so the boundary can be walked west to east.
     *
     * Sorting is safe here and only here: the edge crosses each meridian once,
     * so there are no two branches to interleave. Doing this in the other case
     * is exactly what produced the stripes.
     */
    const byLongitude = ring
      .map(([lon, lat]) => [((lon + 540) % 360) - 180, lat] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const poleLat = containsNorth ? 90 : -90;
    outline = [
      [-180, byLongitude[0][1]],
      ...byLongitude,
      [180, byLongitude[byLongitude.length - 1][1]],
      [180, poleLat],
      [-180, poleLat],
    ];
    return multiPolygonOf([outline]);
  }

  // A closed loop. Clip it into the visible world, shifting it either way in
  // case it sits across the antimeridian and shows up on both edges.
  const unwrapped = unwrap(ring);
  const parts: [number, number][][] = [];
  for (const shift of [-360, 0, 360]) {
    const moved = unwrapped.map(([lon, lat]) => [lon + shift, lat] as [number, number]);
    const clipped = clipToWorld(moved);
    if (clipped.length >= 3) parts.push(clipped);
  }
  return multiPolygonOf(parts);
}

/** Keep a ring continuous by removing ±360 jumps between neighbours. */
function unwrap(ring: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let offset = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [lon, lat] = ring[index];
    if (index > 0) {
      const previous = ring[index - 1][0] + offset;
      const delta = lon + offset - previous;
      if (delta > 180) offset -= 360;
      else if (delta < -180) offset += 360;
    }
    out.push([lon + offset, lat]);
  }
  return out;
}

/**
 * Sutherland–Hodgman against the two meridians that bound the world.
 *
 * Exact for this, because the clip region is a vertical strip and therefore
 * convex: every edge is cut at most once per boundary and the result stays a
 * single ring.
 */
function clipToWorld(ring: [number, number][]): [number, number][] {
  let current = ring;
  for (const [limit, keepAbove] of [
    [-180, true],
    [180, false],
  ] as const) {
    const inside = (point: [number, number]) =>
      keepAbove ? point[0] >= limit : point[0] <= limit;
    const next: [number, number][] = [];
    for (let index = 0; index < current.length; index += 1) {
      const a = current[index];
      const b = current[(index + 1) % current.length];
      const aIn = inside(a);
      const bIn = inside(b);
      if (aIn) next.push(a);
      if (aIn !== bIn) {
        const t = (limit - a[0]) / (b[0] - a[0]);
        next.push([limit, a[1] + t * (b[1] - a[1])]);
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current;
}

function multiPolygonOf(rings: [number, number][][]): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  const closed = rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
    });
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiPolygon", coordinates: closed.map((ring) => [ring]) },
  };
}

/**
 * The lit side, as the complement of the night.
 *
 * The same cap construction with the Sun and the anti-Sun exchanged: everywhere
 * *higher* than a given solar altitude is the cap around the subsolar point.
 * Drawing it explicitly is what lets day and night differ by more than one
 * being slightly darker — the lit half can be lifted a little as the dark half
 * is deepened, which is what makes the terminator readable at a glance without
 * turning half the map into a daytime basemap.
 */
export function daylightPolygon(
  subsolar: { latitudeDeg: number; longitudeDeg: number },
  altitudeDeg = 0,
  steps = 360,
): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  return nightPolygon(
    { latitudeDeg: -subsolar.latitudeDeg, longitudeDeg: subsolar.longitudeDeg + 180 },
    -altitudeDeg,
    steps,
  );
}
