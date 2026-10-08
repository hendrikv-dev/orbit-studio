import {
  localSolarCircumstances,
  nextSolarEclipses,
  traceCentralPath,
  type CentralPathPoint,
  type LocalSolarCircumstances,
  type SolarEclipseEvent,
} from "./solarEclipse";

/**
 * Where to go to see an eclipse.
 *
 * ## Two questions that are not the same question
 *
 *   "When is the next eclipse I can see from here?"
 *   "Where should I go to see the next eclipse?"
 *
 * The first searches forward for an eclipse whose local circumstances permit
 * observation from one fixed place, and skips everything else. The second must
 * not skip: an eclipse that misses the reader entirely is exactly the one they
 * are asking about, and answering "it isn't visible from your location" is
 * refusing the question.
 *
 * Keeping them apart is why `findNextVisibleEclipse` takes a location and
 * `findNextEclipse` does not. A caller cannot accidentally get the wrong one,
 * because the wrong one has a different signature.
 *
 * ## What this deliberately is not
 *
 * A travel planner. It answers the astronomical and geographic question —
 * which places see what, and how far away they are — and stops. No routing, no
 * accommodation, no itinerary. Distances are straight lines and are labelled as
 * straight lines; presenting a great-circle distance as a drive would be the
 * same class of error as presenting a nowcast as a forecast.
 */

const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

/**
 * How high the Sun must be at maximum for a place to be worth travelling to.
 *
 * Five degrees, not zero. An eclipse with the Sun on the horizon is behind
 * every hill and building there is, and the atmosphere at that angle takes most
 * of what is left. Recommending a journey to see it would be technically true
 * and practically useless.
 */
const MINIMUM_DESTINATION_ALTITUDE_DEG = 5;

export function greatCircleKm(
  aLatDeg: number,
  aLonDeg: number,
  bLatDeg: number,
  bLonDeg: number,
): number {
  const dLat = (bLatDeg - aLatDeg) * DEG;
  const dLon = (bLonDeg - aLonDeg) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLatDeg * DEG) * Math.cos(bLatDeg * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingDeg(
  aLatDeg: number,
  aLonDeg: number,
  bLatDeg: number,
  bLonDeg: number,
): number {
  const φ1 = aLatDeg * DEG;
  const φ2 = bLatDeg * DEG;
  const Δλ = (bLonDeg - aLonDeg) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export function compassWord(bearing: number): string {
  const points = [
    "north", "north-east", "east", "south-east",
    "south", "south-west", "west", "north-west",
  ];
  return points[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

/**
 * What Tracker knows about one candidate place to watch from.
 *
 * `circumstances` is the same per-observer routine the event page uses, so a
 * candidate's numbers and the reader's own numbers come from one model.
 */
export interface EclipseDestination {
  kind: "origin" | "closest-visibility" | "closest-central" | "best-nearby";
  latitudeDeg: number;
  longitudeDeg: number;
  /** Straight-line distance from the origin. Never a driving distance. */
  distanceKm: number;
  bearingDeg: number;
  circumstances: LocalSolarCircumstances;
  /** One sentence, safe to show verbatim. */
  summary: string;
}

export interface EclipseDestinations {
  event: SolarEclipseEvent;
  origin: EclipseDestination;
  /**
   * The candidates, best first, never more than a handful.
   *
   * The brief's instruction is to present a small number of useful choices
   * rather than hundreds of arbitrary coordinates, and the reason is that the
   * decision is between kinds of trip — go nowhere, drive to the edge, drive
   * into the path — not between coordinate pairs.
   */
  candidates: EclipseDestination[];
  /** Straight-line, and said so wherever a distance is shown. */
  distanceBasis: "great-circle";
}

/**
 * The next solar eclipse anywhere on Earth, visible from the origin or not.
 *
 * This is the search behind "where should I go" — it must not filter by the
 * reader's own visibility, because an eclipse that misses them is the subject
 * of the question rather than a reason to discard it.
 */
export function findNextEclipse(from: Date, count = 1): SolarEclipseEvent[] {
  return nextSolarEclipses(from, count);
}

/**
 * The next eclipse that can actually be seen from one place.
 *
 * Searches forward through global eclipses and returns the first whose local
 * circumstances put the Sun above the horizon with some of it covered. The
 * `searchLimit` bounds how far it will look before giving up, because a place
 * can go a decade without a decent partial and an unbounded search would spin.
 */
export function findNextVisibleEclipse(
  latitudeDeg: number,
  longitudeDeg: number,
  from: Date,
  options: { minimumObscuration?: number; searchLimit?: number } = {},
): { event: SolarEclipseEvent; circumstances: LocalSolarCircumstances } | null {
  const minimum = options.minimumObscuration ?? 0.02;
  const limit = options.searchLimit ?? 30;
  for (const event of nextSolarEclipses(from, limit)) {
    const circumstances = localSolarCircumstances(event, latitudeDeg, longitudeDeg);
    if (circumstances.visibleFromHere && circumstances.obscurationFraction >= minimum) {
      return { event, circumstances };
    }
  }
  return null;
}

/**
 * The previous eclipse that could have been seen from one place.
 *
 * The same search, walking backwards. "When was the last eclipse visible here"
 * and "when is the next" are one operation with a sign, which is why they share
 * everything but the direction.
 */
export function findPreviousVisibleEclipse(
  latitudeDeg: number,
  longitudeDeg: number,
  before: Date,
  options: { minimumObscuration?: number; searchLimit?: number } = {},
): { event: SolarEclipseEvent; circumstances: LocalSolarCircumstances } | null {
  const minimum = options.minimumObscuration ?? 0.02;
  const limit = options.searchLimit ?? 30;
  // Step back a season at a time and take the latest qualifying eclipse in each
  // window: `nextSolarEclipses` only searches forward, so backwards is a
  // sequence of forward searches from progressively earlier starts.
  let windowEnd = before;
  for (let step = 0; step < limit; step += 1) {
    const windowStart = new Date(windowEnd.getTime() - 400 * 86_400_000);
    let best: { event: SolarEclipseEvent; circumstances: LocalSolarCircumstances } | null = null;
    for (const event of nextSolarEclipses(windowStart, 8)) {
      if (Date.parse(event.peakUtc) >= before.getTime()) break;
      const circumstances = localSolarCircumstances(event, latitudeDeg, longitudeDeg);
      if (circumstances.visibleFromHere && circumstances.obscurationFraction >= minimum) {
        best = { event, circumstances };
      }
    }
    if (best) return best;
    windowEnd = windowStart;
  }
  return null;
}

/** The point on the central line nearest a place, with its distance. */
function nearestCentralPoint(
  path: CentralPathPoint[],
  latitudeDeg: number,
  longitudeDeg: number,
): { point: CentralPathPoint; distanceKm: number } | null {
  let best: { point: CentralPathPoint; distanceKm: number } | null = null;
  for (const point of path) {
    // The Sun has to be properly up on the central line for it to be worth
    // travelling to: the track continues through sunrise and sunset at both
    // ends, where totality happens against the horizon.
    if (point.sunAltitudeDeg <= MINIMUM_DESTINATION_ALTITUDE_DEG) continue;
    const distanceKm = greatCircleKm(
      latitudeDeg,
      longitudeDeg,
      point.latitudeDeg,
      point.longitudeDeg,
    );
    if (!best || distanceKm < best.distanceKm) best = { point, distanceKm };
  }
  return best;
}

/**
 * How good a place is to watch from, as one number.
 *
 * Deliberately explainable rather than clever. Totality is a step change and
 * not a slightly better partial — the corona appears only when the last of the
 * disc goes — so it earns a jump rather than a slope. Everything else is the
 * fraction covered, with a modest bonus for a Sun that is comfortably up rather
 * than sitting on the horizon.
 */
function qualityOf(circumstances: LocalSolarCircumstances): number {
  if (!circumstances.visibleFromHere) return 0;
  const central = circumstances.kind === "total" || circumstances.kind === "annular";
  const altitude = Math.max(0, Math.min(1, circumstances.sunAltitudeAtPeakDeg / 40));
  return (central ? 1 + circumstances.obscurationFraction : circumstances.obscurationFraction) +
    0.1 * altitude;
}

function describe(
  kind: EclipseDestination["kind"],
  circumstances: LocalSolarCircumstances,
  distanceKm: number,
  bearing: number,
): string {
  const where =
    kind === "origin"
      ? "From here"
      : `${Math.round(distanceKm)} km ${compassWord(bearing)}`;
  if (!circumstances.visibleFromHere || circumstances.obscurationFraction <= 0) {
    return `${where}: not visible.`;
  }
  const covered = `${Math.round(circumstances.obscurationFraction * 100)}% covered`;
  const central =
    circumstances.kind === "total" || circumstances.kind === "annular"
      ? `, ${circumstances.kind}${
          circumstances.centralDurationSeconds
            ? ` for ${Math.floor(circumstances.centralDurationSeconds / 60)}m ${Math.round(
                circumstances.centralDurationSeconds % 60,
              )}s`
            : ""
        }`
      : "";
  const altitude = `, Sun ${Math.round(circumstances.sunAltitudeAtPeakDeg)}° up`;
  return `${where}: ${covered}${central}${altitude}.`;
}

function destinationAt(
  kind: EclipseDestination["kind"],
  event: SolarEclipseEvent,
  latitudeDeg: number,
  longitudeDeg: number,
  originLat: number,
  originLon: number,
): EclipseDestination {
  const circumstances = localSolarCircumstances(event, latitudeDeg, longitudeDeg);
  const distanceKm = greatCircleKm(originLat, originLon, latitudeDeg, longitudeDeg);
  const bearing = bearingDeg(originLat, originLon, latitudeDeg, longitudeDeg);
  return {
    kind,
    latitudeDeg,
    longitudeDeg,
    distanceKm,
    bearingDeg: bearing,
    circumstances,
    summary: describe(kind, circumstances, distanceKm, bearing),
  };
}

/**
 * Where to go, for one eclipse, from one place.
 *
 * Three candidates at most, because there are only three decisions worth
 * offering: stay where you are, go far enough to see it at all, or go far
 * enough to see it properly. Anything already true of the origin is not offered
 * again — a reader already inside totality does not need to be told about
 * totality 900 km away.
 */
export function eclipseDestinations(
  event: SolarEclipseEvent,
  originLatDeg: number,
  originLonDeg: number,
  options: { stepMinutes?: number; halfSpanMinutes?: number } = {},
): EclipseDestinations {
  const origin = destinationAt(
    "origin",
    event,
    originLatDeg,
    originLonDeg,
    originLatDeg,
    originLonDeg,
  );
  const path = traceCentralPath(
    event,
    options.stepMinutes ?? 6,
    options.halfSpanMinutes ?? 240,
    false,
  );

  const candidates: EclipseDestination[] = [];

  // Closest central: the nearest point on the track where the Sun is up. Only
  // offered when the origin is not already inside it.
  const originIsCentral = origin.circumstances.kind === "total" || origin.circumstances.kind === "annular";
  if (!originIsCentral) {
    const nearest = nearestCentralPoint(path, originLatDeg, originLonDeg);
    if (nearest) {
      candidates.push(
        destinationAt(
          "closest-central",
          event,
          nearest.point.latitudeDeg,
          nearest.point.longitudeDeg,
          originLatDeg,
          originLonDeg,
        ),
      );
    }
  }

  // Closest visibility: only meaningful when the origin sees nothing at all.
  if (!origin.circumstances.visibleFromHere || origin.circumstances.obscurationFraction <= 0) {
    const nearestCentral = nearestCentralPoint(path, originLatDeg, originLonDeg);
    const reachable = nearestVisiblePoint(
      event,
      originLatDeg,
      originLonDeg,
      nearestCentral?.distanceKm ?? null,
    );
    if (reachable) {
      candidates.push(
        destinationAt(
          "closest-visibility",
          event,
          reachable.latitudeDeg,
          reachable.longitudeDeg,
          originLatDeg,
          originLonDeg,
        ),
      );
    }
  }

  // Best nearby: a materially better view that is not necessarily the closest.
  const best = bestNearby(event, path, origin, originLatDeg, originLonDeg);
  if (best) candidates.push(best);

  // Nothing offered twice, and nothing offered that is no better than home.
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const key = `${candidate.latitudeDeg.toFixed(2)}:${candidate.longitudeDeg.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return qualityOf(candidate.circumstances) > qualityOf(origin.circumstances) + 0.01;
  });

  return {
    event,
    origin,
    candidates: unique
      .sort((left, right) => qualityOf(right.circumstances) - qualityOf(left.circumstances))
      .slice(0, 3),
    distanceBasis: "great-circle",
  };
}

/**
 * The nearest place that sees any of the eclipse at all.
 *
 * A ring search outward from the origin rather than a scan of the globe: the
 * answer is nearly always within a few thousand kilometres, and sampling
 * bearings at increasing radius finds it in a few hundred evaluations instead
 * of tens of thousands.
 */
function nearestVisiblePoint(
  event: SolarEclipseEvent,
  originLatDeg: number,
  originLonDeg: number,
  nearestCentralKm: number | null,
): { latitudeDeg: number; longitudeDeg: number } | null {
  /**
   * Do not search when the answer cannot be inside the search.
   *
   * A partial phase reaches a few thousand kilometres either side of the track,
   * so an origin ten thousand kilometres from the nearest central point sees
   * nothing within any radius worth walking. Checking that first turns Sydney
   * from five seconds of fruitless ring search into one distance comparison.
   */
  const PARTIAL_REACH_KM = 3500;
  const MAX_SEARCH_KM = 8000;
  if (nearestCentralKm !== null && nearestCentralKm - PARTIAL_REACH_KM > MAX_SEARCH_KM) {
    return null;
  }

  for (let radiusKm = 250; radiusKm <= 8000; radiusKm += 250) {
    let best: { latitudeDeg: number; longitudeDeg: number; obscuration: number } | null = null;
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const point = destinationFrom(originLatDeg, originLonDeg, bearing, radiusKm);
      const circumstances = localSolarCircumstances(event, point.latitudeDeg, point.longitudeDeg);
      if (
        !circumstances.visibleFromHere ||
        circumstances.obscurationFraction <= 0.01 ||
        // The Sun has to be up at maximum. `visibleFromHere` is true when *any*
        // phase clears the horizon, which includes an eclipse that is over by
        // sunrise — real, and not a place to send somebody.
        circumstances.sunAltitudeAtPeakDeg <= MINIMUM_DESTINATION_ALTITUDE_DEG
      ) {
        continue;
      }
      if (!best || circumstances.obscurationFraction > best.obscuration) {
        best = { ...point, obscuration: circumstances.obscurationFraction };
      }
    }
    if (best) return { latitudeDeg: best.latitudeDeg, longitudeDeg: best.longitudeDeg };
  }
  return null;
}

/**
 * A materially better view, weighing the gain against the journey.
 *
 * The tradeoff the brief names — 97% forty miles away against totality at
 * eighty-five — is real and has no universally right answer, so this does not
 * pretend to one. It scores quality against distance with a gentle penalty and
 * only offers the result when the improvement is worth the words: a candidate
 * that is barely better than home is noise.
 */
function bestNearby(
  event: SolarEclipseEvent,
  path: CentralPathPoint[],
  origin: EclipseDestination,
  originLatDeg: number,
  originLonDeg: number,
): EclipseDestination | null {
  let best: { candidate: EclipseDestination; score: number } | null = null;
  const originQuality = qualityOf(origin.circumstances);

  /**
   * Candidate places to weigh.
   *
   * The central line where there is one, and a ring search where there is not.
   * A purely partial eclipse has no track at all — `greatestPoint` is null
   * because the axis misses Earth — so scanning the path finds nothing and the
   * reader who asks "could I do better" is told nothing. Coverage still varies
   * by hundreds of kilometres across a partial, and that is a real answer.
   */
  const points: { latitudeDeg: number; longitudeDeg: number }[] =
    path.length > 0
      ? path
          .filter((point) => point.sunAltitudeDeg > MINIMUM_DESTINATION_ALTITUDE_DEG)
          .map((point) => ({ latitudeDeg: point.latitudeDeg, longitudeDeg: point.longitudeDeg }))
      : (() => {
          const ring: { latitudeDeg: number; longitudeDeg: number }[] = [];
          for (let radiusKm = 400; radiusKm <= 2400; radiusKm += 400) {
            for (let bearing = 0; bearing < 360; bearing += 30) {
              ring.push(destinationFrom(originLatDeg, originLonDeg, bearing, radiusKm));
            }
          }
          return ring;
        })();

  for (const point of points) {
    const distanceKm = greatCircleKm(
      originLatDeg,
      originLonDeg,
      point.latitudeDeg,
      point.longitudeDeg,
    );
    if (distanceKm > 4000) continue;
    const candidate = destinationAt(
      "best-nearby",
      event,
      point.latitudeDeg,
      point.longitudeDeg,
      originLatDeg,
      originLonDeg,
    );
    if (candidate.circumstances.sunAltitudeAtPeakDeg <= MINIMUM_DESTINATION_ALTITUDE_DEG) continue;
    const gain = qualityOf(candidate.circumstances) - originQuality;
    if (gain <= 0.05) continue;
    // Distance discounted rather than forbidden: a thousand kilometres for
    // totality is a trip people make, and forty for one more percent is not.
    const score = gain - distanceKm / 6000;
    if (!best || score > best.score) best = { candidate, score };
  }
  return best?.candidate ?? null;
}

/** A point at a bearing and distance from another, on the sphere. */
export function destinationFrom(
  latitudeDeg: number,
  longitudeDeg: number,
  bearing: number,
  distanceKm: number,
): { latitudeDeg: number; longitudeDeg: number } {
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = bearing * DEG;
  const φ1 = latitudeDeg * DEG;
  const λ1 = longitudeDeg * DEG;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return {
    latitudeDeg: φ2 / DEG,
    longitudeDeg: (((λ2 / DEG) + 540) % 360) - 180,
  };
}
