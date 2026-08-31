import type { EventOverlay } from "./eventOverlay";

/**
 * Where the map should be looking when an event is chosen.
 *
 * ## Why the camera moves at all
 *
 * Choosing "the total solar eclipse of August 2027" from a search box used to
 * change the date, draw a band across North Africa, and leave the reader
 * looking at Oregon. The overlay was correct and invisible, and nothing on
 * screen suggested that the answer was somewhere else on the planet — which is
 * the one thing a geographic event most needs to say.
 *
 * ## Why each phenomenon gets its own frame
 *
 * Because their geographies are not the same shape, and a single "zoom to the
 * event" would be wrong for two of the three. An eclipse has a track you can
 * stand on and the frame is that track. A lunar eclipse is visible from
 * wherever the Moon is up, which is half the planet, so the frame is a
 * hemisphere and zooming in says something false about where to be. A meteor
 * shower touches nothing; its field is a smooth gradient over a continent, and
 * the useful frame is where the gradient is worth anything.
 *
 * ## Why this file computes bounds rather than moving a map
 *
 * So the framing can be tested without a renderer, and so the rule that a
 * frame always includes the reader's own place where that is practical lives in
 * one readable place rather than inside three animation calls.
 */

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface CameraTarget {
  bounds: MapBounds;
  /**
   * How far in the fit may go.
   *
   * A frame is a claim about what is relevant. A partial eclipse whose
   * meaningful coverage happens to be small should not slam the camera down to
   * street level, and a reader who is standing inside the path of totality
   * should not be shown their own back garden.
   */
  maxZoom: number;
}

export interface CameraPlace {
  latitudeDeg: number;
  longitudeDeg: number;
}

/**
 * The copy of the world nearest a reference longitude.
 *
 * The map draws repeated worlds, so a target at 170°E and a viewer at 170°W are
 * forty degrees apart going east and three hundred and twenty going west.
 * Naively fitting to the canonical longitude spins the camera the long way
 * across the Pacific, past two copies of Asia, to arrive somewhere it was
 * already next to. Everything below is computed in an unwrapped frame anchored
 * on where the reader is already looking, and MapLibre is happy to be handed a
 * longitude outside ±180 — that is what `renderWorldCopies` is for.
 */
export function nearestCopy(longitudeDeg: number, referenceDeg: number): number {
  let value = longitudeDeg;
  while (value - referenceDeg > 180) value -= 360;
  while (value - referenceDeg < -180) value += 360;
  return value;
}

/**
 * The shortest arc of longitude that contains every one of these points.
 *
 * Wrapping each longitude to the copy nearest the *viewer* is the obvious
 * thing and is wrong: an eclipse track running from 20°W to 60°E, seen from
 * Oregon, has its eastern half land 360° away from its western half, and the
 * frame comes out three hundred and sixty-eight degrees wide — a whole world,
 * to hold a track that spans eighty.
 *
 * The right question is which arc of the circle the points occupy, and the
 * answer is the complement of the largest gap between them. That works for a
 * path and for a grid alike, which matters because one of the three callers
 * passes a track in order and another passes cells row by row from −180.
 */
function longitudeArc(longitudes: number[]): { west: number; east: number } | null {
  if (longitudes.length === 0) return null;
  const sorted = [...longitudes].map((value) => ((value + 540) % 360) - 180).sort((a, b) => a - b);
  if (sorted.length === 1) return { west: sorted[0], east: sorted[0] };

  // The gap that straddles the antimeridian, and then every ordinary one.
  let widest = sorted[0] + 360 - sorted[sorted.length - 1];
  let west = sorted[0];
  let east = sorted[sorted.length - 1];
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > widest) {
      widest = gap;
      // The arc resumes after the gap and runs the long way round to just
      // before it, which is why `east` is allowed past 180.
      west = sorted[index];
      east = sorted[index - 1] + 360;
    }
  }
  return { west, east };
}

function boundsOf(points: CameraPlace[], referenceDeg: number): MapBounds | null {
  if (points.length === 0) return null;
  const arc = longitudeArc(points.map((point) => point.longitudeDeg));
  if (!arc) return null;
  let south = Infinity;
  let north = -Infinity;
  for (const point of points) {
    south = Math.min(south, point.latitudeDeg);
    north = Math.max(north, point.latitudeDeg);
  }
  return shiftToward({ west: arc.west, east: arc.east, south, north }, referenceDeg);
}

/** Move a frame to the copy of the world nearest where the reader is looking. */
function shiftToward(bounds: MapBounds, referenceDeg: number): MapBounds {
  const centre = (bounds.west + bounds.east) / 2;
  const shift = nearestCopy(centre, referenceDeg) - centre;
  return { ...bounds, west: bounds.west + shift, east: bounds.east + shift };
}

/** Grow a frame to hold one more point, if it does not already. */
function include(bounds: MapBounds, point: CameraPlace, _referenceDeg: number): MapBounds {
  // Against the frame's own centre, not the viewer's: the frame has already
  // been placed on a copy of the world, and the point has to join *that* copy.
  const lon = nearestCopy(point.longitudeDeg, (bounds.west + bounds.east) / 2);
  return {
    west: Math.min(bounds.west, lon),
    east: Math.max(bounds.east, lon),
    south: Math.min(bounds.south, point.latitudeDeg),
    north: Math.max(bounds.north, point.latitudeDeg),
  };
}

/** A little air, so the subject is not pressed against the frame's edge. */
function pad(bounds: MapBounds, degrees: number): MapBounds {
  return {
    west: bounds.west - degrees,
    east: bounds.east + degrees,
    south: Math.max(-84, bounds.south - degrees),
    north: Math.min(84, bounds.north + degrees),
  };
}

/** Roughly how wide a frame is, for deciding whether adding a point is sane. */
function spanDeg(bounds: MapBounds): number {
  return Math.max(bounds.east - bounds.west, bounds.north - bounds.south);
}

/**
 * Whether the reader's place belongs in the frame.
 *
 * Including it is usually the point — "am I in the path" is the question — and
 * occasionally absurd: a reader in Oregon and a track across the Indian Ocean
 * cannot share a frame that shows either of them properly. So it is included
 * while doing so does not more than double the frame, and dropped when it
 * would turn the answer into a picture of the whole planet.
 */
function withPlace(
  bounds: MapBounds,
  place: CameraPlace | null,
  referenceDeg: number,
): MapBounds {
  if (!place) return bounds;
  const grown = include(bounds, place, referenceDeg);
  // Two limits, and the absolute one is what stops a hemisphere. Doubling a
  // small frame to reach the reader is generous; growing a track across North
  // Africa until it also holds Oregon produces a two-hundred-degree frame in
  // which neither is legible, and answers "where is this eclipse" with "Earth".
  const allowed = Math.min(110, Math.max(24, spanDeg(bounds) * 2));
  return spanDeg(grown) > allowed ? bounds : grown;
}

export function cameraForEvent(
  overlay: EventOverlay,
  place: CameraPlace | null,
  /** Where the map is looking now, so the nearest world copy is chosen. */
  referenceLongitudeDeg: number,
): CameraTarget | null {
  if (overlay.kind === "solar-eclipse") {
    /**
     * The central band where there is one, and the deep partial zone otherwise.
     *
     * A total or annular eclipse is *about* its track, and the track is a thin
     * line thousands of kilometres long — so the frame is the track, and the
     * reader's own place joins it when the two can share a view. A partial
     * eclipse has no track at all; framing its full extent would show a third
     * of the planet in pale yellow, so the frame is where the Sun is at least
     * half covered, which is the part worth travelling for.
     */
    const path = overlay.centralPath;
    if (path.length > 1) {
      const bounds = boundsOf(path, referenceLongitudeDeg);
      if (!bounds) return null;
      return { bounds: pad(withPlace(bounds, place, referenceLongitudeDeg), 6), maxZoom: 5.5 };
    }
    const deep = overlay.coverage.cells.filter((cell) => cell.sunUp && cell.obscuration >= 0.5);
    const bounds = boundsOf(deep, referenceLongitudeDeg) ?? boundsOf(
      overlay.coverage.cells.filter((cell) => cell.sunUp && cell.obscuration > 0.02),
      referenceLongitudeDeg,
    );
    if (!bounds) return null;
    return { bounds: pad(withPlace(bounds, place, referenceLongitudeDeg), 8), maxZoom: 4.5 };
  }

  if (overlay.kind === "lunar-eclipse") {
    /**
     * The hemisphere the Moon is over, and no closer.
     *
     * There is nowhere to travel to for a lunar eclipse: either the Moon is up
     * where you are or it is not, and the boundary is a circle half the planet
     * wide. Zooming to anything smaller would imply a place to be.
     */
    const caps = overlay.caps;
    if (caps.length === 0) return null;
    const middle = caps[Math.floor(caps.length / 2)];
    const radius = Math.min(84, middle.radiusDeg);
    const centreLon = nearestCopy(middle.longitudeDeg, referenceLongitudeDeg);
    const bounds: MapBounds = {
      west: centreLon - radius,
      east: centreLon + radius,
      south: Math.max(-84, middle.latitudeDeg - radius),
      north: Math.min(84, middle.latitudeDeg + radius),
    };
    // Not `withPlace`: a reader outside the cap is outside it by design, and
    // stretching the frame to reach them would only make the circle smaller.
    return { bounds, maxZoom: 3 };
  }

  /**
   * Where the shower is worth going out for, plus the reader.
   *
   * Not the whole field: a shower's potential fades smoothly to nothing across
   * a hemisphere, and framing every cell above zero frames most of the planet.
   * Half the night's best is where the gradient stops being academic.
   */
  const field = overlay.field;
  const ceiling = Math.max(0.05, field.peak);
  const worthwhile = field.cells.filter((cell) => cell.potential >= ceiling * 0.5);
  const bounds = boundsOf(worthwhile, referenceLongitudeDeg);
  if (!bounds) return null;

  /**
   * A shower good everywhere is not a place to go, so frame where the reader is.
   *
   * The Perseids at maximum are worth seeing from every longitude in the
   * northern mid-latitudes: the band of worthwhile cells goes right round the
   * planet, and its "bounds" are three hundred and sixty degrees wide. Fitting
   * that is a picture of the world with a wash over the top of it, which
   * teaches nobody anything. What the reader wants to see in that case is their
   * own share of the band, so the frame becomes their neighbourhood, held
   * inside the latitudes the shower actually favours.
   */
  if (bounds.east - bounds.west > 180) {
    if (!place) return { bounds: pad(bounds, 0), maxZoom: 2.5 };
    return {
      bounds: {
        west: place.longitudeDeg - 22,
        east: place.longitudeDeg + 22,
        south: Math.max(bounds.south, place.latitudeDeg - 16),
        north: Math.min(bounds.north, place.latitudeDeg + 16),
      },
      maxZoom: 4,
    };
  }
  return { bounds: pad(withPlace(bounds, place, referenceLongitudeDeg), 5), maxZoom: 4 };
}
