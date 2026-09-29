import { Body, Constellation, Equator, Horizon, MakeTime, Observer } from "astronomy-engine";

import brightStars from "../stars/hygBrightStars.v41.json";
import {
  normalizeDegrees,
  signedAngleDifference,
  type PhonePointing,
  type SkyFinderTarget,
} from "./skyFinder";

interface BrightStarRecord {
  id: number;
  name: string | null;
  raHours: number;
  decDeg: number;
  magnitude: number;
  constellation: string;
}

export interface ExpectedSkyStar {
  id: number;
  name: string | null;
  xPercent: number;
  yPercent: number;
  radiusPx: number;
  magnitude: number;
  inTargetConstellation: boolean;
}

export interface ExpectedSkyContext {
  /** IAU constellation containing the target coordinate, when one exists. */
  constellation: { symbol: string; name: string } | null;
  /** Real catalog stars projected into the approximate Finder field of view. */
  stars: ExpectedSkyStar[];
}

function targetEquatorial(
  target: SkyFinderTarget,
  observer: { latitudeDeg: number; longitudeDeg: number },
  at: Date,
): { raHours: number; decDeg: number } | null {
  if (target.source.kind === "equatorial") {
    return {
      raHours: target.source.rightAscensionHours,
      decDeg: target.source.declinationDeg,
    };
  }
  if (target.source.kind !== "body" && target.source.kind !== "body-region") return null;

  const bodies = target.source.kind === "body" ? [target.source.body] : target.source.bodies;
  const astronomyObserver = new Observer(observer.latitudeDeg, observer.longitudeDeg, 0);
  const time = MakeTime(at);
  const vectors = bodies.flatMap((body) => {
    try {
      // `ofdate=false` returns the J2000 frame required by Constellation().
      const equator = Equator(body as Body, time, astronomyObserver, false, true);
      const ra = (equator.ra * Math.PI) / 12;
      const dec = (equator.dec * Math.PI) / 180;
      return [{
        x: Math.cos(dec) * Math.cos(ra),
        y: Math.cos(dec) * Math.sin(ra),
        z: Math.sin(dec),
      }];
    } catch {
      return [];
    }
  });
  if (vectors.length === 0) return null;
  const sum = vectors.reduce(
    (total, value) => ({ x: total.x + value.x, y: total.y + value.y, z: total.z + value.z }),
    { x: 0, y: 0, z: 0 },
  );
  const horizontal = Math.hypot(sum.x, sum.y);
  return {
    raHours: normalizeDegrees((Math.atan2(sum.y, sum.x) * 180) / Math.PI) / 15,
    decDeg: (Math.atan2(sum.z, horizontal) * 180) / Math.PI,
  };
}

/**
 * Build truthful visual context for the Finder without claiming the camera saw it.
 *
 * The catalog is the documented HYG v4.1 magnitude-limited subset already used
 * by Tracker. Coordinates are projected through Astronomy Engine for the same
 * observer and instant as the target. The 80°×64° view is intentionally broad:
 * it is orientation context, not a calibrated camera optical model.
 */
export function expectedSkyContext(
  target: SkyFinderTarget,
  observer: { latitudeDeg: number; longitudeDeg: number },
  at: Date,
  centre: PhonePointing,
): ExpectedSkyContext {
  const equatorial = targetEquatorial(target, observer, at);
  let constellation: ExpectedSkyContext["constellation"] = null;
  if (equatorial) {
    try {
      const result = Constellation(equatorial.raHours, equatorial.decDeg);
      constellation = { symbol: result.symbol, name: result.name };
    } catch {
      constellation = null;
    }
  }

  const astronomyObserver = new Observer(observer.latitudeDeg, observer.longitudeDeg, 0);
  const time = MakeTime(at);
  const stars = (brightStars as BrightStarRecord[])
    .flatMap((star) => {
      const horizontal = Horizon(time, astronomyObserver, star.raHours, star.decDeg, "normal");
      const xError = signedAngleDifference(centre.azimuthDeg, horizontal.azimuth);
      const yError = horizontal.altitude - centre.altitudeDeg;
      if (Math.abs(xError) > 40 || Math.abs(yError) > 32) return [];
      return [{
        id: star.id,
        name: star.name,
        xPercent: 50 + (xError / 80) * 100,
        yPercent: 50 - (yError / 64) * 100,
        radiusPx: Math.max(0.75, Math.min(2.8, 2.6 - (star.magnitude + 1.5) * 0.31)),
        magnitude: star.magnitude,
        inTargetConstellation: constellation?.symbol === star.constellation,
      }];
    })
    .sort((a, b) => a.magnitude - b.magnitude)
    .slice(0, 42);

  return { constellation, stars };
}
