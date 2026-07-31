import * as satellite from "satellite.js";
import { cartesianToKeplerian } from "./kepler";
import type { CartesianState, KeplerianElements } from "./types";
import type { CartesianState as LegacyCartesianState } from "../types/orbit";

export interface TleData {
  name: string;
  line1: string;
  line2: string;
}

const satrecCache = new Map<string, ReturnType<typeof satellite.twoline2satrec>>();

function satrecForTle(data: TleData): ReturnType<typeof satellite.twoline2satrec> {
  if (!data.line1.trim() || !data.line2.trim()) {
    throw new Error("TLE lines are required.");
  }

  if (!data.line1.startsWith("1 ") || !data.line2.startsWith("2 ")) {
    throw new Error("Line 1 must start with '1 ' and line 2 must start with '2 '.");
  }

  const key = `${data.line1.trim()}\n${data.line2.trim()}`;
  const cached = satrecCache.get(key);
  if (cached) {
    return cached;
  }

  const satrec = satellite.twoline2satrec(data.line1, data.line2);
  if (satrec.error && satrec.error !== 0) {
    throw new Error(`satellite.js reported error ${satrec.error}.`);
  }

  satrecCache.set(key, satrec);
  return satrec;
}

export function validateTle(data: TleData): string | null {
  try {
    satrecForTle(data);
  } catch (error) {
    return error instanceof Error ? error.message : "Unable to parse this TLE.";
  }

  return null;
}

export function tleToCartesian(data: TleData, targetDate: Date): CartesianState {
  const satrec = satrecForTle(data);
  const propagated = satellite.propagate(satrec, targetDate);
  const { position, velocity } = propagated;

  if (!position || !velocity || typeof position === "boolean" || typeof velocity === "boolean") {
    throw new Error("TLE propagation failed for the selected date.");
  }

  return {
    positionKm: [position.x, position.y, position.z],
    velocityKmS: [velocity.x, velocity.y, velocity.z],
    epoch: targetDate.toISOString(),
  };
}

export function propagateTleToCartesian(
  data: TleData,
  targetDate: string | Date,
): LegacyCartesianState | null {
  try {
    const state = tleToCartesian(data, new Date(targetDate));
    return {
      position: state.positionKm,
      velocity: state.velocityKmS,
      epoch: state.epoch,
    };
  } catch {
    return null;
  }
}

export function tleToKeplerian(data: TleData, targetDate: Date): KeplerianElements {
  return cartesianToKeplerian(tleToCartesian(data, targetDate));
}
