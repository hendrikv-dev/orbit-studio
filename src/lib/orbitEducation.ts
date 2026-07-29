import { EARTH_RADIUS_KM } from "../physics/constants";
import type { KeplerianElements } from "../physics/types";

export interface OrbitExplanation {
  title: string;
  effects: string[];
}

const EPSILON = 1e-6;

function changed(before: number, after: number): boolean {
  return Math.abs(after - before) > EPSILON;
}

export function explainKeplerianChange(
  before: KeplerianElements,
  after: KeplerianElements,
): OrbitExplanation | null {
  const beforeAltitudeKm = before.semiMajorAxisKm - EARTH_RADIUS_KM;
  const afterAltitudeKm = after.semiMajorAxisKm - EARTH_RADIUS_KM;

  if (changed(before.semiMajorAxisKm, after.semiMajorAxisKm)) {
    if (after.semiMajorAxisKm > before.semiMajorAxisKm) {
      return {
        title: "Altitude increased.",
        effects: [
          "Orbital period increased.",
          "Average velocity decreased.",
          "Sensor footprint increased.",
          `Mean altitude is now about ${Math.max(0, afterAltitudeKm).toFixed(0)} km.`,
        ],
      };
    }

    return {
      title: "Altitude decreased.",
      effects: [
        "Orbital period decreased.",
        "Average velocity increased.",
        "Sensor footprint decreased.",
        `Mean altitude is now about ${Math.max(0, afterAltitudeKm).toFixed(0)} km.`,
      ],
    };
  }

  if (changed(before.inclinationDeg, after.inclinationDeg)) {
    if (after.inclinationDeg > before.inclinationDeg) {
      return {
        title: "Inclination increased.",
        effects: [
          "Higher latitude access increased.",
          "Equatorial coverage is mostly unchanged.",
          "Orbital period is mostly unchanged.",
        ],
      };
    }

    return {
      title: "Inclination decreased.",
      effects: [
        "High latitude access decreased.",
        "Coverage concentrates closer to the equator.",
        "Orbital period is mostly unchanged.",
      ],
    };
  }

  if (changed(before.eccentricity, after.eccentricity)) {
    if (after.eccentricity > before.eccentricity) {
      return {
        title: "Eccentricity increased.",
        effects: [
          "Orbit becomes more elliptical.",
          "Altitude variation increases.",
          "Velocity varies more dramatically.",
        ],
      };
    }

    return {
      title: "Eccentricity decreased.",
      effects: [
        "Orbit becomes more circular.",
        "Altitude variation decreases.",
        "Velocity becomes more consistent.",
      ],
    };
  }

  if (changed(before.raanDeg, after.raanDeg)) {
    return {
      title: "Orbital plane rotated.",
      effects: [
        "Ground track shifted east or west.",
        "Altitude and period are unchanged.",
        "Latitude reach is unchanged.",
      ],
    };
  }

  if (
    changed(before.argumentOfPeriapsisDeg, after.argumentOfPeriapsisDeg) ||
    changed(before.trueAnomalyDeg, after.trueAnomalyDeg)
  ) {
    return {
      title: "Satellite position changed along the orbit.",
      effects: [
        "Current location changed.",
        "Orbit shape is unchanged.",
        "Period and latitude access are unchanged.",
      ],
    };
  }

  if (changed(beforeAltitudeKm, afterAltitudeKm)) {
    return {
      title: "Altitude changed.",
      effects: ["Coverage and period changed.", "Orbit shape is otherwise similar."],
    };
  }

  return null;
}
