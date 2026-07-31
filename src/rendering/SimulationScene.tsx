import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  CanvasTexture,
  DirectionalLight,
  DoubleSide,
  Mesh,
  Quaternion,
  SRGBColorSpace,
  Sprite,
  ShaderMaterial,
  TextureLoader,
  Vector3,
} from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  CELESTIAL_FRAME_DESCRIPTION,
  CELESTIAL_MODEL_ID,
  STAR_CATALOG_EPOCH,
  STAR_CATALOG_FRAME,
  STAR_CATALOG_ID,
  computeCelestialState,
} from "../astronomy/celestialFrames";
import {
  computeRegionCoverage,
  targetSetForCoverage,
} from "../physics/regionCoverage";
import type { RegionModel } from "../lib/scenario";
import { propagateSatellite } from "../lib/propagation";
import { useSimulationStore } from "../state/useSimulationStore";
import { useRenderScenario } from "../state/scenarioSubscriptions";
import {
  CameraRig,
  reframeEarthForViewport,
  reframePlaygroundForViewport,
  type EarthViewportMode,
} from "./CameraRig";
import { AuroraRenderer } from "./Aurora";
import { CatalogPoints } from "./CatalogPoints";
import { ConstellationOrbitShells } from "./ConstellationOrbitShells";
import { ContactLine } from "./ContactLine";
import { Earth, type EarthVisualPreset } from "./Earth";
import { EducationalOverlays } from "./EducationalOverlays";
import { GeoValidationOverlay } from "./GeoValidationOverlay";
import { GroundStationMarker } from "./GroundStationMarker";
import { GroundTrackLine } from "./GroundTrackLine";
import { OrbitPath } from "./OrbitPath";
import { LatLonGrid } from "./ReferenceGrids";
import { RegionLayer } from "./RegionLayer";
import { SatelliteMarker } from "./SatelliteMarker";
import { ExplorerSatellitePoints } from "./ExplorerSatellitePoints";
import { SensorCone, SensorFootprint } from "./SensorCoverage";
import { StarField } from "./StarField";
import {
  createCatalogOnlyEarthFocusFrame,
  isCatalogOnlyExplorerScene,
} from "./explorerScenePresentation";
import {
  StarOcclusionDiagnosticsOverlay,
  StarOcclusionDiagnosticsProjector,
  type StarOcclusionDiagnosticsState,
} from "./StarOcclusionDiagnostics";
import {
  LabelOverlay,
  LabelProjector,
  type LabelSource,
  type ScreenLabel,
} from "./LabelOverlay";
import { resetLocalAppStateAndReload } from "../lib/appStateReset";
import { eciToThreeVector, latLonToThreeVector } from "./coordinates";
import { GEO_VALIDATION_POINTS } from "./geoValidation";
import type { GuidedMissionFrame } from "../data/productFlow";
import { createSelectedOrbitFrame } from "./selectedOrbitFrame";
import {
  readSceneCelestialState,
  readScenePlaybackTimeMs,
  SceneMotionClock,
} from "./sceneMotion";
import { representativeConstellationShells } from "../data/explorerVisibility";
import type {
  ExplorerColorMode,
  ExplorerFocusPreset,
  ExplorerMarkerStyle,
} from "../data/explorerVisuals";
import type { CameraFocusFrame } from "./CameraRig";
import { writeTidallyLockedMoonQuaternion } from "./moonOrientation";

function dprForQuality(quality: "low" | "medium" | "high"): number {
  if (quality === "low") {
    return 1;
  }

  if (quality === "medium") {
    return 1.5;
  }

  return 2;
}

type HoveredLabelTarget =
  | { kind: "satellite"; id: string }
  | { kind: "station"; id: string }
  | { kind: "region"; id: string }
  | null;

const EARTH_FIXED_AXIS = new Vector3(0, 1, 0);
const GPS_ORBIT_RADIUS_KM = 26_560;
const GEO_ORBIT_RADIUS_KM = 42_164;
const EXPLORER_OBLIQUE_VIEW_DIRECTION = new Vector3(0.62, 0.42, 0.66).normalize();
const SUN_ANGULAR_DIAMETER_RAD = 0.533 * Math.PI / 180;
const SCENE_MOON_DISTANCE_KM = EARTH_RADIUS_KM * 14;
const SCENE_MOON_DIAMETER_KM = EARTH_RADIUS_KM * 0.62;

function orbitalCategory(satellite: { catalogMetadata?: { categoryId?: string } }) {
  return satellite.catalogMetadata?.categoryId ?? "payloads";
}

function regionCenter(region: RegionModel): { latitudeDeg: number; longitudeDeg: number } {
  if (region.boundary.kind === "circle") {
    return {
      latitudeDeg: region.boundary.centerLatitudeDeg,
      longitudeDeg: region.boundary.centerLongitudeDeg,
    };
  }

  if (region.boundary.points.length === 0) {
    return { latitudeDeg: 0, longitudeDeg: 0 };
  }

  const points = region.boundary.points;

  return points.reduce(
    (accumulator, point) => ({
      latitudeDeg: accumulator.latitudeDeg + point.latitudeDeg / points.length,
      longitudeDeg: accumulator.longitudeDeg + point.longitudeDeg / points.length,
    }),
    { latitudeDeg: 0, longitudeDeg: 0 },
  );
}

function coverageLabel(coveredPercent: number): string {
  if (coveredPercent >= 99) {
    return "Covered";
  }

  if (coveredPercent >= 1) {
    return `${coveredPercent.toFixed(0)}%`;
  }

  return "Not visible";
}

function RendererCanvasFallback() {
  return (
    <section className="renderer-fallback" role="alert">
      <div>
        <strong>Earth renderer unavailable</strong>
        <span>WebGL or a critical scene resource failed to initialize.</span>
      </div>
      <button type="button" className="danger-button" onClick={resetLocalAppStateAndReload}>
        Reset local app state
      </button>
    </section>
  );
}

type EarthToSunWorldRef = MutableRefObject<Vector3>;
const CELESTIAL_DIAGNOSTICS_EVENT = "orbit-studio-celestial-diagnostics";

function celestialDiagnosticsEnabled(): boolean {
  return import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("celestialDiagnostics") === "1";
}

function SceneSunDirection({ earthToSunWorldRef }: { earthToSunWorldRef: EarthToSunWorldRef }) {
  useFrame(() => {
    earthToSunWorldRef.current.copy(readSceneCelestialState().sunSceneDirection);
  }, -900);

  return null;
}

function CelestialDiagnosticsProbe({
  earthToSunWorldRef,
}: {
  earthToSunWorldRef: EarthToSunWorldRef;
}) {
  const { gl, scene } = useThree();
  const recoveredShaderSunRef = useRef(new Vector3());
  const earthToMountedSunRef = useRef(new Vector3());
  const worldQuaternionRef = useRef(new Quaternion());
  const lastPublishedMsRef = useRef(Number.NEGATIVE_INFINITY);

  useFrame(() => {
    const earth = scene.getObjectByName("OrbitStudioEarthBase") as Mesh | undefined;
    const sun = scene.getObjectByName("OrbitStudioVisibleSun") as Sprite | undefined;
    const moon = scene.getObjectByName("OrbitStudioVisibleMoon") as Mesh | undefined;
    const light = scene.getObjectByName("OrbitStudioSunLight") as DirectionalLight | undefined;
    if (!earth || !sun || !moon || !light) return;

    scene.updateMatrixWorld(true);
    const earthWorldPosition = earth.getWorldPosition(new Vector3());
    const sunWorldPosition = sun.getWorldPosition(new Vector3());
    const earthWorldQuaternion = earth.getWorldQuaternion(worldQuaternionRef.current);
    const material = earth.material as ShaderMaterial;
    const shaderSunWorld = recoveredShaderSunRef.current
      .copy(material.uniforms.uEarthToSunWorld?.value as Vector3)
      .normalize();
    const mountedEarthToSunWorld = earthToMountedSunRef.current
      .subVectors(sunWorldPosition, earthWorldPosition)
      .normalize();
    const earthToSunWorld = earthToSunWorldRef.current.clone().normalize();
    const celestial = readSceneCelestialState();
    const diagnostic = {
      model: CELESTIAL_MODEL_ID,
      canonicalSimulationUtc: celestial.time.utcIso,
      timeScales: celestial.time,
      earth: {
        greenwichApparentSiderealTimeDeg: celestial.greenwichApparentSiderealTimeDeg,
        earthFixedToSceneQuaternion: celestial.earthFixedToSceneQuaternion.toArray(),
        worldQuaternion: earthWorldQuaternion.toArray(),
        worldMatrix: earth.matrixWorld.toArray(),
        subsolarLatitudeDeg: celestial.subsolarLatitudeDeg,
        subsolarLongitudeDeg: celestial.subsolarLongitudeDeg,
      },
      sun: {
        inertialEqjAu: celestial.sunEqjAu.toArray(),
        inertialEqjDirection: celestial.sunEqjDirection.toArray(),
        sceneDirection: celestial.sunSceneDirection.toArray(),
        shaderWorldDirection: shaderSunWorld.toArray(),
        visibleWorldDirection: mountedEarthToSunWorld.toArray(),
        lightWorldPosition: light.getWorldPosition(new Vector3()).toArray(),
        mountedDirectionDot: mountedEarthToSunWorld.dot(earthToSunWorld),
        shaderDirectionDot: shaderSunWorld.dot(earthToSunWorld),
      },
      moon: {
        inertialEqjAu: celestial.moonEqjAu.toArray(),
        inertialEqjDirection: celestial.moonEqjDirection.toArray(),
        sceneDirection: celestial.moonSceneDirection.toArray(),
        physicalDistanceKm: celestial.moonDistanceKm,
        displayDistanceKm: moon.userData.displayDistanceKm,
        phaseAngleDeg: celestial.moonPhaseAngleDeg,
        illuminatedFraction: celestial.moonIlluminatedFraction,
      },
      frames: CELESTIAL_FRAME_DESCRIPTION,
      sceneAxes: { positiveX: "EQJ +X", positiveY: "EQJ +Z / north", positiveZ: "EQJ -Y" },
      starCatalog: {
        identity: STAR_CATALOG_ID,
        epoch: STAR_CATALOG_EPOCH,
        frame: STAR_CATALOG_FRAME,
      },
    };

    gl.domElement.dataset.celestialDiagnostics = JSON.stringify(diagnostic);
    const nowMs = performance.now();
    if (nowMs - lastPublishedMsRef.current >= 250) {
      lastPublishedMsRef.current = nowMs;
      window.dispatchEvent(new CustomEvent(CELESTIAL_DIAGNOSTICS_EVENT, { detail: diagnostic }));
    }
  });

  return null;
}

function CelestialDiagnosticsPanel() {
  const [diagnostic, setDiagnostic] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const receive = (event: Event) => {
      setDiagnostic((event as CustomEvent<Record<string, unknown>>).detail);
    };
    window.addEventListener(CELESTIAL_DIAGNOSTICS_EVENT, receive);
    return () => window.removeEventListener(CELESTIAL_DIAGNOSTICS_EVENT, receive);
  }, []);

  return (
    <aside className="celestial-diagnostics" aria-label="Development celestial diagnostics">
      <strong>Scientific diagnostics (development only)</strong>
      <pre>{diagnostic ? JSON.stringify(diagnostic, null, 2) : "Waiting for scene frame…"}</pre>
    </aside>
  );
}

function SceneSunLight({ earthToSunWorldRef }: { earthToSunWorldRef: EarthToSunWorldRef }) {
  const lightRef = useRef<DirectionalLight | null>(null);
  const initialSunPosition = useMemo(
    () => earthToSunWorldRef.current.clone().multiplyScalar(EARTH_RADIUS_KM * 9).toArray(),
    [earthToSunWorldRef],
  );

  useFrame(() => {
    if (!lightRef.current) return;

    lightRef.current.position.copy(earthToSunWorldRef.current).multiplyScalar(EARTH_RADIUS_KM * 9);
  });

  return (
    <directionalLight
      ref={lightRef}
      name="OrbitStudioSunLight"
      position={initialSunPosition}
      intensity={3.25}
      color="#fff4dc"
    />
  );
}

function createSceneSunTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (context) {
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, "rgba(255, 251, 220, 1)");
    gradient.addColorStop(0.2, "rgba(255, 237, 160, 0.92)");
    gradient.addColorStop(0.42, "rgba(255, 194, 86, 0.42)");
    gradient.addColorStop(1, "rgba(255, 176, 48, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function SceneSunVisual({ earthToSunWorldRef }: { earthToSunWorldRef: EarthToSunWorldRef }) {
  const spriteRef = useRef<Sprite | null>(null);
  const { camera } = useThree();
  const sunTexture = useMemo(() => createSceneSunTexture(), []);
  const initialSunPosition = useMemo(
    () => earthToSunWorldRef.current.clone().multiplyScalar(camera.far * 0.85).toArray(),
    [camera, earthToSunWorldRef],
  );

  useEffect(() => () => sunTexture.dispose(), [sunTexture]);

  useFrame(() => {
    if (!spriteRef.current) return;

    const celestialDistance = camera.far * 0.85;
    const apparentDiameter = 2 * Math.tan(SUN_ANGULAR_DIAMETER_RAD / 2) * celestialDistance;
    spriteRef.current.position
      .copy(earthToSunWorldRef.current)
      .multiplyScalar(celestialDistance);
    spriteRef.current.scale.set(apparentDiameter, apparentDiameter, 1);
  });

  return (
    <sprite
      ref={spriteRef}
      name="OrbitStudioVisibleSun"
      position={initialSunPosition}
      scale={[
        1,
        1,
        1,
      ]}
      renderOrder={-2}
    >
      <spriteMaterial
        map={sunTexture}
        transparent
        opacity={0.78}
        depthTest
        depthWrite={false}
        blending={AdditiveBlending}
        fog={false}
        toneMapped={false}
      />
    </sprite>
  );
}

function SceneMoonVisual() {
  const moonRef = useRef<Mesh | null>(null);
  const frameMoonQuaternionRef = useRef(new Quaternion());
  const moonTexture = useLoader(TextureLoader, "/moon/nasa-lroc-color-1k.jpg");
  moonTexture.colorSpace = SRGBColorSpace;
  const initialMoonPosition = useMemo(
    () => {
      const state = readSceneCelestialState();
      return state.moonSceneDirection
        .clone()
        .multiplyScalar(SCENE_MOON_DISTANCE_KM * state.moonDistanceKm / 384_400)
        .toArray();
    },
    [],
  );

  useFrame(() => {
    if (!moonRef.current) return;

    const state = readSceneCelestialState();
    const displayDistanceKm = SCENE_MOON_DISTANCE_KM * state.moonDistanceKm / 384_400;
    moonRef.current.position.copy(state.moonSceneDirection).multiplyScalar(displayDistanceKm);
    moonRef.current.userData.physicalDistanceKm = state.moonDistanceKm;
    moonRef.current.userData.displayDistanceKm = displayDistanceKm;
    moonRef.current.userData.illuminatedFraction = state.moonIlluminatedFraction;
    moonRef.current.userData.phaseAngleDeg = state.moonPhaseAngleDeg;
    moonRef.current.quaternion.copy(
      writeTidallyLockedMoonQuaternion(frameMoonQuaternionRef.current, moonRef.current.position),
    );
  });

  return (
    <mesh ref={moonRef} name="OrbitStudioVisibleMoon" position={initialMoonPosition}>
      <sphereGeometry args={[SCENE_MOON_DIAMETER_KM / 2, 40, 24]} />
      <meshStandardMaterial
        map={moonTexture}
        color="#ffffff"
        roughness={0.96}
        metalness={0}
        fog={false}
      />
    </mesh>
  );
}

function LunarSurfacePlaceholder({ missionFrame }: { missionFrame: GuidedMissionFrame }) {
  const surfaceQuaternion = useMemo(() => {
    const normal = new Vector3(...missionFrame.spacecraftPositionKm)
      .sub(new Vector3(...missionFrame.moonPositionKm))
      .normalize();

    return new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal);
  }, [missionFrame.moonPositionKm, missionFrame.spacecraftPositionKm]);
  const showAstronaut = missionFrame.cameraLabel.toLowerCase().includes("surface");

  return (
    <group position={missionFrame.spacecraftPositionKm} quaternion={surfaceQuaternion}>
      <mesh position={[0, -70, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1800, 96]} />
        <meshBasicMaterial color="#746f66" side={DoubleSide} />
      </mesh>
      <mesh position={[-860, -54, 620]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[260, 40]} />
        <meshBasicMaterial color="#4f4a43" side={DoubleSide} />
      </mesh>
      <mesh position={[920, -52, -720]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[190, 36]} />
        <meshBasicMaterial color="#565149" side={DoubleSide} />
      </mesh>
      <mesh position={[0, 280, 0]}>
        <boxGeometry args={[520, 340, 520]} />
        <meshStandardMaterial
          color="#ded7c7"
          emissive="#2c2416"
          emissiveIntensity={0.24}
          metalness={0.12}
          roughness={0.72}
        />
      </mesh>
      <mesh position={[0, 570, 0]}>
        <cylinderGeometry args={[90, 130, 190, 16]} />
        <meshStandardMaterial color="#f7efe0" roughness={0.7} />
      </mesh>
      {[
        [-360, 80, -360],
        [360, 80, -360],
        [-360, 80, 360],
        [360, 80, 360],
      ].map((position, index) => (
        <mesh key={index} position={position as [number, number, number]}>
          <boxGeometry args={[42, 360, 42]} />
          <meshStandardMaterial color="#c9c0af" roughness={0.78} />
        </mesh>
      ))}
      {showAstronaut && (
        <group position={[840, 118, 360]}>
          <mesh position={[0, 130, 0]}>
            <sphereGeometry args={[104, 20, 14]} />
            <meshStandardMaterial color="#fffaf1" roughness={0.52} />
          </mesh>
          <mesh position={[0, -40, 0]}>
            <cylinderGeometry args={[76, 88, 210, 16]} />
            <meshStandardMaterial color="#f4efe4" roughness={0.58} />
          </mesh>
          <mesh position={[0, 132, 76]}>
            <sphereGeometry args={[42, 14, 8]} />
            <meshBasicMaterial color="#1d2c3a" />
          </mesh>
        </group>
      )}
    </group>
  );
}

function SceneDepthCue({ broad }: { broad: boolean }) {
  const innerOpacity = broad ? 0.018 : 0.032;
  const middleOpacity = broad ? 0.022 : 0.026;
  const outerOpacity = broad ? 0.034 : 0.018;

  return (
    <group name="OrbitStudioSceneDepthCue" renderOrder={-8}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[EARTH_RADIUS_KM * 2.25 - 18, EARTH_RADIUS_KM * 2.25 + 18, 192]} />
        <meshBasicMaterial
          color="#366477"
          transparent
          opacity={innerOpacity}
          side={DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0.42, 0]}>
        <ringGeometry args={[GPS_ORBIT_RADIUS_KM - 24, GPS_ORBIT_RADIUS_KM + 24, 224]} />
        <meshBasicMaterial
          color="#294e61"
          transparent
          opacity={middleOpacity}
          side={DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, -0.28, 0]}>
        <ringGeometry args={[GEO_ORBIT_RADIUS_KM - 32, GEO_ORBIT_RADIUS_KM + 32, 256]} />
        <meshBasicMaterial
          color="#3c6576"
          transparent
          opacity={outerOpacity}
          side={DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function MissionFrameObjects({ missionFrame }: { missionFrame: GuidedMissionFrame }) {
  const moonRadius =
    missionFrame.focus === "surface" ? 1120 : missionFrame.focus === "moon" ? 7200 : 6200;
  const spacecraftRadius =
    missionFrame.focus === "earth" ? 240 : missionFrame.focus === "surface" ? 720 : 1100;

  return (
    <>
      {missionFrame.moonVisible && (
        <mesh position={missionFrame.moonPositionKm}>
          <sphereGeometry args={[moonRadius, 48, 32]} />
          <meshStandardMaterial
            color="#b9b3a8"
            emissive="#211f1b"
            emissiveIntensity={0.18}
            roughness={0.92}
          />
        </mesh>
      )}
      {missionFrame.spacecraftVisible && missionFrame.focus !== "surface" && (
        <mesh position={missionFrame.spacecraftPositionKm}>
          <sphereGeometry args={[spacecraftRadius, 18, 12]} />
          <meshBasicMaterial color="#f8d36a" />
        </mesh>
      )}
      {missionFrame.spacecraftVisible && missionFrame.focus === "surface" && (
        <LunarSurfacePlaceholder missionFrame={missionFrame} />
      )}
    </>
  );
}

interface SimulationSceneProps {
  missionFrame?: GuidedMissionFrame;
  showVisualContextLegend?: boolean;
  earthVisualPreset?: EarthVisualPreset;
  orbitAwareFraming?: boolean;
  explorerVisibleSatelliteIds?: readonly string[];
  explorerVisibleGroundStationIds?: readonly string[];
  representativeOrbitConstellationIds?: readonly string[];
  shellConstellationIds?: readonly string[];
  selectedArchitectureConstellationId?: string | null;
  explorerSelectedOrbitVisible?: boolean;
  explorerFocusPreset?: ExplorerFocusPreset;
  explorerFocusRequestKey?: number;
  explorerMarkerStyles?: ReadonlyMap<string, ExplorerMarkerStyle>;
  explorerColorMode?: ExplorerColorMode;
  explorerAnimate?: boolean;
  autoFrameSelections?: boolean;
  scaleCatalogRendering?: boolean;
  playgroundPresentation?: boolean;
  showStarField?: boolean;
  auroraModeEnabled?: boolean;
  onClearSelection?: () => void;
}

export function SimulationScene({
  missionFrame,
  showVisualContextLegend = false,
  earthVisualPreset = "realistic",
  orbitAwareFraming = false,
  explorerVisibleSatelliteIds,
  explorerVisibleGroundStationIds,
  representativeOrbitConstellationIds = [],
  shellConstellationIds = [],
  selectedArchitectureConstellationId = null,
  explorerSelectedOrbitVisible = true,
  explorerFocusPreset,
  explorerFocusRequestKey = 0,
  explorerMarkerStyles,
  explorerColorMode = "type",
  explorerAnimate = true,
  autoFrameSelections = false,
  scaleCatalogRendering = false,
  playgroundPresentation = false,
  showStarField = true,
  auroraModeEnabled = false,
  onClearSelection,
}: SimulationSceneProps = {}) {
  const scenario = useRenderScenario();
  const workspace = useSimulationStore((state) => state.workspace);
  const isPlaying = useSimulationStore((state) => state.isPlaying);
  const playbackTimeScale = useSimulationStore((state) => state.scenario.timeScale);
  const [screenLabels, setScreenLabels] = useState<ScreenLabel[]>([]);
  const [starDiagnostics, setStarDiagnostics] =
    useState<StarOcclusionDiagnosticsState | null>(null);
  const [hoveredLabelTarget, setHoveredLabelTarget] = useState<HoveredLabelTarget>(null);
  const showCelestialDiagnostics = celestialDiagnosticsEnabled();
  const earthRenderSettings = useMemo(
    () =>
      scaleCatalogRendering
        ? {
            ...scenario.renderSettings,
            quality: "medium" as const,
            showClouds: false,
            showNightLights: false,
          }
        : playgroundPresentation && scenario.renderSettings.quality !== "low"
        ? {
            ...scenario.renderSettings,
            quality: "medium" as const,
          }
        : scenario.renderSettings,
    [playgroundPresentation, scaleCatalogRendering, scenario.renderSettings],
  );
  const selectedSatelliteId = useSimulationStore((state) => state.selectedSatelliteId);
  const selectSatellite = useSimulationStore((state) => state.selectSatellite);
  const selectGroundStation = useSimulationStore((state) => state.selectGroundStation);
  const selectRegion = useSimulationStore((state) => state.selectRegion);
  const selectCatalogObject = useSimulationStore((state) => state.selectCatalogObject);
  const setEarthLiveLayerStatus = useSimulationStore((state) => state.setEarthLiveLayerStatus);
  const selectedSatellite = scenario.satellites.find(
    (satellite) => satellite.id === selectedSatelliteId,
  );
  const selectedConstellation =
    scenario.selectedObjectType === "constellation"
      ? scenario.constellations.find(
          (constellation) => constellation.id === scenario.selectedObjectId,
        )
      : null;
  const selectionOrbitFraming = orbitAwareFraming || autoFrameSelections;
  const selectedConstellationFrameSatellite = useMemo(() => {
    if (!selectionOrbitFraming || !selectedConstellation) return null;

    return representativeConstellationShells(selectedConstellation, scenario.satellites)
      .sort(
        (left, right) =>
          right.keplerian.semiMajorAxisKm * (1 + right.keplerian.eccentricity) -
          left.keplerian.semiMajorAxisKm * (1 + left.keplerian.eccentricity),
      )[0] ?? null;
  }, [scenario.satellites, selectedConstellation, selectionOrbitFraming]);
  const selectedFrameSatellite = selectedSatellite ?? selectedConstellationFrameSatellite;
  const selectedOrbitFrame = useMemo(
    () => selectionOrbitFraming && selectedFrameSatellite
      ? createSelectedOrbitFrame(selectedFrameSatellite)
      : null,
    [selectedFrameSatellite, selectionOrbitFraming],
  );
  const selectedGroundStationId = useSimulationStore((state) => state.selectedGroundStationId);
  const selectedGroundStation = scenario.groundStations.find(
    (station) => station.id === selectedGroundStationId,
  );
  const selectedRegionId = useSimulationStore((state) => state.selectedRegionId);
  const selectedCatalogObjectId =
    scenario.selectedObjectType === "catalog-object" ? scenario.selectedObjectId : null;
  const sunDirection = useMemo(
    () => computeCelestialState(scenario.simulationTimeUtc).sunSceneDirection,
    [scenario.simulationTimeUtc],
  );
  const earthToSunWorldRef = useRef(sunDirection.clone());
  const viewportMode: EarthViewportMode = workspace.focusMode
    ? "focus"
    : workspace.leftPanelCollapsed || workspace.rightPanelCollapsed
      ? "inspectorCollapsed"
      : "normal";
  const initialCameraFrame = useMemo(
    () =>
      playgroundPresentation
        ? reframePlaygroundForViewport(viewportMode)
        : reframeEarthForViewport(viewportMode),
    [playgroundPresentation, viewportMode],
  );
  const catalogOnlyExplorerScene = isCatalogOnlyExplorerScene({
    scaleCatalogRendering,
    satelliteCount: scenario.satellites.length,
  });
  const broadRegimeFrame =
    !catalogOnlyExplorerScene &&
    (explorerFocusPreset === "geo" || explorerFocusPreset === "earth-orbit");
  const sceneFogNear = broadRegimeFrame
    ? GEO_ORBIT_RADIUS_KM * 1.3
    : selectedOrbitFrame
    ? Math.max(
        EARTH_RADIUS_KM * 5,
        selectedOrbitFrame.cameraDistanceKm + selectedOrbitFrame.framingRadiusKm * 0.5,
      )
    : EARTH_RADIUS_KM * 5;
  const sceneFogFar = broadRegimeFrame
    ? GEO_ORBIT_RADIUS_KM * 3.2
    : selectedOrbitFrame
    ? Math.max(
        EARTH_RADIUS_KM * 18,
        selectedOrbitFrame.cameraDistanceKm + selectedOrbitFrame.framingRadiusKm * 4,
      )
    : EARTH_RADIUS_KM * 18;
  const activeConstellation = selectedConstellation;
  const constellationMemberIds = useMemo(
    () =>
      new Set(
        scenario.constellations
          .filter((constellation) => constellation.visible)
          .flatMap((constellation) => constellation.satelliteIds),
      ),
    [scenario.constellations],
  );
  const selectedConstellationMemberIds = useMemo(
    () => new Set(selectedConstellation?.satelliteIds ?? []),
    [selectedConstellation],
  );
  const explorerSatelliteIdSet = useMemo(
    () => explorerVisibleSatelliteIds ? new Set(explorerVisibleSatelliteIds) : null,
    [explorerVisibleSatelliteIds],
  );
  const explorerGroundStationIdSet = useMemo(
    () => explorerVisibleGroundStationIds ? new Set(explorerVisibleGroundStationIds) : null,
    [explorerVisibleGroundStationIds],
  );
  const isSatelliteCategoryVisible = (satellite: (typeof scenario.satellites)[number]) => {
    const category = orbitalCategory(satellite);
    if (category === "debris") return workspace.visibilityFilters.debris;
    if (category === "rocket-bodies") return workspace.visibilityFilters.rocketBodies;
    return workspace.visibilityFilters.payloads;
  };
  const isSatelliteGroupVisible = (satellite: (typeof scenario.satellites)[number]) => {
    if (!satellite.visualization.visible) {
      return false;
    }

    const selected = satellite.id === selectedSatelliteId;
    const inSelectedConstellation = selectedConstellationMemberIds.has(satellite.id);

    if (explorerSatelliteIdSet) {
      return explorerSatelliteIdSet.has(satellite.id);
    }

    if (workspace.visibilityFilters.selectedOnly) {
      return selected || inSelectedConstellation;
    }

    if (!selected && !inSelectedConstellation && !isSatelliteCategoryVisible(satellite)) {
      return false;
    }

    if (satellite.constellationId && !workspace.visibilityFilters.constellations) {
      return selected || inSelectedConstellation;
    }

    return selected || inSelectedConstellation || !satellite.constellationId || constellationMemberIds.has(satellite.id);
  };
  const visibleSatellites = scenario.satellites.filter(isSatelliteGroupVisible);
  const pointRenderingActive = orbitAwareFraming || scaleCatalogRendering;
  const detailedSatellites = pointRenderingActive
    ? visibleSatellites.filter((satellite) => satellite.id === selectedSatelliteId)
    : visibleSatellites;
  const pointSatellites = pointRenderingActive
    ? visibleSatellites.filter((satellite) => satellite.id !== selectedSatelliteId)
    : [];
  const populationPointSatellites = pointRenderingActive ? visibleSatellites : [];
  const regimeCatalogFrame =
    explorerFocusPreset === "earth-orbit" ||
    explorerFocusPreset === "leo" ||
    explorerFocusPreset === "meo" ||
    explorerFocusPreset === "geo";
  const wideCatalogFrame =
    explorerFocusPreset === "earth-orbit" ||
    explorerFocusPreset === "meo" ||
    explorerFocusPreset === "geo";
  const selectedSatellitePointContextActive = Boolean(selectedSatelliteId);
  const selectedObjectPointContextActive =
    selectedSatellitePointContextActive || (Boolean(selectedConstellation) && !regimeCatalogFrame);
  const pointCloudAnimate = explorerAnimate && isPlaying;
  const priorityPointSatellites =
    scaleCatalogRendering && selectedConstellation
      ? pointSatellites.filter((satellite) => selectedConstellationMemberIds.has(satellite.id))
      : [];
  const groundTrackSatellites =
    playgroundPresentation && selectedSatellite
      ? detailedSatellites.filter((satellite) => satellite.id === selectedSatellite.id)
      : detailedSatellites;
  const backgroundPointSatellites =
    scaleCatalogRendering
      ? populationPointSatellites.filter(
          (satellite) => !selectedConstellationMemberIds.has(satellite.id),
        )
      : populationPointSatellites;
  const hiddenPointSatelliteIds = useMemo(
    () => selectedSatelliteId ? new Set([selectedSatelliteId]) : undefined,
    [selectedSatelliteId],
  );
  const isPrioritySatellite = (satelliteId: string) =>
    satelliteId === selectedSatelliteId || Boolean(activeConstellation?.satelliteIds.includes(satelliteId));
  const visibleStations = scenario.groundStations.filter((station) => {
    if (explorerGroundStationIdSet) {
      return explorerGroundStationIdSet.has(station.id);
    }

    return workspace.visibilityFilters.selectedOnly
      ? station.id === selectedGroundStationId
      : workspace.visibilityFilters.stations;
  });
  const explorerFocusFrame = useMemo<CameraFocusFrame | null>(() => {
    if (catalogOnlyExplorerScene) {
      return createCatalogOnlyEarthFocusFrame({
        simulationEpoch: scenario.simulationEpoch,
        focusPreset: explorerFocusPreset,
        requestKey: explorerFocusRequestKey,
        viewDirection: EXPLORER_OBLIQUE_VIEW_DIRECTION,
      });
    }

    if (!explorerFocusPreset || explorerFocusPreset === "orbit") return null;

    const date = new Date(scenario.simulationEpoch);
    const satelliteFrameKey = (satellites: typeof visibleSatellites) => {
      let hash = 0;
      satellites.forEach((satellite) => {
        for (let index = 0; index < satellite.id.length; index += 1) {
          hash = (hash * 31 + satellite.id.charCodeAt(index)) >>> 0;
        }
      });
      return `${satellites.length}:${hash.toString(36)}`;
    };
    const positionFor = (satellite: (typeof scenario.satellites)[number]) => {
      try {
        return eciToThreeVector(propagateSatellite(satellite, date).positionKm);
      } catch {
        return null;
      }
    };
    const earthCenteredFrame = (
      satellites: typeof visibleSatellites,
      key: string,
      minimumFramingRadiusKm = EARTH_RADIUS_KM * 1.25,
      maximumContextRadiusKm = Number.POSITIVE_INFINITY,
    ): CameraFocusFrame => {
      const radii = satellites
        .map(
          (satellite) =>
            satellite.keplerian.semiMajorAxisKm * (1 + satellite.keplerian.eccentricity),
        )
        .filter((radiusKm) => radiusKm <= maximumContextRadiusKm);

      return {
        key: `${key}:${satelliteFrameKey(satellites)}:${explorerFocusRequestKey}`,
        target: new Vector3(),
        framingRadiusKm: Math.max(minimumFramingRadiusKm, ...radii) * 1.06,
      };
    };
    if (explorerFocusPreset === "object") {
      if (selectedSatellite) {
        const target = positionFor(selectedSatellite);
        if (target) {
          const radial = target.clone().normalize();
          const tangent = radial.clone().cross(EARTH_FIXED_AXIS);
          if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
          tangent.normalize();
          const contextCenterDistance = Math.max(0, target.length() - EARTH_RADIUS_KM) * 0.5;
          const contextCenter = radial.clone().multiplyScalar(contextCenterDistance);
          const contextRadius = Math.max(
            EARTH_RADIUS_KM * 1.55,
            EARTH_RADIUS_KM + contextCenter.length(),
            target.distanceTo(contextCenter) + 1_200,
          ) * 1.12;
          return {
            key: `object:${selectedSatellite.id}:${scenario.simulationEpoch}:${explorerFocusRequestKey}`,
            target: contextCenter,
            framingRadiusKm: contextRadius,
            viewDirection: radial
              .multiplyScalar(0.5)
              .add(tangent.multiplyScalar(0.82))
              .add(new Vector3(0, 0.16, 0))
              .normalize(),
          };
        }
      }

      if (selectedGroundStation) {
        return {
          key: `station:${selectedGroundStation.id}:${scenario.simulationEpoch}:${explorerFocusRequestKey}`,
          target: latLonToThreeVector(
            selectedGroundStation,
            EARTH_RADIUS_KM + selectedGroundStation.altitudeMeters / 1000,
          ),
          framingRadiusKm: 1_800,
        };
      }
    }

    if (explorerFocusPreset === "constellation" && selectedConstellation) {
      const memberIds = new Set(selectedConstellation.satelliteIds);
      return earthCenteredFrame(
        scenario.satellites.filter((satellite) => memberIds.has(satellite.id)),
        `constellation:${selectedConstellation.id}:${scenario.simulationEpoch}`,
      );
    }

    if (explorerFocusPreset === "leo") {
      return {
        key: `leo:${scenario.simulationEpoch}:${explorerFocusRequestKey}`,
        target: new Vector3(),
        framingRadiusKm: EARTH_RADIUS_KM * 1.8,
      };
    }

    if (explorerFocusPreset === "meo") {
      return {
        key: `meo:${scenario.simulationEpoch}:${explorerFocusRequestKey}`,
        target: new Vector3(),
        framingRadiusKm: GPS_ORBIT_RADIUS_KM * 1.08,
      };
    }

    if (explorerFocusPreset === "geo") {
      return {
        key: `geo:${scenario.simulationEpoch}:${explorerFocusRequestKey}`,
        target: new Vector3(),
        framingRadiusKm: GEO_ORBIT_RADIUS_KM * 0.92,
        viewDirection: sunDirection.clone().add(new Vector3(0, 0.2, 0)).normalize(),
      };
    }

    return {
      key: `earth-orbit:${scenario.simulationEpoch}:${explorerFocusRequestKey}`,
      target: new Vector3(),
      framingRadiusKm: EARTH_RADIUS_KM * 1.42,
      viewDirection: EXPLORER_OBLIQUE_VIEW_DIRECTION,
    };
  }, [
    catalogOnlyExplorerScene,
    explorerFocusPreset,
    explorerFocusRequestKey,
    scenario.satellites,
    scenario.simulationEpoch,
    selectedConstellation,
    selectedGroundStation,
    selectedOrbitFrame,
    selectedSatellite,
    sunDirection,
    visibleSatellites,
  ]);
  const autoSelectionFocusFrame = useMemo<CameraFocusFrame | null>(() => {
    if (!autoFrameSelections || explorerFocusPreset) return null;

    if (selectedConstellation) {
      const memberIds = new Set(selectedConstellation.satelliteIds);
      const members = scenario.satellites.filter((satellite) => memberIds.has(satellite.id));
      const radii = members.map(
        (satellite) =>
          satellite.keplerian.semiMajorAxisKm * (1 + satellite.keplerian.eccentricity),
      );
      const representativeRadius = selectedConstellationFrameSatellite
        ? selectedConstellationFrameSatellite.keplerian.semiMajorAxisKm *
          (1 + selectedConstellationFrameSatellite.keplerian.eccentricity)
        : EARTH_RADIUS_KM * 1.25;

      return {
        key: `sandbox-constellation:${selectedConstellation.id}:${scenario.simulationEpoch}`,
        target: new Vector3(),
        framingRadiusKm: Math.max(EARTH_RADIUS_KM * 1.25, representativeRadius, ...radii) * 1.08,
      };
    }

    if (selectedGroundStation) {
      return {
        key: `sandbox-station:${selectedGroundStation.id}:${scenario.simulationEpoch}`,
        target: latLonToThreeVector(
          selectedGroundStation,
          EARTH_RADIUS_KM + selectedGroundStation.altitudeMeters / 1000,
        ),
        framingRadiusKm: 1_800,
      };
    }

    return null;
  }, [
    autoFrameSelections,
    explorerFocusPreset,
    scenario.satellites,
    scenario.simulationEpoch,
    selectedConstellation,
    selectedConstellationFrameSatellite,
    selectedGroundStation,
  ]);
  const activeFocusFrame = explorerFocusFrame ?? autoSelectionFocusFrame;
  const labelSources = useMemo(() => {
    const sources: LabelSource[] = [];

    if (missionFrame?.moonVisible) {
      sources.push({
        id: "mission:moon",
        kind: "validation",
        text: "Moon",
        detail: missionFrame.primaryBody === "Moon" ? "Mission focus" : "Mission body",
        position: new Vector3(...missionFrame.moonPositionKm),
        priority: 96,
      });
    }

    if (missionFrame?.spacecraftVisible) {
      sources.push({
        id: "mission:spacecraft",
        kind: "satellite",
        text: missionFrame.spacecraftLabel,
        detail: missionFrame.distanceLabel,
        position: new Vector3(...missionFrame.spacecraftPositionKm),
        priority: 100,
        selected: true,
      });
    }

    if (workspace.labelMode === "hidden") {
      return sources;
    }

    const date = new Date(scenario.simulationTimeUtc);
    const earthRotation = computeCelestialState(date).earthFixedToSceneQuaternion;
    const targetConstellation = scenario.constellations.find(
      (constellation) => constellation.id === scenario.coverageSettings.targetId,
    );
    const coverageTarget = targetSetForCoverage(
      scenario.coverageSettings,
      scenario.satellites,
      scenario.groundStations,
      targetConstellation?.satelliteIds ?? [],
    );
    const coverageEnabled =
      scenario.renderSettings.showCoverageLayer && scenario.coverageSettings.enabled;
    const earthFixedToWorld = (position: Vector3) =>
      position.clone().applyQuaternion(earthRotation);
    visibleSatellites.forEach((satellite) => {
      const selected = satellite.id === selectedSatelliteId;
      const hovered =
        hoveredLabelTarget?.kind === "satellite" && hoveredLabelTarget.id === satellite.id;
      const show = selected || hovered || workspace.labelMode === "all";

      if (!show || !satellite.visualization.visible) {
        return;
      }

      try {
        sources.push({
          id: `satellite:${satellite.id}`,
          kind: "satellite",
          text: satellite.name,
          position: eciToThreeVector(propagateSatellite(satellite, date).positionKm),
          getPosition: () =>
            eciToThreeVector(
              propagateSatellite(satellite, new Date(readScenePlaybackTimeMs())).positionKm,
            ),
          priority: selected ? 100 : hovered ? 90 : 24,
          selected,
          hovered,
        });
      } catch {
        // Ignore labels for satellites whose propagation data is currently invalid.
      }
    });

    visibleStations.forEach((station) => {
      const selected = station.id === selectedGroundStationId;
      const hovered = hoveredLabelTarget?.kind === "station" && hoveredLabelTarget.id === station.id;
      const show =
        selected ||
        hovered ||
        workspace.labelMode === "all" ||
        (workspace.labelMode === "priority" && station.showCoverageCone);

      if (!show || !station.visible) {
        return;
      }

      sources.push({
        id: `station:${station.id}`,
        kind: "station",
        text: station.name,
        position: earthFixedToWorld(
          latLonToThreeVector(
            {
              latitudeDeg: station.latitudeDeg,
              longitudeDeg: station.longitudeDeg,
            },
            EARTH_RADIUS_KM + station.altitudeMeters / 1000 + 120,
          ),
        ),
        priority: selected ? 100 : hovered ? 90 : station.showCoverageCone ? 54 : 38,
        selected,
        hovered,
      });
    });

    scenario.regions
      .filter((region) => region.visible && (!workspace.visibilityFilters.selectedOnly || region.id === selectedRegionId))
      .forEach((region) => {
        const selected = region.id === selectedRegionId;
        const hovered = hoveredLabelTarget?.kind === "region" && hoveredLabelTarget.id === region.id;
        const currentCoverage = computeRegionCoverage(
          region,
          coverageTarget,
          scenario.coverageSettings,
          date,
        );
        const covered = coverageEnabled && currentCoverage.visibleNow;
        const show =
          region.showLabel &&
          (selected ||
            hovered ||
            workspace.labelMode === "all" ||
            (workspace.labelMode === "priority" && (covered || scenario.teacherMode)));

        if (!show) {
          return;
        }

        const center = regionCenter(region);
        sources.push({
          id: `region:${region.id}`,
          kind: "region",
          text: region.name,
          detail: coverageEnabled ? coverageLabel(currentCoverage.coveredPercent) : "Region",
          position: earthFixedToWorld(latLonToThreeVector(center, EARTH_RADIUS_KM + 140)),
          priority: selected ? 100 : hovered ? 90 : covered ? 62 : 48,
          selected,
          hovered,
        });
      });

    if (scenario.renderSettings.showGeoValidationOverlay) {
      GEO_VALIDATION_POINTS.forEach((point) => {
        sources.push({
          id: `validation:${point.id}`,
          kind: "validation",
          text: point.name,
          detail: `${point.latitudeDeg.toFixed(4)}, ${point.longitudeDeg.toFixed(4)}`,
          position: earthFixedToWorld(latLonToThreeVector(point, EARTH_RADIUS_KM + 170)),
          priority: point.kind === "dsn" ? 88 : 82,
        });
      });
    }

    return sources;
  }, [
    hoveredLabelTarget,
    missionFrame,
    scenario,
    selectedGroundStationId,
    selectedRegionId,
    selectedSatelliteId,
    visibleSatellites,
    visibleStations,
    workspace.labelMode,
    workspace.visibilityFilters.selectedOnly,
  ]);

  return (
    <div className="scene-shell">
      <Canvas
        dpr={[
          1,
          Math.min(
            dprForQuality(scenario.renderSettings.quality),
            scaleCatalogRendering ? 1.35 : playgroundPresentation ? 1 : 2,
          ),
        ]}
        frameloop={isPlaying ? "always" : "demand"}
        fallback={<RendererCanvasFallback />}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
        onPointerMissed={(event) => {
          if (event.button === 0) onClearSelection?.();
        }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace;
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.04;
        }}
        camera={{
          position: [
            initialCameraFrame.position.x,
            initialCameraFrame.position.y,
            initialCameraFrame.position.z,
          ],
          near: 20,
          fov: initialCameraFrame.fov,
          far: missionFrame ? EARTH_RADIUS_KM * 90 : EARTH_RADIUS_KM * 40,
        }}
      >
        <SceneMotionClock />
        <SceneSunDirection earthToSunWorldRef={earthToSunWorldRef} />
        <color attach="background" args={["#05070b"]} />
        <fog attach="fog" args={["#05070b", sceneFogNear, sceneFogFar]} />

        <ambientLight intensity={0.025} />
        <SceneSunLight earthToSunWorldRef={earthToSunWorldRef} />
        <SceneSunVisual earthToSunWorldRef={earthToSunWorldRef} />
        {!missionFrame && <SceneMoonVisual />}
        {showStarField && (
          <StarField
            quality={scenario.renderSettings.quality}
            emphasis={scaleCatalogRendering ? 3.35 : 1.25}
          />
        )}
        {!missionFrame && <SceneDepthCue broad={broadRegimeFrame} />}
        {missionFrame && <MissionFrameObjects missionFrame={missionFrame} />}
        {!scenario.teacherMode && scenario.renderSettings.showEciGrid && (
          <gridHelper
            args={[EARTH_RADIUS_KM * 8, 32, "#16454d", "#0a1720"]}
            position={[0, 0, 0]}
          />
        )}
        <Earth
          renderSettings={earthRenderSettings}
          simulationTimeUtc={scenario.simulationTimeUtc}
          earthToSunWorldRef={earthToSunWorldRef}
          visualPreset={
            scaleCatalogRendering
              ? "catalog-focus"
              : playgroundPresentation ? "orbit-focus" : earthVisualPreset
          }
          visualEmphasis={selectedOrbitFrame?.earthEmphasis ?? 1}
          onLiveLayerStatus={setEarthLiveLayerStatus}
        >
          <AuroraRenderer enabled={auroraModeEnabled} />
          {scenario.renderSettings.showLatLonGrid && <LatLonGrid />}
          {scenario.renderSettings.showGeoValidationOverlay && <GeoValidationOverlay />}
          {groundTrackSatellites.map((satellite) => (
            <GroundTrackLine
              key={`ground-${satellite.id}`}
              satellite={satellite}
              simulationTime={scenario.simulationTimeUtc}
              quality={scenario.renderSettings.quality}
              priority={isPrioritySatellite(satellite.id)}
            />
          ))}
          {detailedSatellites.map((satellite) => (
            <SensorFootprint
              key={`sensor-footprint-${satellite.id}`}
              satellite={satellite}
              simulationTime={scenario.simulationTimeUtc}
              priority={isPrioritySatellite(satellite.id)}
            />
          ))}
          {visibleStations.map((station) => (
            <GroundStationMarker
              key={station.id}
              station={station}
              selected={station.id === selectedGroundStationId}
              onSelect={selectGroundStation}
              onHover={(stationId) =>
                setHoveredLabelTarget(stationId ? { kind: "station", id: stationId } : null)
              }
              colorOverride={explorerMarkerStyles?.get(station.id)?.color}
            />
          ))}
          {workspace.visibilityFilters.regions && (
            <RegionLayer
              scenario={scenario}
              selectedRegionId={selectedRegionId}
              selectedOnly={workspace.visibilityFilters.selectedOnly}
              onSelect={selectRegion}
              onHover={(regionId) =>
                setHoveredLabelTarget(regionId ? { kind: "region", id: regionId } : null)
              }
            />
          )}
          {!scenario.teacherMode && scenario.renderSettings.showEcefGrid && (
            <gridHelper args={[EARTH_RADIUS_KM * 6, 24, "#294458", "#0e1924"]} />
          )}
        </Earth>
        <ContactLine
          satellite={selectedSatellite}
          station={selectedGroundStation}
          simulationTime={scenario.simulationTimeUtc}
        />
        {detailedSatellites.map((satellite) => (
          <OrbitPath
            key={`orbit-${satellite.id}`}
            satellite={satellite}
            simulationTime={scenario.simulationTimeUtc}
            quality={scenario.renderSettings.quality}
            priority={isPrioritySatellite(satellite.id)}
            selected={satellite.id === selectedSatelliteId}
            selectedOrbitFrame={selectedOrbitFrame}
            orbitAwareFraming={orbitAwareFraming}
            expressive={playgroundPresentation}
            visible={
              orbitAwareFraming
                ? satellite.id === selectedSatelliteId && explorerSelectedOrbitVisible
                : undefined
            }
          />
        ))}
        {(orbitAwareFraming || (scaleCatalogRendering && selectedConstellation)) && (
          <ConstellationOrbitShells
            orbitConstellationIds={
              orbitAwareFraming ? representativeOrbitConstellationIds : []
            }
            shellConstellationIds={orbitAwareFraming ? shellConstellationIds : []}
            constellations={scenario.constellations}
            selectedConstellationId={
              scaleCatalogRendering
                ? selectedConstellation?.id ?? null
                : selectedArchitectureConstellationId
            }
            satellites={scenario.satellites}
            simulationTime={scenario.simulationTimeUtc}
            quality={scenario.renderSettings.quality}
          />
        )}
        {detailedSatellites.map((satellite) => (
          <SensorCone
            key={`sensor-cone-${satellite.id}`}
            satellite={satellite}
            simulationTime={scenario.simulationTimeUtc}
            priority={isPrioritySatellite(satellite.id)}
          />
        ))}
        <EducationalOverlays
          overlay={scenario.renderSettings.educationalOverlay}
          satellite={selectedSatellite}
          simulationTime={scenario.simulationTimeUtc}
        />
        {pointRenderingActive && !scaleCatalogRendering && (
          <ExplorerSatellitePoints
            satellites={backgroundPointSatellites}
            markerStyles={explorerMarkerStyles}
            animate={pointCloudAnimate}
            simulationTime={scenario.simulationTimeUtc}
            playbackTimeScale={playbackTimeScale}
            hiddenSatelliteIds={hiddenPointSatelliteIds}
            cacheSatelliteIds={hiddenPointSatelliteIds}
            size={selectedSatellitePointContextActive ? 32 : undefined}
            opacity={selectedSatellitePointContextActive ? 0.1 : undefined}
            colorMultiplier={selectedSatellitePointContextActive ? 0.44 : undefined}
            desaturate={selectedSatellitePointContextActive ? 0.78 : undefined}
            onSelect={selectSatellite}
            onHover={(satelliteId) =>
              setHoveredLabelTarget(satelliteId ? { kind: "satellite", id: satelliteId } : null)
            }
          />
        )}
        {scaleCatalogRendering && (
          <ExplorerSatellitePoints
            diagnosticsBatchId="explorer-population-background"
            satellites={backgroundPointSatellites}
            markerStyles={explorerMarkerStyles}
            animate={pointCloudAnimate}
            simulationTime={scenario.simulationTimeUtc}
            playbackTimeScale={playbackTimeScale}
            hiddenSatelliteIds={hiddenPointSatelliteIds}
            cacheSatelliteIds={hiddenPointSatelliteIds}
            updateIntervalMs={64}
            size={
              selectedSatellitePointContextActive
                ? regimeCatalogFrame ? 2.1 : 34
                : selectedObjectPointContextActive
                  ? 46
                : regimeCatalogFrame
                  ? explorerFocusPreset === "leo"
                    ? explorerColorMode === "constellation" ? 4.4 : 4.1
                    : explorerFocusPreset === "geo"
                      ? explorerColorMode === "constellation" ? 5.4 : 5
                      : explorerFocusPreset === "earth-orbit"
                        ? explorerColorMode === "constellation" ? 5 : 4.6
                        : explorerColorMode === "constellation" ? 4.8 : 4.4
                : explorerColorMode === "constellation"
                  ? wideCatalogFrame ? 2.4 : 92
                  : explorerColorMode === "white"
                    ? wideCatalogFrame ? 1.9 : 78
                    : wideCatalogFrame ? 1.8 : 74
            }
            sizeAttenuation={!regimeCatalogFrame}
            opacity={
              selectedSatellitePointContextActive
                ? regimeCatalogFrame ? 0.075 : 0.12
                : selectedObjectPointContextActive
                  ? 0.22
                : explorerColorMode === "constellation"
                  ? 0.82
                  : explorerFocusPreset === "earth-orbit" ? 0.78 : regimeCatalogFrame ? 0.74 : 0.54
            }
            colorMultiplier={
              selectedSatellitePointContextActive
                ? 0.44
                : selectedObjectPointContextActive
                  ? 0.52
                : explorerColorMode === "constellation"
                  ? 1.12
                  : explorerFocusPreset === "earth-orbit" ? 1.08 : 1.02
            }
            desaturate={
              selectedSatellitePointContextActive
                ? 0.78
                : selectedObjectPointContextActive ? 0.62 : explorerColorMode === "type" ? 0.1 : 0
            }
            onSelect={selectSatellite}
            onHover={(satelliteId) =>
              setHoveredLabelTarget(satelliteId ? { kind: "satellite", id: satelliteId } : null)
            }
          />
        )}
        {scaleCatalogRendering && priorityPointSatellites.length > 0 && (
          <ExplorerSatellitePoints
            diagnosticsBatchId="explorer-population-priority"
            satellites={priorityPointSatellites}
            markerStyles={explorerMarkerStyles}
            animate={pointCloudAnimate}
            simulationTime={scenario.simulationTimeUtc}
            playbackTimeScale={playbackTimeScale}
            cacheSatelliteIds={hiddenPointSatelliteIds}
            updateIntervalMs={64}
            size={104}
            opacity={0.86}
            colorMultiplier={1.08}
            onSelect={selectSatellite}
            onHover={(satelliteId) =>
              setHoveredLabelTarget(satelliteId ? { kind: "satellite", id: satelliteId } : null)
            }
          />
        )}
        {detailedSatellites.map((satellite) => (
          <SatelliteMarker
            key={satellite.id}
            satellite={satellite}
            simulationTime={scenario.simulationTimeUtc}
            selected={satellite.id === selectedSatelliteId}
            onSelect={selectSatellite}
            onHover={(satelliteId) =>
              setHoveredLabelTarget(satelliteId ? { kind: "satellite", id: satelliteId } : null)
            }
            selectedOrbitFrame={selectedOrbitFrame}
            orbitAwareFraming={orbitAwareFraming}
            architectureFocus={Boolean(selectedArchitectureConstellationId)}
            staticPosition={orbitAwareFraming && !explorerAnimate}
            colorOverride={explorerMarkerStyles?.get(satellite.id)?.color}
            hero={playgroundPresentation}
          />
        ))}
        {workspace.visibilityFilters.catalog && (
          <CatalogPoints
            layers={scenario.catalogLayers}
            selectedObjectId={selectedCatalogObjectId}
            selectedOnly={workspace.visibilityFilters.selectedOnly}
            simulationTime={scenario.simulationTimeUtc}
            onSelect={selectCatalogObject}
          />
        )}
        <CameraRig
          viewPreset={scenario.cameraSettings.viewPreset}
          cameraMode={scenario.cameraSettings.cameraMode}
          followSelectedObject={scenario.cameraSettings.followSelectedObject}
          missionFrame={missionFrame}
          selectedSatellite={selectedSatellite}
          selectedOrbitFrame={
            activeFocusFrame || (explorerFocusPreset && explorerFocusPreset !== "orbit")
              ? null
              : selectedOrbitFrame
                ? {
                    ...selectedOrbitFrame,
                    key: `${selectedOrbitFrame.key}:${explorerFocusRequestKey}`,
                  }
                : null
          }
          focusFrame={activeFocusFrame}
          selectedOrbitDistanceScale={playgroundPresentation ? 1.5 : 1}
          defaultFrame={initialCameraFrame}
          simulationTime={scenario.simulationTimeUtc}
          viewportMode={viewportMode}
        />
        <LabelProjector sources={labelSources} onLabelsChange={setScreenLabels} />
        <StarOcclusionDiagnosticsProjector
          enabled={scenario.renderSettings.showStarOcclusionDiagnostics}
          quality={scenario.renderSettings.quality}
          onDiagnosticsChange={setStarDiagnostics}
        />
        {showCelestialDiagnostics && (
          <CelestialDiagnosticsProbe earthToSunWorldRef={earthToSunWorldRef} />
        )}
      </Canvas>
      {showCelestialDiagnostics && <CelestialDiagnosticsPanel />}
      <StarOcclusionDiagnosticsOverlay diagnostics={starDiagnostics} />
      <LabelOverlay
        labels={screenLabels}
        coverageLegendVisible={scenario.renderSettings.educationalOverlay === "coverage"}
      />
      {showVisualContextLegend && (
        <div className="scene-context-legend" aria-label="Non-interactive visual layers">
          <i />
          <span>Star field · visual context</span>
        </div>
      )}
    </div>
  );
}
