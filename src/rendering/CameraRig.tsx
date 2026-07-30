import { useEffect, useMemo, useRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { greenwichMeanSiderealTimeRad } from "../physics/coordinates";
import type { CameraMode, SatelliteModel, ViewPreset } from "../lib/scenario";
import { propagateSatellite } from "../lib/propagation";
import { eciToThreeVector } from "./coordinates";
import type { GuidedMissionFrame } from "../data/productFlow";
import { readScenePlaybackTimeMs, readSceneSatelliteState } from "./sceneMotion";
import {
  cameraDistanceForSelectedOrbitFrame,
  type SelectedOrbitFrame,
} from "./selectedOrbitFrame";

const EARTH_FIXED_AXIS = new Vector3(0, 1, 0);
const EARTH_CENTER = new Vector3(0, 0, 0);
const DEFAULT_VIEW_DIRECTION = new Vector3(0.62, 0.42, 0.66).normalize();
const EARTH_ANCHOR_MAX_DISTANCE_KM = EARTH_RADIUS_KM * 15;
const EARTH_ANCHOR_FOCUS_MAX_DISTANCE_KM = EARTH_RADIUS_KM * 18;

export type EarthViewportMode = "normal" | "focus" | "inspectorCollapsed";
export interface CameraHomeFrame {
  distanceKm: number;
  fov: number;
  position: Vector3;
}

export interface CameraFocusFrame {
  key: string;
  target: Vector3;
  framingRadiusKm: number;
  viewDirection?: Vector3;
}

export function reframeEarthForViewport(mode: EarthViewportMode): {
  distanceKm: number;
  fov: number;
  position: Vector3;
} {
  const distanceMultiplier =
    mode === "focus" ? 3.04 : mode === "inspectorCollapsed" ? 2.96 : 3.08;
  const fov = mode === "focus" ? 40 : mode === "inspectorCollapsed" ? 40 : 42;
  const distanceKm = EARTH_RADIUS_KM * distanceMultiplier;

  return {
    distanceKm,
    fov,
    position: DEFAULT_VIEW_DIRECTION.clone().multiplyScalar(distanceKm),
  };
}

export function reframePlaygroundForViewport(mode: EarthViewportMode): CameraHomeFrame {
  const distanceMultiplier =
    mode === "focus" ? 4.65 : mode === "inspectorCollapsed" ? 4.92 : 4.86;
  const fov = mode === "focus" ? 40 : mode === "inspectorCollapsed" ? 40 : 42;
  const distanceKm = EARTH_RADIUS_KM * distanceMultiplier;

  return {
    distanceKm,
    fov,
    position: DEFAULT_VIEW_DIRECTION.clone().multiplyScalar(distanceKm),
  };
}

interface CameraRigProps {
  viewPreset: ViewPreset;
  cameraMode: CameraMode;
  followSelectedObject: boolean;
  missionFrame?: GuidedMissionFrame;
  selectedSatellite?: SatelliteModel;
  selectedOrbitFrame?: SelectedOrbitFrame | null;
  selectedOrbitDistanceScale?: number;
  focusFrame?: CameraFocusFrame | null;
  defaultFrame?: CameraHomeFrame;
  simulationTime: string;
  viewportMode: EarthViewportMode;
}

interface CameraTransition {
  fromPosition: Vector3;
  fromTarget: Vector3;
  toPosition: Vector3;
  toTarget: Vector3;
  elapsedSeconds: number;
  durationSeconds: number;
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function followDistanceKm(satellite?: SatelliteModel): number {
  if (!satellite) {
    return 4_200;
  }

  const { semiMajorAxisKm, eccentricity } = satellite.keplerian;
  const apogeeAltitudeKm = semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM;

  if (eccentricity > 0.35) {
    return 12_000;
  }

  if (apogeeAltitudeKm > 30_000) {
    return 9_500;
  }

  if (apogeeAltitudeKm > 2_000) {
    return 7_200;
  }

  return 4_200;
}

function anchoredMaxDistanceKm(framingRadiusKm?: number): number {
  if (!framingRadiusKm) {
    return EARTH_ANCHOR_MAX_DISTANCE_KM;
  }

  return Math.min(
    EARTH_ANCHOR_FOCUS_MAX_DISTANCE_KM,
    Math.max(EARTH_ANCHOR_MAX_DISTANCE_KM, framingRadiusKm * 2.45),
  );
}

function shouldFrameSelectedOrbit({
  cameraPosition,
  controlsTarget,
  initialized,
  orbitDistance,
  orbitFrame,
  previousSatelliteId,
  previousViewportMode,
  previousViewportSizeKey,
  viewportMode,
  viewportSizeKey,
}: {
  cameraPosition: Vector3;
  controlsTarget: Vector3;
  initialized: boolean;
  orbitDistance: number;
  orbitFrame: SelectedOrbitFrame;
  previousSatelliteId: string | null;
  previousViewportMode: EarthViewportMode | null;
  previousViewportSizeKey: string | null;
  viewportMode: EarthViewportMode;
  viewportSizeKey: string;
}): boolean {
  if (!initialized) {
    return true;
  }

  if (orbitFrame.satelliteId !== previousSatelliteId) {
    return true;
  }

  if (previousViewportMode !== viewportMode) {
    return true;
  }

  if (previousViewportSizeKey !== viewportSizeKey) {
    return true;
  }

  const currentDistance = cameraPosition.distanceTo(controlsTarget);
  const targetDrift = controlsTarget.distanceTo(orbitFrame.target);

  return (
    currentDistance < orbitDistance * 0.76 ||
    targetDrift > Math.max(EARTH_RADIUS_KM * 0.65, orbitFrame.framingRadiusKm * 0.32)
  );
}

export function CameraRig({
  viewPreset,
  cameraMode,
  followSelectedObject,
  missionFrame,
  selectedSatellite,
  selectedOrbitFrame,
  selectedOrbitDistanceScale = 1,
  focusFrame,
  defaultFrame,
  simulationTime,
  viewportMode,
}: CameraRigProps) {
  const controlsRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const lastViewportModeRef = useRef<EarthViewportMode | null>(null);
  const lastViewportSizeKeyRef = useRef<string | null>(null);
  const lastEarthFixedThetaRef = useRef<number | null>(null);
  const lastSelectedOrbitFrameKeyRef = useRef<string | null>(null);
  const lastFocusFrameKeyRef = useRef<string | null>(null);
  const lastSelectedSatelliteIdRef = useRef<string | null>(null);
  const lastFollowTargetIdRef = useRef<string | null>(null);
  const lastFollowPositionRef = useRef<Vector3 | null>(null);
  const transitionRef = useRef<CameraTransition | null>(null);
  const { camera, invalidate, size } = useThree();
  const narrowViewport = size.width < 744 || (size.width < 960 && size.height < 520);
  const portraitPhoneViewport = size.width < 744 && size.height >= size.width;
  const viewportSizeKey = narrowViewport
    ? `${Math.round(size.width)}x${Math.round(size.height)}`
    : "desktop";
  const earthOrbitFocusMaxRadiusKm = portraitPhoneViewport
    ? EARTH_RADIUS_KM * 1.28
    : EARTH_RADIUS_KM * 1.65;
  const focusFramingRadiusKm =
    focusFrame && narrowViewport && focusFrame.key.startsWith("earth-orbit:")
      ? Math.min(focusFrame.framingRadiusKm, earthOrbitFocusMaxRadiusKm)
      : focusFrame?.framingRadiusKm;
  const selectedPosition = useMemo(() => {
    if (!selectedSatellite) {
      return null;
    }

    try {
      return eciToThreeVector(
        propagateSatellite(selectedSatellite, new Date(simulationTime)).positionKm,
      );
    } catch {
      return null;
    }
  }, [selectedSatellite, simulationTime]);

  useEffect(() => {
    const controls = controlsRef.current;
    const followActive = cameraMode === "follow-satellite" && followSelectedObject;
    const target = (followActive && selectedPosition) || EARTH_CENTER.clone();
    const frame = defaultFrame ?? reframeEarthForViewport(viewportMode);
    const distance = frame.distanceKm;
    const orbitAwareDistance = selectedOrbitFrame
      ? cameraDistanceForSelectedOrbitFrame(
          selectedOrbitFrame,
          camera instanceof PerspectiveCamera ? camera.fov : frame.fov,
          camera instanceof PerspectiveCamera ? camera.aspect : 16 / 9,
        ) * selectedOrbitDistanceScale
      : null;
    const focusDistance = focusFrame
      ? cameraDistanceForSelectedOrbitFrame(
          { framingRadiusKm: focusFramingRadiusKm! },
          camera instanceof PerspectiveCamera ? camera.fov : frame.fov,
          camera instanceof PerspectiveCamera ? camera.aspect : 16 / 9,
        )
      : null;

    if (camera instanceof PerspectiveCamera) {
      camera.fov = missionFrame?.cameraFov ?? frame.fov;
      camera.near = missionFrame ? 10 : 20;
      camera.far = missionFrame
        ? EARTH_RADIUS_KM * 20_000
        : focusFrame
          ? Math.max(EARTH_RADIUS_KM * 200, focusDistance! + focusFrame.framingRadiusKm * 6)
          : selectedOrbitFrame
            ? Math.max(EARTH_RADIUS_KM * 200, orbitAwareDistance! + selectedOrbitFrame.framingRadiusKm * 6)
            : EARTH_RADIUS_KM * 20_000;
      camera.updateProjectionMatrix();
    }

    if (
      focusFrame &&
      cameraMode === "free" &&
      viewPreset === "free" &&
      `${focusFrame.key}:${viewportSizeKey}` !== lastFocusFrameKeyRef.current
    ) {
      const focusTarget = focusFrame.target.clone();
      const focusPosition = focusTarget
        .clone()
        .add(
          (focusFrame.viewDirection ?? DEFAULT_VIEW_DIRECTION)
            .clone()
            .normalize()
            .multiplyScalar(focusDistance!),
        );
      transitionRef.current = {
        fromPosition: camera.position.clone(),
        fromTarget: controls?.target?.clone() ?? target.clone(),
        toPosition: focusPosition,
        toTarget: focusTarget,
        elapsedSeconds: 0,
        durationSeconds: initializedRef.current ? 0.8 : 0.01,
      };
      invalidate();
      lastFocusFrameKeyRef.current = `${focusFrame.key}:${viewportSizeKey}`;
      initializedRef.current = true;
      lastViewportModeRef.current = viewportMode;
      lastViewportSizeKeyRef.current = viewportSizeKey;
      return;
    }

    if (missionFrame) {
      const missionTarget = new Vector3(...missionFrame.cameraTargetKm);
      camera.position.set(...missionFrame.cameraPositionKm);
      camera.lookAt(missionTarget);
      initializedRef.current = true;
      lastViewportModeRef.current = viewportMode;
      lastViewportSizeKeyRef.current = viewportSizeKey;
      if (controls) {
        controls.target.copy(missionTarget);
        controls.update();
      }
      return;
    }

    if (
      selectedOrbitFrame &&
      cameraMode === "free" &&
      viewPreset === "free" &&
      shouldFrameSelectedOrbit({
        cameraPosition: camera.position,
        controlsTarget: controls?.target?.clone() ?? target.clone(),
        initialized: initializedRef.current,
        orbitDistance: orbitAwareDistance!,
        orbitFrame: selectedOrbitFrame,
        previousSatelliteId: lastSelectedSatelliteIdRef.current,
        previousViewportMode: lastViewportModeRef.current,
        previousViewportSizeKey: lastViewportSizeKeyRef.current,
        viewportMode,
        viewportSizeKey,
      })
    ) {
      const orbitTarget = selectedOrbitFrame.target.clone();
      const orbitPosition = orbitTarget
        .clone()
        .add(selectedOrbitFrame.viewDirection.clone().multiplyScalar(orbitAwareDistance!));
      transitionRef.current = {
        fromPosition: camera.position.clone(),
        fromTarget: controls?.target?.clone() ?? target.clone(),
        toPosition: orbitPosition,
        toTarget: orbitTarget,
        elapsedSeconds: 0,
        durationSeconds: initializedRef.current ? 0.95 : 0.01,
      };
      invalidate();
      lastSelectedOrbitFrameKeyRef.current = selectedOrbitFrame.key;
      initializedRef.current = true;
      lastViewportModeRef.current = viewportMode;
      lastViewportSizeKeyRef.current = viewportSizeKey;
      lastSelectedSatelliteIdRef.current = selectedOrbitFrame.satelliteId;
      return;
    }

    if (followActive && selectedPosition) {
      transitionRef.current = null;
      const followTargetId = selectedSatellite?.id ?? null;
      if (followTargetId !== lastFollowTargetIdRef.current) {
        const previousTarget =
          controls?.target?.clone() ?? lastFollowPositionRef.current ?? selectedPosition;
        const currentOffset = camera.position.clone().sub(previousTarget);
        const currentDistance = currentOffset.length();
        const direction =
          currentDistance > 1
            ? currentOffset.normalize()
            : DEFAULT_VIEW_DIRECTION.clone();
        const desiredDistance = followDistanceKm(selectedSatellite);
        const distance = clamp(
          currentDistance,
          desiredDistance * 0.72,
          desiredDistance * 1.45,
        );

        camera.position.copy(selectedPosition.clone().add(direction.multiplyScalar(distance)));
        lastFollowTargetIdRef.current = followTargetId;
      }
      lastFollowPositionRef.current = selectedPosition.clone();
      initializedRef.current = true;
      lastViewportModeRef.current = viewportMode;
      lastViewportSizeKeyRef.current = viewportSizeKey;
      lastSelectedSatelliteIdRef.current = selectedSatellite?.id ?? null;
      camera.lookAt(selectedPosition);
      if (controls) {
        controls.target.copy(selectedPosition);
        controls.update();
      }
      return;
    } else if (viewPreset === "free") {
      if (
        initializedRef.current &&
        lastViewportModeRef.current === viewportMode &&
        lastViewportSizeKeyRef.current === viewportSizeKey
      ) {
        return;
      }
      camera.position.copy(frame.position);
    } else if (viewPreset === "equatorial") {
      camera.position.set(0, EARTH_RADIUS_KM * 0.22, distance);
    } else if (viewPreset === "polar") {
      camera.position.set(0, distance, 10);
    } else if (viewPreset === "ground-track") {
      camera.position.set(EARTH_RADIUS_KM * 0.2, EARTH_RADIUS_KM * 2.55, EARTH_RADIUS_KM * 0.2);
    }

    initializedRef.current = true;
    lastViewportModeRef.current = viewportMode;
    lastViewportSizeKeyRef.current = viewportSizeKey;
    lastSelectedSatelliteIdRef.current = selectedSatellite?.id ?? null;
    camera.lookAt(target);
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }, [
    camera,
    cameraMode,
    followSelectedObject,
    focusFrame,
    focusFramingRadiusKm,
    missionFrame,
    selectedOrbitDistanceScale,
    selectedOrbitFrame,
    selectedPosition,
    defaultFrame,
    viewPreset,
    viewportMode,
    invalidate,
    size.height,
    size.width,
    viewportSizeKey,
  ]);

  useEffect(() => {
    lastEarthFixedThetaRef.current = null;
    lastFollowPositionRef.current = null;
    lastFollowTargetIdRef.current = null;
  }, [cameraMode, followSelectedObject]);

  useFrame((_, delta) => {
    const transition = transitionRef.current;
    if (transition) {
      transition.elapsedSeconds += delta;
      const progress = Math.min(1, transition.elapsedSeconds / transition.durationSeconds);
      const easedProgress = easeInOutCubic(progress);
      camera.position.lerpVectors(transition.fromPosition, transition.toPosition, easedProgress);

      if (controlsRef.current) {
        controlsRef.current.target.lerpVectors(
          transition.fromTarget,
          transition.toTarget,
          easedProgress,
        );
        controlsRef.current.update();
      } else {
        camera.lookAt(transition.toTarget);
      }

      if (progress >= 1) {
        transitionRef.current = null;
      } else {
        invalidate();
      }
      return;
    }

    if (cameraMode === "earth-fixed") {
      const theta = greenwichMeanSiderealTimeRad(new Date(readScenePlaybackTimeMs()));
      const previousTheta = lastEarthFixedThetaRef.current;
      lastEarthFixedThetaRef.current = theta;

      if (previousTheta !== null) {
        camera.position.applyAxisAngle(EARTH_FIXED_AXIS, -(theta - previousTheta));
        camera.lookAt(controlsRef.current?.target ?? EARTH_CENTER);
        controlsRef.current?.update();
      }

      return;
    }

    lastEarthFixedThetaRef.current = null;

    if (
      cameraMode !== "follow-satellite" ||
      !followSelectedObject ||
      !selectedSatellite ||
      !controlsRef.current
    ) {
      return;
    }

    let currentSelectedPosition: Vector3;
    try {
      currentSelectedPosition = eciToThreeVector(
        readSceneSatelliteState(selectedSatellite).positionKm,
      );
    } catch {
      return;
    }

    const previousFollowPosition = lastFollowPositionRef.current;
    if (previousFollowPosition) {
      camera.position.add(currentSelectedPosition.clone().sub(previousFollowPosition));
    }
    lastFollowPositionRef.current = currentSelectedPosition.clone();
    controlsRef.current.target.copy(currentSelectedPosition);
    controlsRef.current.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      minDistance={
        cameraMode === "follow-satellite" && followSelectedObject
          ? Math.max(240, followDistanceKm(selectedSatellite) * 0.18)
          : focusFrame
          ? Math.max(240, (focusFramingRadiusKm ?? focusFrame.framingRadiusKm) * 0.18)
          : EARTH_RADIUS_KM * 1.16
      }
      maxDistance={
        missionFrame
          ? EARTH_RADIUS_KM * 20_000
          : focusFrame
            ? anchoredMaxDistanceKm(focusFrame.framingRadiusKm)
            : selectedOrbitFrame
              ? anchoredMaxDistanceKm(selectedOrbitFrame.framingRadiusKm)
              : anchoredMaxDistanceKm()
      }
      onStart={() => {
        transitionRef.current = null;
      }}
    />
  );
}
