import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  LineSegments,
  LineBasicMaterial,
} from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { ecefToGeodetic, eciToEcef } from "../physics/coordinates";
import { orbitalPeriodSeconds } from "../physics/kepler";
import type { SatelliteModel } from "../lib/scenario";
import { propagateSatellite } from "../lib/propagation";
import { ecefToEarthFixedThreeVector } from "./coordinates";
import { readScenePlaybackTimeMs, readSceneSatelliteState } from "./sceneMotion";

interface GroundTrackLineProps {
  satellite: SatelliteModel;
  simulationTime: string;
  quality: "low" | "medium" | "high";
  priority?: boolean;
}

const GROUND_TRACK_REFRESH_SECONDS = 2;
const MAX_GROUND_TRACK_SEGMENT_ANGLE_RAD = 0.16;

function earthFixedPointForState(
  state: ReturnType<typeof propagateSatellite>,
  date: Date,
  radiusKm: number,
) {
  return ecefToEarthFixedThreeVector(eciToEcef(state, date), radiusKm);
}

function sampleCountForGroundTrack(
  quality: GroundTrackLineProps["quality"],
  satellite: SatelliteModel,
  priority: boolean,
): number {
  const base =
    quality === "low"
      ? 160
      : quality === "medium"
        ? 260
        : 420;
  const eccentricityBoost = 1 + Math.min(1.6, satellite.keplerian.eccentricity * 2.2);
  const priorityBoost = priority ? 1.16 : 1;

  return Math.min(priority ? 1200 : 820, Math.round(base * eccentricityBoost * priorityBoost));
}

export function GroundTrackLine({
  satellite,
  simulationTime,
  quality,
  priority = false,
}: GroundTrackLineProps) {
  const currentSubpointRef = useRef<Group | null>(null);
  const refreshElapsedRef = useRef(0);
  const geometry = useMemo(() => new BufferGeometry(), []);
  const material = useMemo(
    () =>
      new LineBasicMaterial({
        color: "#f6b94e",
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const line = useMemo(() => {
    const trackLine = new LineSegments(geometry, material);
    trackLine.frustumCulled = false;
    trackLine.renderOrder = 2;

    return trackLine;
  }, [geometry, material]);
  const currentSubpointPosition = useMemo(() => {
    try {
      const parsedTime = Date.parse(simulationTime);
      if (!Number.isFinite(parsedTime)) {
        throw new RangeError(`Invalid ground-track simulation timestamp: ${simulationTime}`);
      }
      const date = new Date(parsedTime);

      return earthFixedPointForState(
        propagateSatellite(satellite, date),
        date,
        EARTH_RADIUS_KM * 1.018,
      );
    } catch {
      return null;
    }
  }, [satellite, simulationTime]);
  const updateTrackGeometry = useCallback(
    (centerTimeMs: number) => {
      if (!satellite.visualization.visible || !satellite.visualization.showGroundTrack) {
        geometry.setDrawRange(0, 0);
        return;
      }

      try {
        const durationSeconds = orbitalPeriodSeconds(satellite.keplerian.semiMajorAxisKm);
        const count = sampleCountForGroundTrack(quality, satellite, priority);
        const startTimeMs = centerTimeMs - durationSeconds * 500;
        const positions = new Float32Array((count - 1) * 6);
        let writtenSegments = 0;
        let previousPoint: ReturnType<typeof earthFixedPointForState> | null = null;
        let previousLongitudeDeg: number | null = null;

        for (let index = 0; index < count; index += 1) {
          const ratio = index / (count - 1);
          const date = new Date(startTimeMs + durationSeconds * ratio * 1000);
          const state = propagateSatellite(satellite, date);
          const ecef = eciToEcef(state, date);
          const geodetic = ecefToGeodetic(ecef);
          const point = ecefToEarthFixedThreeVector(ecef, EARTH_RADIUS_KM * 1.012);
          if (previousPoint && previousLongitudeDeg !== null) {
            const longitudeDelta = Math.abs(geodetic.longitudeDeg - previousLongitudeDeg);
            const angularDistance = previousPoint.angleTo(point);
            if (longitudeDelta < 180 && angularDistance <= MAX_GROUND_TRACK_SEGMENT_ANGLE_RAD) {
              const offset = writtenSegments * 6;
              positions[offset] = previousPoint.x;
              positions[offset + 1] = previousPoint.y;
              positions[offset + 2] = previousPoint.z;
              positions[offset + 3] = point.x;
              positions[offset + 4] = point.y;
              positions[offset + 5] = point.z;
              writtenSegments += 1;
            }
          }
          previousPoint = point;
          previousLongitudeDeg = geodetic.longitudeDeg;
        }

        const existing = geometry.getAttribute("position") as Float32BufferAttribute | undefined;
        if (existing && existing.array.length === positions.length) {
          existing.array.set(positions);
          existing.needsUpdate = true;
        } else {
          const attribute = new Float32BufferAttribute(positions, 3);
          attribute.setUsage(DynamicDrawUsage);
          geometry.setAttribute("position", attribute);
        }
        geometry.setDrawRange(0, writtenSegments * 2);
      } catch {
        geometry.setDrawRange(0, 0);
      }
    },
    [geometry, priority, quality, satellite],
  );

  useEffect(() => {
    const parsedTime = Date.parse(simulationTime);
    updateTrackGeometry(Number.isFinite(parsedTime) ? parsedTime : readScenePlaybackTimeMs());
    refreshElapsedRef.current = 0;
    // Simulation time advances every frame; expensive path sampling is controlled in useFrame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateTrackGeometry]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEffect(() => {
    material.opacity = priority ? 0.58 : 0.24;
    material.needsUpdate = true;
  }, [material, priority]);

  useFrame((_, delta) => {
    if (!priority || !currentSubpointRef.current) return;

    try {
      const playbackTimeMs = readScenePlaybackTimeMs();
      const date = new Date(playbackTimeMs);
      const state = readSceneSatelliteState(satellite);
      currentSubpointRef.current.position.copy(
        earthFixedPointForState(
          state,
          date,
          EARTH_RADIUS_KM * 1.018,
        ),
      );
      refreshElapsedRef.current += delta;
      if (refreshElapsedRef.current >= GROUND_TRACK_REFRESH_SECONDS) {
        refreshElapsedRef.current = 0;
        updateTrackGeometry(playbackTimeMs);
      }
    } catch {
      // Retain the last valid subpoint if current propagation is unavailable.
    }
  });

  if (!satellite.visualization.visible || !satellite.visualization.showGroundTrack) {
    return null;
  }

  return (
    <>
      <primitive object={line} />
      {priority && (
        <group ref={currentSubpointRef} position={currentSubpointPosition ?? undefined} renderOrder={3}>
          <mesh>
            <sphereGeometry args={[64, 18, 12]} />
            <meshBasicMaterial
              color="#ffd36a"
              transparent
              opacity={0.86}
              toneMapped={false}
              depthTest
              depthWrite={false}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[122, 18, 12]} />
            <meshBasicMaterial
              color="#f6b94e"
              transparent
              opacity={0.19}
              depthTest
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh>
            <sphereGeometry args={[160, 18, 12]} />
            <meshBasicMaterial
              color={satellite.visualization.color}
              transparent
              opacity={0.05}
              depthTest
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
    </>
  );
}
