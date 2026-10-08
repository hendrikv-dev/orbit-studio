import { BellRing, Camera, CameraOff, Compass, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import {
  calibratedDevicePose, devicePoseFromOrientationWithHeading, devicePoseLookingAt,
  DevicePoseStabilizer, edgeCueForProjection, effectiveCameraProjection, horizontalToEnu,
  normalizeDegrees, pointingFromDevicePose, projectEnuDirection, SKY_HORIZONTAL_FOV_DEG,
  SKY_VERTICAL_FOV_DEG, type CameraProjectionModel, type DevicePose,
} from "../../astronomy/topocentricSky";
import {
  alignmentFor, calibrationFromAlignment, canRequestSkyFinderPermission, describeTargetAltitude,
  detectSkyFinderCapabilities, guidanceForSkyTarget, nextRiseForSkyFinderTarget,
  positionForSkyFinderTarget, solutionForSkyFinderTarget, supportsRenderedSky,
  type FinderCalibration, type FinderCapabilities, type PhonePointing, type PointingQuality,
  type SkyFinderTarget,
} from "../../data/tracker/skyFinder";
import {
  filterSkySearch, skySearchCatalog, skyTargetEquipmentLabel, stationSearchEntries,
  type SkySearchEntry,
} from "../../data/tracker/skyExplorer";
import {
  initialSkyNavigationMode,
  selectNonCollidingSkyLabels,
  skyDensityForView,
  type SkyNavigationMode,
} from "../../data/tracker/skyPresentation";
import type { CrewedStationEphemeris } from "../../data/tracker/satelliteSources";
import {
  loadSatelliteAlertPreferences, saveSatelliteAlertPreferences,
  type SatelliteAlertCategory, type SatelliteAlertLeadMinutes, type SatelliteAlertPreferences,
} from "../../data/tracker/satelliteAlerts";
import type { ExpectedSkyContext } from "../../data/tracker/skyFinderContext";
import { skyMarkerKindForTarget, type SkyMarkerKind } from "../../data/tracker/skyMarker";
import { lunarPhaseAt } from "../../data/tracker/lunarPhase";
import { CelestialMilkyWay } from "./CelestialMilkyWay";

type PermissionPhase = "idle" | "requesting" | "granted" | "denied" | "unavailable";
type CameraPhase = "idle" | "requesting" | "active" | "denied" | "unavailable";

interface Props {
  target: SkyFinderTarget | null;
  references: SkyFinderTarget[];
  stations?: CrewedStationEphemeris[];
  observer: { latitudeDeg: number; longitudeDeg: number; label: string };
  clock: PlaceClock;
  at: Date;
  liveDate: boolean;
  launch?: SkyFinderLaunchAttempt | null;
  onClose: () => void;
}

interface SafariOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

interface OrientationTelemetry {
  alphaDeg: number;
  betaDeg: number;
  gammaDeg: number;
  screenOrientationDeg: number;
  magneticHeadingDeg: number | null;
  compassAccuracyDeg: number | null;
  absolute: boolean;
}

interface PermissionConstructor { requestPermission?: () => Promise<"granted" | "denied">; }
type LaunchSensorResult = "granted" | "denied" | "unavailable";

// Read once before URL-backed navigation normalizes the query. The flag is
// localhost-only below and never becomes a consumer preference or persisted
// product state.
const INITIAL_SKY_DIAGNOSTICS_REQUESTED = typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("skyDiagnostics") === "1";

export interface SkyFinderLaunchAttempt {
  targetId: string | null;
  sensor: Promise<LaunchSensorResult>;
  camera: null;
}

function permissionConstructor(name: "DeviceOrientationEvent" | "DeviceMotionEvent") {
  return (window[name] as unknown as PermissionConstructor | undefined) ?? null;
}

/** Camera permission belongs only to the explicit Camera toggle. */
export function beginSkyFinderLaunch(targetId: string | null, capabilities: FinderCapabilities, liveDate: boolean): SkyFinderLaunchAttempt | null {
  if (!supportsRenderedSky(capabilities) || !liveDate || !capabilities.orientation) return null;
  let request: Promise<"granted" | "denied">;
  try {
    const orientation = permissionConstructor("DeviceOrientationEvent");
    request = orientation?.requestPermission
      ? Promise.resolve(orientation.requestPermission()).then((answer) => answer ?? "denied")
      : Promise.resolve("granted");
  } catch { request = Promise.resolve("denied"); }
  try {
    const motion = permissionConstructor("DeviceMotionEvent");
    if (motion?.requestPermission && canRequestSkyFinderPermission(capabilities, "motion", { liveDate, userInitiated: true })) {
      void motion.requestPermission().catch(() => "denied");
    }
  } catch { /* Orientation alone remains useful. */ }
  return { targetId, sensor: request.then((answer) => answer === "granted" ? "granted" : "denied"), camera: null };
}

function screenAngle(): number {
  const modern = window.screen.orientation?.angle;
  if (typeof modern === "number") return modern;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

function cardinal(azimuthDeg: number): string {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(normalizeDegrees(azimuthDeg) / 45) % labels.length];
}

function skyPhase(sunAltitudeDeg: number | null): "day" | "civil" | "twilight" | "night" {
  if (sunAltitudeDeg === null || sunAltitudeDeg < -18) return "night";
  if (sunAltitudeDeg < -6) return "twilight";
  if (sunAltitudeDeg < 0) return "civil";
  return "day";
}

function lunarLightPath(fraction: number, waxing: boolean): string {
  const k = Math.max(-1, Math.min(1, fraction * 2 - 1));
  const control = waxing ? 16 - k * 12 : 16 + k * 12;
  const limbSweep = waxing ? 1 : 0;
  return `M16 7 A9 9 0 0 ${limbSweep} 16 25 C${control} 25 ${control} 7 16 7 Z`;
}

/**
 * A Catmull-Rom-to-cubic display transform keeps the original artwork family
 * organic while every curve still passes through its real-star-derived
 * anchors. This changes only the line between authoritative anchor points.
 */
function skyFigurePathData(
  points: readonly { xPercent: number; yPercent: number }[],
  closed: boolean,
): string {
  if (points.length === 0) return "";
  if (points.length < 3) {
    return [`M ${points[0].xPercent} ${points[0].yPercent}`, ...points.slice(1).map((point) => `L ${point.xPercent} ${point.yPercent}`)].join(" ");
  }
  const get = (index: number) => {
    if (closed) return points[(index + points.length) % points.length];
    return points[Math.max(0, Math.min(points.length - 1, index))];
  };
  const commands = [`M ${points[0].xPercent} ${points[0].yPercent}`];
  const segmentCount = closed ? points.length : points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const before = get(index - 1);
    const start = get(index);
    const end = get(index + 1);
    const after = get(index + 2);
    const c1x = start.xPercent + (end.xPercent - before.xPercent) / 6;
    const c1y = start.yPercent + (end.yPercent - before.yPercent) / 6;
    const c2x = end.xPercent - (after.xPercent - start.xPercent) / 6;
    const c2y = end.yPercent - (after.yPercent - start.yPercent) / 6;
    commands.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${end.xPercent} ${end.yPercent}`);
  }
  if (closed) commands.push("Z");
  return commands.join(" ");
}

function SkyMarkerGlyph({ kind, label, phase = 0.5, waxing = true }: { kind: SkyMarkerKind; label?: string; phase?: number; waxing?: boolean }) {
  const markerId = useId().replace(/:/g, "");
  const art = (() => {
    switch (kind) {
      case "sun": return <><defs><radialGradient id={`${markerId}-sun`} cx="38%" cy="34%" r="68%"><stop offset="0" stopColor="#fff8c8" /><stop offset="0.42" stopColor="#ffd968" /><stop offset="1" stopColor="#f29d2e" /></radialGradient></defs><circle className="solar-atmosphere" cx="16" cy="16" r="13" /><circle className="solar-corona" cx="16" cy="16" r="10" /><circle className="solar-disc" cx="16" cy="16" r="7.2" style={{ fill: `url(#${markerId}-sun)` }} /><g className="solar-faculae"><circle cx="12.5" cy="13" r=".55" /><circle cx="18.8" cy="16.2" r=".42" /><circle cx="15.3" cy="19.4" r=".34" /></g></>;
      case "moon": return <><defs><clipPath id={`${markerId}-moon`}><circle cx="16" cy="16" r="9" /></clipPath><clipPath id={`${markerId}-phase`}><path d={lunarLightPath(phase, waxing)} /></clipPath></defs><circle className="moon-night" cx="16" cy="16" r="9.35" /><g clipPath={`url(#${markerId}-moon)`}><image className="moon-texture moon-texture-muted" href="/moon/nasa-lroc-color-1k.jpg" x="7" y="7" width="18" height="18" preserveAspectRatio="xMidYMid slice" /><path className="moon-lit-base" d={lunarLightPath(phase, waxing)} /><image className="moon-texture" href="/moon/nasa-lroc-color-1k.jpg" x="7" y="7" width="18" height="18" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${markerId}-phase)`} /></g><circle className="moon-rim" cx="16" cy="16" r="9" /></>;
      case "saturn": return <><ellipse className="saturn-ring-back" cx="16" cy="16" rx="13" ry="4.5" transform="rotate(-12 16 16)" /><circle className="saturn-disc" cx="16" cy="16" r="6.4" /><path className="saturn-band" d="M10.1 14.2c3.8 1 7.9 1 11.8-.1M10 17.4c3.8 1.1 8 1 12-.2" /><path className="saturn-ring-front" d="M3.5 17.3c2.4 4.2 11.3 4.7 19.3 1.2 4.7-2 7-4.9 5.6-6.5" /></>;
      case "jupiter": return <><circle className="jupiter-disc" cx="16" cy="16" r="9" /><path className="jupiter-zone jupiter-zone-one" d="M8.6 10.8c4.8 1.1 9.9 1.2 14.8.1" /><path className="jupiter-zone jupiter-zone-two" d="M7.3 14.4c5.7 1.5 11.7 1.5 17.4 0M7.7 19c5.4-1 10.9-.9 16.4.2" /><ellipse className="jupiter-spot" cx="20.4" cy="17.1" rx="2.1" ry="1.15" /></>;
      case "venus": return <><circle className="venus-disc" cx="16" cy="16" r="8" /><path className="venus-cloud" d="M10.2 12.4c3.4-2 7.8-2 11.3.1M9 16.5c4 1.4 8.6 1.5 13.9.1M11 20.4c3.1-1.2 6.7-1.2 9.8 0" /><path className="planet-shade" d="M18.7 8.5c-5.2 1.5-7.2 7.8-3.6 12 1.2 1.4 2.7 2.2 4.4 2.5" /></>;
      case "mercury": return <><circle className="mercury-disc" cx="16" cy="16" r="7.2" /><circle className="mercury-crater" cx="12.4" cy="13" r="1.5" /><circle className="mercury-crater" cx="18.8" cy="18" r="1.1" /><path className="planet-shade" d="M17.9 9c-4.5.9-6.6 5.8-4.5 9.8 1 2 2.7 3.3 4.9 3.8" /></>;
      case "mars": return <><circle className="mars-disc" cx="16" cy="16" r="7.7" /><path className="mars-terrain" d="M9.5 13c2.6-2.4 5.4-.5 7-1.4 2.2-1.2 4.5.1 6 2.1M12.1 20.8c1.9-1.4 4.4-1.6 6.7-.6" /><path className="mars-cap" d="M12.6 9.5c2.2-.9 4.7-.9 6.8.1" /></>;
      case "uranus": return <><circle className="uranus-disc" cx="16" cy="16" r="7.8" /><path className="uranus-band" d="M10 11.7c4 1.2 8 1.2 12 0M9.2 16c4.5 1 9 1 13.6 0M10 20.3c4 1 8 1 12 0" /></>;
      case "neptune": return <><circle className="neptune-disc" cx="16" cy="16" r="7.8" /><path className="neptune-band" d="M9.2 13.2c4.4 1.1 9 1.1 13.6 0M10 18.4c4 1 8 1 12 0" /><ellipse className="neptune-storm" cx="19.5" cy="16.5" rx="1.5" ry=".8" /></>;
      case "pluto": return <><circle className="pluto-disc" cx="16" cy="16" r="5.4" /><path className="pluto-detail" d="M12.6 14.2c1.9-1.8 4.7-1.8 6.7 0M13.3 18.5c1.5 1 3.4 1.1 5 .2" /></>;
      case "space-station": return <><path className="station-truss" d="M3 16h26M12 12h8v8h-8z" /><path className="station-array" d="M4 11h6v10H4zM22 11h6v10h-6zM14 8h4v4M16 20v4" /></>;
      case "tiangong": return <><path className="station-core" d="M14 8h4v16h-4zM9 13h14v6H9z" /><path className="station-array" d="M2.5 12h6v8h-6zM23.5 12h6v8h-6zM8.5 16h15" /></>;
      case "starlink-train": return <><path className="train-path" d="M4 22 28 9" /><rect x="5" y="19" width="4" height="3" rx=".7" /><rect x="12" y="15" width="4" height="3" rx=".7" /><rect x="19" y="11" width="4" height="3" rx=".7" /><rect x="26" y="7" width="3" height="3" rx=".7" /></>;
      case "satellite": return <><path d="m12 12 8 8M10 15l-4 4 7 7 4-4M15 10l4-4 7 7-4 4" /><circle cx="16" cy="16" r="3" /></>;
      case "radiant": return <><circle cx="16" cy="16" r="4" /><path d="M16 3v8M16 21v8M3 16h8M21 16h8M6.8 6.8l5.6 5.6M19.6 19.6l5.6 5.6M25.2 6.8l-5.6 5.6M12.4 19.6l-5.6 5.6" /></>;
      case "open-cluster": return <><circle cx="10" cy="17" r="1.8" /><circle cx="16" cy="10" r="2.2" /><circle cx="21" cy="18" r="1.8" /><circle cx="14" cy="23" r="1.3" /><circle cx="23" cy="9" r="1" /></>;
      case "globular-cluster": return <><circle className="cluster-halo" cx="16" cy="16" r="9" /><circle cx="16" cy="16" r="3" /><path d="M16 5v22M5 16h22" /></>;
      case "nebula": return <><path className="nebula-cloud" d="M5 18c2-7 8-11 14-9 4 1 8 5 8 9-1 5-6 8-11 7C10 27 3 24 5 18Z" /><path d="M9 19c3-5 8-7 14-5M11 22c4 1 8 0 11-3" /></>;
      case "galaxy": return <><ellipse className="galaxy-halo" cx="16" cy="16" rx="12" ry="5.5" transform="rotate(-18 16 16)" /><path d="M6 20c5-8 16-9 21-3M8 14c5 6 14 7 19 1" /><circle cx="16" cy="16" r="1.8" /></>;
      case "star": return <><circle className="named-star" cx="16" cy="16" r="4.2" /><path d="M16 3v8M16 21v8M3 16h8M21 16h8M7.5 7.5l5 5M19.5 19.5l5 5M24.5 7.5l-5 5M12.5 19.5l-5 5" /></>;
      case "constellation": return <><circle className="constellation-focus" cx="16" cy="16" r="7" /><path className="constellation-focus-stars" d="M16 5v5M16 22v5M5 16h5M22 16h5M11 11l10 10M21 11 11 21" /><circle cx="16" cy="16" r="1.8" /></>;
      case "deep-sky": return <><ellipse cx="16" cy="16" rx="10.5" ry="6" /><circle cx="16" cy="16" r="2" /></>;
      default: return <><circle className="planet-disc" cx="16" cy="16" r="7" /><path d="M8 16h16M16 8v16" /></>;
    }
  })();
  return <span className="tk-sky-object-glyph" data-marker={kind} aria-label={label}><svg viewBox="0 0 32 32" aria-hidden>{art}</svg></span>;
}

function referenceEntry(target: SkyFinderTarget): SkySearchEntry {
  const key = `${target.id} ${target.title}`.toLowerCase();
  const kind = /train/.test(key) ? "satellite-event" : /iss|tiangong|station/.test(key) ? "station" : target.source.kind === "equatorial" ? "deep-sky" : "solar-system";
  return { id: target.id, title: target.title, subtitle: target.appearance, aliases: [], kind, target };
}

function alertCategoryLabel(category: SatelliteAlertCategory): string {
  return category === "space-stations" ? "Space station passes" : category === "starlink-trains" ? "Starlink trains" : "Bright satellite events";
}

export function SkyFinder({ target, references, stations = [], observer, clock, at, liveDate, launch = null }: Props) {
  const capabilities = useMemo(() => detectSkyFinderCapabilities(), []);
  const [astronomyNow, setAstronomyNow] = useState(() => at);
  const [selectedTarget, setSelectedTarget] = useState<SkyFinderTarget | null>(target);
  const [manualCentre, setManualCentre] = useState<PhonePointing>({ altitudeDeg: 35, azimuthDeg: 180 });
  const [zoom, setZoom] = useState(1);
  const [navigationMode, setNavigationMode] = useState<SkyNavigationMode>(() => initialSkyNavigationMode(capabilities, liveDate));
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sensorsEnabled, setSensorsEnabled] = useState(false);
  const [sensorPermission, setSensorPermission] = useState<PermissionPhase>("idle");
  const [rawPose, setRawPose] = useState<DevicePose | null>(null);
  const [rawPointing, setRawPointing] = useState<PhonePointing | null>(null);
  const [sensorQuality, setSensorQuality] = useState<PointingQuality>("unavailable");
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [orientationTelemetry, setOrientationTelemetry] = useState<OrientationTelemetry | null>(null);
  const [calibration, setCalibration] = useState<FinderCalibration | null>(null);
  const [cameraPhase, setCameraPhase] = useState<CameraPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [expectedContext, setExpectedContext] = useState<ExpectedSkyContext | null>(null);
  const [alertPreferences, setAlertPreferences] = useState<SatelliteAlertPreferences>(() => loadSatelliteAlertPreferences(typeof window === "undefined" ? null : window.localStorage));
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const alertsTrigger = useRef<HTMLButtonElement>(null);
  const alertsClose = useRef<HTMLButtonElement>(null);
  const qualityTrigger = useRef<HTMLButtonElement>(null);
  const qualityClose = useRef<HTMLButtonElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const consumedLaunch = useRef<SkyFinderLaunchAttempt | null>(null);
  const stabilizer = useRef(new DevicePoseStabilizer());
  const lastAbsolute = useRef(0);
  const drag = useRef<{ id: number; x: number; y: number; centre: PhonePointing } | null>(null);
  const diagnosticsEnabled = useMemo(() => typeof window !== "undefined" &&
    ["127.0.0.1", "localhost"].includes(window.location.hostname) &&
    (INITIAL_SKY_DIAGNOSTICS_REQUESTED || new URLSearchParams(window.location.search).get("skyDiagnostics") === "1"), []);

  useEffect(() => setSelectedTarget(target), [target]);
  useEffect(() => {
    setAstronomyNow(at);
    if (!liveDate) return;
    const timer = window.setInterval(() => setAstronomyNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, [at, liveDate]);
  useEffect(() => { saveSatelliteAlertPreferences(typeof window === "undefined" ? null : window.localStorage, alertPreferences); }, [alertPreferences]);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(null), 5_000); return () => window.clearTimeout(timer); }, [message]);
  useEffect(() => {
    if (!alertsOpen) return;
    const frame = window.requestAnimationFrame(() => alertsClose.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [alertsOpen]);
  useEffect(() => {
    if (!qualityOpen) return;
    const frame = window.requestAnimationFrame(() => qualityClose.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [qualityOpen]);

  const targetSolution = useMemo(() => selectedTarget ? solutionForSkyFinderTarget(selectedTarget, observer, astronomyNow) : null, [astronomyNow, observer, selectedTarget]);
  const targetPosition = targetSolution?.horizontal ?? null;
  useEffect(() => {
    if (!targetPosition || navigationMode === "point") return;
    setManualCentre({ altitudeDeg: Math.max(-10, targetPosition.altitudeDeg), azimuthDeg: targetPosition.azimuthDeg });
  }, [selectedTarget?.id, navigationMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const [cameraProjection, setCameraProjection] = useState<CameraProjectionModel>({ horizontalFovDeg: SKY_HORIZONTAL_FOV_DEG, verticalFovDeg: SKY_VERTICAL_FOV_DEG, sourceWidthPx: 0, sourceHeightPx: 0, viewportWidthPx: 0, viewportHeightPx: 0, fit: "cover" });
  const refreshCameraProjection = useCallback(() => {
    const settings = stream.current?.getVideoTracks()[0]?.getSettings();
    setCameraProjection((current) => ({ ...current, sourceWidthPx: video.current?.videoWidth || settings?.width || 0, sourceHeightPx: video.current?.videoHeight || settings?.height || 0, viewportWidthPx: stage.current?.clientWidth || 0, viewportHeightPx: stage.current?.clientHeight || 0 }));
  }, []);
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const resize = new ResizeObserver(refreshCameraProjection);
    resize.observe(node);
    video.current?.addEventListener("loadedmetadata", refreshCameraProjection);
    refreshCameraProjection();
    return () => resize.disconnect();
  }, [refreshCameraProjection]);

  const stopCamera = useCallback(() => { stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; if (video.current) video.current.srcObject = null; setCameraPhase("idle"); }, []);
  useEffect(() => stopCamera, [stopCamera]);
  const startCamera = useCallback(async () => {
    if (!canRequestSkyFinderPermission(capabilities, "camera", { liveDate, userInitiated: true })) { setCameraPhase("unavailable"); setMessage("Camera isn’t available here. Rendered Sky remains fully usable."); return; }
    setCameraPhase("requesting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current?.getTracks().forEach((track) => track.stop()); stream.current = media;
      if (video.current) { video.current.srcObject = media; await video.current.play().catch(() => undefined); }
      setCameraPhase("active"); refreshCameraProjection();
    } catch { setCameraPhase("denied"); setMessage("Camera permission wasn’t granted. Rendered Sky is still ready."); }
  }, [capabilities, liveDate, refreshCameraProjection]);

  const requestOrientation = useCallback(async (): Promise<boolean> => {
    setNavigationMode("point");
    if (!capabilities.orientation || !liveDate) {
      setNavigationMode("explore");
      setMessage("Orientation isn’t available. Explore the sky manually.");
      return false;
    }
    setSensorPermission("requesting");
    try {
      const orientation = permissionConstructor("DeviceOrientationEvent");
      const result = orientation?.requestPermission ? await orientation.requestPermission() : "granted";
      setSensorPermission(result); setSensorsEnabled(result === "granted");
      if (result !== "granted") {
        setNavigationMode("explore");
        setMessage("Orientation wasn’t granted. Explore the sky manually.");
      }
      return result === "granted";
    } catch {
      setSensorPermission("denied");
      setSensorsEnabled(false);
      setNavigationMode("explore");
      setMessage("Orientation wasn’t granted. Explore the sky manually.");
      return false;
    }
  }, [capabilities.orientation, liveDate]);
  useEffect(() => {
    if (!launch || consumedLaunch.current === launch || (launch.targetId !== null && launch.targetId !== selectedTarget?.id)) return;
    consumedLaunch.current = launch;
    setNavigationMode("point");
    setSensorPermission("requesting");
    void launch.sensor.then((result) => {
      setSensorPermission(result);
      setSensorsEnabled(result === "granted");
      if (result !== "granted") {
        setNavigationMode("explore");
        setMessage("Orientation wasn’t granted. Explore the sky manually.");
      }
    });
  }, [launch, selectedTarget]);
  useEffect(() => {
    if (navigationMode === "point" && capabilities.handheldEligible && capabilities.orientation && !capabilities.orientationPermissionRequest) {
      setSensorPermission("granted");
      setSensorsEnabled(true);
    }
  }, [capabilities, navigationMode]);
  useEffect(() => {
    if (!sensorsEnabled) return;
    const update = (incoming: Event) => {
      const event = incoming as SafariOrientationEvent;
      if (event.alpha === null || event.beta === null || event.gamma === null) return;
      const absolute = event.type === "deviceorientationabsolute" || event.absolute === true;
      if (!absolute && Date.now() - lastAbsolute.current < 1_000) return;
      if (absolute) lastAbsolute.current = Date.now();
      const magnetic = typeof event.webkitCompassHeading === "number" && event.webkitCompassHeading >= 0 ? event.webkitCompassHeading : null;
      const filtered = stabilizer.current.update(devicePoseFromOrientationWithHeading(event.alpha, event.beta, event.gamma, screenAngle(), magnetic), event.timeStamp || performance.now());
      setRawPose(filtered); setRawPointing(pointingFromDevicePose(filtered));
      const accuracy = typeof event.webkitCompassAccuracy === "number" && event.webkitCompassAccuracy >= 0 ? event.webkitCompassAccuracy : null;
      setHeadingAccuracy(accuracy); setSensorQuality(accuracy === null ? absolute ? "fair" : "poor" : accuracy <= 15 ? "good" : accuracy <= 30 ? "fair" : "poor");
      setOrientationTelemetry({ alphaDeg: event.alpha, betaDeg: event.beta, gammaDeg: event.gamma, screenOrientationDeg: screenAngle(), magneticHeadingDeg: magnetic, compassAccuracyDeg: accuracy, absolute });
    };
    window.addEventListener("deviceorientationabsolute", update, true); window.addEventListener("deviceorientation", update, true);
    return () => { window.removeEventListener("deviceorientationabsolute", update, true); window.removeEventListener("deviceorientation", update, true); stabilizer.current.reset(); };
  }, [sensorsEnabled]);

  const pose = useMemo(() => rawPose ? calibratedDevicePose(rawPose, calibration) : null, [calibration, rawPose]);
  const pointing = useMemo(() => pose ? pointingFromDevicePose(pose) : null, [pose]);
  const pointActive = navigationMode === "point" && sensorsEnabled && pointing !== null;
  const viewCentre = pointActive && pointing ? pointing : manualCentre;
  const displayPose = useMemo(() => pointActive && pose ? pose : devicePoseLookingAt(viewCentre), [pointActive, pose, viewCentre]);
  const displayProjection = useMemo<CameraProjectionModel>(() => cameraPhase === "active" ? cameraProjection : { ...cameraProjection, horizontalFovDeg: SKY_HORIZONTAL_FOV_DEG / zoom, verticalFovDeg: SKY_VERTICAL_FOV_DEG / zoom, sourceWidthPx: stage.current?.clientWidth || cameraProjection.viewportWidthPx, sourceHeightPx: stage.current?.clientHeight || cameraProjection.viewportHeightPx, fit: "contain" }, [cameraPhase, cameraProjection, zoom]);
  const selectedConstellation = selectedTarget?.id.startsWith("constellation-") === true;
  const density = useMemo(
    () => skyDensityForView({
      horizontalFovDeg: effectiveCameraProjection(displayProjection).horizontalFovDeg,
      selectedConstellation,
    }),
    [displayProjection, selectedConstellation],
  );

  const stationPassAnchor = Math.floor(astronomyNow.getTime() / (15 * 60_000)) * 15 * 60_000;
  const stationEntries = useMemo(
    () => stationSearchEntries(stations, new Date(stationPassAnchor), observer, clock),
    [clock, observer, stationPassAnchor, stations],
  );
  const allReferences = useMemo(() => [...new Map([...references, ...stationEntries.map((entry) => entry.target)].map((item) => [item.id, item])).values()], [references, stationEntries]);
  const searchCatalog = useMemo(() => skySearchCatalog(astronomyNow, [...stationEntries, ...references.map(referenceEntry)]), [astronomyNow, references, stationEntries]);
  const searchResults = useMemo(() => filterSkySearch(searchCatalog, query), [query, searchCatalog]);
  const contextCentre = useMemo(() => ({ azimuthDeg: Math.round(viewCentre.azimuthDeg / 3) * 3, altitudeDeg: Math.round(viewCentre.altitudeDeg / 3) * 3 }), [viewCentre.altitudeDeg, viewCentre.azimuthDeg]);
  useEffect(() => {
    let cancelled = false;
    void import("../../data/tracker/skyFinderContext").then(({ expectedSkyContext }) => { if (!cancelled) setExpectedContext(expectedSkyContext(selectedTarget, observer, astronomyNow, contextCentre, allReferences)); });
    return () => { cancelled = true; };
  }, [allReferences, astronomyNow, contextCentre, observer, selectedTarget]);

  const projectedContext = useMemo(() => {
    if (!expectedContext) return null;
    const stars = expectedContext.stars.flatMap((star) => { const p = projectEnuDirection(star.direction, displayPose, displayProjection); return p.inField ? [{ ...star, ...p }] : []; });
    const lines = expectedContext.lines.flatMap((line) => { const start = projectEnuDirection(line.start, displayPose, displayProjection); const end = projectEnuDirection(line.end, displayPose, displayProjection); return start.inFront && end.inFront && [start, end].some((p) => p.xPercent >= -20 && p.xPercent <= 120 && p.yPercent >= -20 && p.yPercent <= 120) ? [{ ...line, start, end }] : []; });
    const labels = expectedContext.labels.flatMap((label) => { const p = projectEnuDirection(label.direction, displayPose, displayProjection); return p.inField ? [{ ...label, ...p }] : []; });
    const objects = expectedContext.objects.flatMap((object) => { const p = projectEnuDirection(object.direction, displayPose, displayProjection); return p.inField ? [{ ...object, ...p }] : []; });
    const figures = expectedContext.figures.flatMap((figure) => {
      const paths = figure.paths.flatMap((path) => {
        const points = path.directions.map((direction) => projectEnuDirection(direction, displayPose, displayProjection));
        if (points.length < 2 || points.every((point) => !point.inFront)) return [];
        return [{ ...path, points }];
      });
      return paths.length > 0 ? [{ ...figure, paths }] : [];
    });
    const milkyWay = expectedContext.milkyWay.flatMap((line) => { const start = projectEnuDirection(line.start, displayPose, displayProjection); const end = projectEnuDirection(line.end, displayPose, displayProjection); return start.inFront && end.inFront ? [{ ...line, start, end }] : []; });
    return { stars, lines, labels, objects, figures, milkyWay };
  }, [displayPose, displayProjection, expectedContext]);

  const displayedContext = useMemo(() => {
    if (!projectedContext) return null;
    const stars = projectedContext.stars.filter((star) => star.magnitude <= density.magnitudeLimit);
    let retainedDeepSky = 0;
    const objects = projectedContext.objects.filter((object) => {
      if (!["deep-sky", "galaxy", "nebula", "open-cluster", "globular-cluster"].includes(object.marker)) return true;
      retainedDeepSky += 1;
      return retainedDeepSky <= density.maxDeepSkyObjects;
    });
    const constellationLabels = projectedContext.labels.filter((label) => !label.primary).map((label) => ({
      key: `constellation-${label.symbol}`,
      xPercent: label.xPercent,
      yPercent: label.yPercent,
      priority: label.primary ? 100 : 40,
    }));
    const starLabels = stars
      .filter((star) => star.label && star.magnitude <= density.namedStarMagnitudeLimit)
      .map((star) => ({
        key: `star-${star.id}`,
        xPercent: star.xPercent,
        yPercent: star.yPercent,
        priority: star.inTargetConstellation ? 35 : 20 - star.magnitude,
      }));
    const objectLabels = objects.map((object) => ({
      key: `object-${object.id}`,
      xPercent: object.xPercent,
      yPercent: object.yPercent,
      priority: ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto", "space-station", "tiangong", "starlink-train"].includes(object.marker) ? 70 : 12,
    }));
    const targetProjection = targetPosition
      ? projectEnuDirection(horizontalToEnu(targetPosition), displayPose, displayProjection)
      : null;
    const selectedTargetBlocker = targetProjection?.inField
      ? [{ key: "selected-target-blocker", xPercent: targetProjection.xPercent, yPercent: targetProjection.yPercent, priority: 1_000 }]
      : [];
    const visibleLabelKeys = selectNonCollidingSkyLabels(
      [...selectedTargetBlocker, ...objectLabels, ...constellationLabels, ...starLabels],
      density.maxLabels + selectedTargetBlocker.length,
      { horizontalPercent: 18, verticalPercent: 9 },
    );
    return {
      ...projectedContext,
      stars: stars.map((star) => ({ ...star, showLabel: visibleLabelKeys.has(`star-${star.id}`) })),
      labels: projectedContext.labels.filter((label) => !label.primary && visibleLabelKeys.has(`constellation-${label.symbol}`)),
      figures: density.showSelectedFigure ? projectedContext.figures.filter((figure) => figure.primary) : [],
      milkyWay: density.showMilkyWay ? projectedContext.milkyWay : [],
      objects: objects.map((object) => ({ ...object, showLabel: visibleLabelKeys.has(`object-${object.id}`) })),
    };
  }, [density, displayPose, displayProjection, projectedContext, targetPosition]);

  const usesMagnetic = orientationTelemetry?.magneticHeadingDeg != null && !calibration;
  const quality: PointingQuality = calibration ? sensorQuality === "poor" ? "fair" : sensorQuality : usesMagnetic ? "poor" : sensorQuality;
  const targetPointing = pointActive ? pointing : null;
  const alignment = alignmentFor(targetPointing, targetPosition, selectedTarget?.alignmentToleranceDeg ?? 3, pointActive ? quality : "unavailable");
  const projectedTarget = targetPosition ? projectEnuDirection(horizontalToEnu(targetPosition), displayPose, displayProjection) : null;
  const edgeCue = projectedTarget && !projectedTarget.inField ? edgeCueForProjection(projectedTarget) : null;
  const aboveHorizon = targetPosition !== null && targetPosition.altitudeDeg > 0;
  const nextRiseUtc = useMemo(() => selectedTarget && targetPosition && targetPosition.altitudeDeg < 0 ? nextRiseForSkyFinderTarget(selectedTarget, observer, astronomyNow) : null, [astronomyNow, observer, selectedTarget, targetPosition]);
  const guidance = selectedTarget ? guidanceForSkyTarget(selectedTarget.title, targetPointing, targetPosition, selectedTarget.alignmentToleranceDeg, pointActive ? quality : "unavailable") : null;
  const guidanceTitle = navigationMode === "explore" && targetPosition
    ? `${cardinal(targetPosition.azimuthDeg)} · ${describeTargetAltitude(targetPosition.altitudeDeg)}`
    : navigationMode === "point" && !pointActive
      ? "Enable pointing to follow your phone"
      : guidance?.instruction ?? "Point your phone to explore";
  const targetMarker = selectedTarget ? skyMarkerKindForTarget(selectedTarget) : null;
  const targetPositionLabel = targetPosition
    ? `${cardinal(targetPosition.azimuthDeg)} · ${describeTargetAltitude(targetPosition.altitudeDeg)}`
    : "Position unavailable";
  const targetSecondaryLabel = !aboveHorizon
    ? nextRiseUtc
      ? `Rises ${formatClockTime(nextRiseUtc, clock)}`
      : "Below horizon"
    : navigationMode === "explore"
      ? skyTargetEquipmentLabel(selectedTarget!)
      : targetPositionLabel;
  const browseHint = navigationMode === "explore"
    ? { title: "Explore the sky", detail: "Drag to look around · pinch or use zoom" }
    : !pointActive
      ? { title: "Point your phone around you", detail: "Rendered Sky · Camera optional" }
      : null;
  const moonPhase = useMemo(() => lunarPhaseAt(astronomyNow), [astronomyNow]);
  const phase = skyPhase(expectedContext?.sunAltitudeDeg ?? null);
  const effectiveProjection = effectiveCameraProjection(displayProjection);
  const selectedTrail = useMemo(() => {
    if (targetMarker !== "starlink-train" || selectedTarget?.source.kind !== "sampled") return [];
    const visiblePoints = selectedTarget.source.path.points.filter((point) => point.altitudeDeg > 0);
    const stride = Math.max(1, Math.ceil(visiblePoints.length / 18));
    return visiblePoints
      .filter((_, index) => index % stride === 0)
      .map((point) => ({ ...point, ...projectEnuDirection(horizontalToEnu(point), displayPose, displayProjection) }))
      .filter((point) => point.inFront && point.xPercent >= -15 && point.xPercent <= 115 && point.yPercent >= -15 && point.yPercent <= 115);
  }, [displayPose, displayProjection, selectedTarget, targetMarker]);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchTrigger.current?.focus());
  }, []);
  const closeAlerts = useCallback(() => {
    setAlertsOpen(false);
    window.requestAnimationFrame(() => alertsTrigger.current?.focus());
  }, []);
  const closeQuality = useCallback(() => {
    setQualityOpen(false);
    window.requestAnimationFrame(() => qualityTrigger.current?.focus());
  }, []);

  const chooseTarget = (entry: SkySearchEntry) => {
    setSelectedTarget(entry.target);
    const position = positionForSkyFinderTarget(entry.target, observer, astronomyNow);
    if (navigationMode === "explore") {
      if (position) {
        setManualCentre({ altitudeDeg: Math.max(-12, position.altitudeDeg), azimuthDeg: position.azimuthDeg });
      } else if (entry.target.source.kind === "sampled") {
        const bestPathPoint = [...entry.target.source.path.points]
          .filter((point) => point.altitudeDeg > 0)
          .sort((left, right) => right.relative - left.relative || right.altitudeDeg - left.altitudeDeg)[0];
        if (bestPathPoint) setManualCentre({ altitudeDeg: bestPathPoint.altitudeDeg, azimuthDeg: bestPathPoint.azimuthDeg });
      }
    }
    closeSearch(); setQuery("");
  };
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (navigationMode !== "explore") return; drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, centre: manualCentre }; event.currentTarget.setPointerCapture(event.pointerId); };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (!drag.current || drag.current.id !== event.pointerId || navigationMode !== "explore") return; const s = 0.14 / zoom; setManualCentre({ azimuthDeg: normalizeDegrees(drag.current.centre.azimuthDeg - (event.clientX - drag.current.x) * s), altitudeDeg: Math.max(-30, Math.min(89, drag.current.centre.altitudeDeg + (event.clientY - drag.current.y) * s)) }); };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (drag.current?.id === event.pointerId) drag.current = null; };
  const enterExplore = () => {
    if (pointing) setManualCentre(pointing);
    setNavigationMode("explore");
    setSearchOpen(false);
    setAlertsOpen(false);
    setQualityOpen(false);
  };
  const recenterToPhone = () => {
    setSearchOpen(false);
    setAlertsOpen(false);
    setQualityOpen(false);
    if (sensorsEnabled) {
      setNavigationMode("point");
      return;
    }
    void requestOrientation();
  };
  const updateAlertCategory = (category: SatelliteAlertCategory) => setAlertPreferences((current) => ({ ...current, categories: { ...current.categories, [category]: !current.categories[category] } }));
  const targetStyle = { "--finder-x": `${(projectedTarget?.xPercent ?? 50) - 50}%`, "--finder-y": `${(projectedTarget?.yPercent ?? 50) - 50}%` } as CSSProperties;

  const pointControlLabel = navigationMode === "explore"
    ? "Recenter"
    : pointActive
      ? "Explore"
      : "Enable pointing";
  const pointControlAria = navigationMode === "explore"
    ? "Recenter to phone"
    : pointActive
      ? "Explore sky manually"
      : "Enable device pointing";

  return (
    <section
      className="tk-sky-finder tk-sky-explorer"
      data-camera={cameraPhase === "active" ? "active" : "off"}
      data-visual-base={cameraPhase === "active" ? "camera" : "rendered-sky"}
      data-aligned={alignment.aligned ? "true" : "false"}
      data-mode={selectedTarget ? "targeted" : "browse"}
      data-navigation-mode={navigationMode}
      data-pointing-active={pointActive ? "true" : "false"}
      data-orientation-permission={sensorPermission}
      data-sky-density={density.tier}
      data-sky-phase={phase}
      data-device-class={capabilities.deviceClass}
      data-observer-latitude={observer.latitudeDeg.toFixed(7)}
      data-observer-longitude={observer.longitudeDeg.toFixed(7)}
      data-astronomy-utc={astronomyNow.toISOString()}
      data-selected-target={selectedTarget?.id}
      data-target-recommended-at={selectedTarget?.recommendedAtUtc}
      data-target-altitude={targetPosition?.altitudeDeg.toFixed(3)}
      data-target-azimuth={targetPosition?.azimuthDeg.toFixed(3)}
      data-expected-stars={displayedContext?.stars.length ?? 0}
      data-expected-lines={displayedContext?.lines.length ?? 0}
      data-expected-labels={displayedContext?.labels.length ?? 0}
      data-expected-objects={displayedContext?.objects.length ?? 0}
      data-magnitude-limit={density.magnitudeLimit.toFixed(2)}
      data-constellation-identities="88"
      data-camera-horizontal-fov={effectiveProjection.horizontalFovDeg.toFixed(3)}
      data-camera-vertical-fov={effectiveProjection.verticalFovDeg.toFixed(3)}
      data-camera-crop-axis={effectiveProjection.cropAxis}
      data-milky-way-source="nasa-svs-deep-star-maps-2020"
      data-heading-reference={orientationTelemetry?.magneticHeadingDeg != null ? calibration ? "magnetic-calibrated" : "magnetic-uncorrected" : "event-alpha"}
      aria-label="Sky"
    >
      <div
        ref={stage}
        className="tk-finder-stage"
        style={targetStyle}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={(event) => {
          if (cameraPhase === "active" || navigationMode !== "explore") return;
          event.preventDefault();
          setZoom((value) => Math.max(0.72, Math.min(2.8, value * (event.deltaY > 0 ? 0.9 : 1.1))));
        }}
      >
        <video ref={video} className="tk-finder-camera" autoPlay muted playsInline aria-hidden />
        <div className="tk-finder-sky" aria-hidden />
        <div className="tk-finder-shade" aria-hidden />
        <CelestialMilkyWay
          observer={observer}
          at={astronomyNow}
          pose={displayPose}
          projection={displayProjection}
          visible={density.showMilkyWay}
        />

        {displayedContext ? (
          <div className="tk-finder-expected-field" aria-hidden>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <g className="tk-finder-starlink-trail" data-active={selectedTrail.length > 1 ? "true" : undefined}>
                {selectedTrail.length > 1 ? <polyline points={selectedTrail.map((point) => `${point.xPercent},${point.yPercent}`).join(" ")} /> : null}
                {selectedTrail.map((point, index) => <circle key={`${point.atUtc}-${index}`} cx={point.xPercent} cy={point.yPercent} r={index % 3 === 0 ? 0.72 : 0.48} />)}
              </g>
              <g className="tk-finder-constellation-figures">
                {displayedContext.figures.flatMap((figure) => figure.paths.map((path) => {
                  const commands = skyFigurePathData(path.points, path.closed);
                  return <path key={`${figure.symbol}-${path.id}`} d={commands} data-primary="true" data-role={path.role} data-constellation={figure.symbol} />;
                }))}
              </g>
              <g className="tk-finder-constellation-lines">
                {displayedContext.lines.map((line) => <line key={line.id} x1={line.start.xPercent} y1={line.start.yPercent} x2={line.end.xPercent} y2={line.end.yPercent} data-primary={line.primary ? "true" : undefined} data-constellation={line.constellation} data-start-star={line.startStarId} data-end-star={line.endStarId} />)}
              </g>
            </svg>
            {displayedContext.stars.map((star) => (
              <span
                key={star.id}
                className="tk-finder-star"
                data-target-constellation={star.inTargetConstellation ? "true" : undefined}
                data-brightness={star.magnitude <= 0.7 ? "beacon" : star.magnitude <= 2 ? "bright" : "field"}
                data-magnitude={star.magnitude.toFixed(2)}
                style={{ left: `${star.xPercent}%`, top: `${star.yPercent}%`, "--star-size": `${star.radiusPx}px`, "--star-color": star.color, "--star-opacity": Math.max(0.08, (0.28 + star.luminance * 0.72) * Math.max(0.24, Math.min(1, (star.direction.up + 0.18) / 0.7))) } as CSSProperties}
              >
                <i />
                {star.showLabel && star.label ? <small>{star.label}</small> : null}
              </span>
            ))}
            {displayedContext.labels.map((label) => (
              <span
                key={label.symbol}
                className="tk-finder-constellation-label"
                style={{ left: `${label.xPercent}%`, top: `${label.yPercent}%` }}
              >{label.name}</span>
            ))}
            {displayedContext.objects.map((object) => (
              <span key={object.id} className="tk-finder-object" style={{ left: `${object.xPercent}%`, top: `${object.yPercent}%` }}>
                <SkyMarkerGlyph kind={object.marker} phase={Number(moonPhase.illuminatedFraction)} waxing={moonPhase.waxing} />
                {object.showLabel ? <small>{object.title}</small> : null}
              </span>
            ))}
          </div>
        ) : null}

        <div className="tk-sky-floating-tools" onPointerDown={(event) => event.stopPropagation()}>
          <button ref={searchTrigger} type="button" onClick={() => { if (searchOpen) closeSearch(); else { setSearchOpen(true); setAlertsOpen(false); setQualityOpen(false); } }} aria-label="Search the sky" aria-expanded={searchOpen}><Search size={18} aria-hidden /></button>
          {capabilities.camera && liveDate ? <button type="button" onClick={cameraPhase === "active" ? stopCamera : startCamera} aria-label={cameraPhase === "active" ? "Turn camera off" : "Turn camera on"} aria-pressed={cameraPhase === "active"} disabled={cameraPhase === "requesting"}>{cameraPhase === "active" ? <Camera size={18} aria-hidden /> : <CameraOff size={18} aria-hidden />}</button> : null}
          {capabilities.orientation && liveDate ? <button className="tk-sky-mode-control" type="button" onClick={navigationMode === "explore" ? recenterToPhone : pointActive ? enterExplore : recenterToPhone} aria-label={pointControlAria} aria-pressed={navigationMode === "point"}><Compass size={16} aria-hidden /><span>{pointControlLabel}</span></button> : null}
          <button ref={alertsTrigger} type="button" onClick={() => { if (alertsOpen) closeAlerts(); else { setAlertsOpen(true); setSearchOpen(false); setQualityOpen(false); } }} aria-label="Satellite alerts" aria-expanded={alertsOpen}><BellRing size={17} aria-hidden /></button>
        </div>

        {searchOpen ? <section className="tk-sky-popover tk-sky-search" role="dialog" aria-label="Search the sky" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeSearch(); } }} onPointerDown={(event) => event.stopPropagation()}><header><Search size={16} aria-hidden /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Planet, star, constellation…" aria-label="Search celestial objects" /><button type="button" onClick={closeSearch} aria-label="Close search"><X size={17} aria-hidden /></button></header><div className="tk-sky-search-results">{searchResults.map((entry) => <button type="button" key={`${entry.kind}-${entry.id}`} onClick={() => chooseTarget(entry)}><SkyMarkerGlyph kind={skyMarkerKindForTarget(entry.target)} /><span><strong>{entry.title}</strong><small>{entry.subtitle}</small></span></button>)}</div></section> : null}

        {alertsOpen ? <section className="tk-sky-popover tk-sky-alert-settings" role="dialog" aria-label="Satellite alerts" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeAlerts(); } }} onPointerDown={(event) => event.stopPropagation()}><header><span><BellRing size={15} aria-hidden /> Satellite alerts</span><button ref={alertsClose} type="button" onClick={closeAlerts} aria-label="Close satellite alerts"><X size={17} aria-hidden /></button></header><div className="tk-sky-alerts"><label className="tk-sky-alert-master"><span>Alert me to worthwhile passes</span><input type="checkbox" checked={alertPreferences.enabled} onChange={() => setAlertPreferences((current) => ({ ...current, enabled: !current.enabled }))} /></label>{(["space-stations", "starlink-trains", "bright-satellites"] as SatelliteAlertCategory[]).map((category) => <label key={category}><span>{alertCategoryLabel(category)}</span><input type="checkbox" checked={alertPreferences.categories[category]} disabled={!alertPreferences.enabled} onChange={() => updateAlertCategory(category)} /></label>)}<label><span>Lead time</span><select value={alertPreferences.leadMinutes} disabled={!alertPreferences.enabled} onChange={(event) => setAlertPreferences((current) => ({ ...current, leadMinutes: Number(event.target.value) as SatelliteAlertLeadMinutes }))}><option value={10}>10 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={360}>Same day</option></select></label><p>Saved on this device. Push delivery still needs a notification service.</p></div></section> : null}

        {pointActive && quality === "poor" ? <button ref={qualityTrigger} type="button" className="tk-sky-quality" onClick={() => { setQualityOpen(true); setSearchOpen(false); setAlertsOpen(false); }} aria-expanded={qualityOpen}>Heading accuracy is limited</button> : null}
        {qualityOpen ? <section className="tk-sky-popover tk-sky-quality-panel" role="dialog" aria-label="Pointing accuracy" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeQuality(); } }} onPointerDown={(event) => event.stopPropagation()}><header><span>Pointing accuracy</span><button ref={qualityClose} type="button" onClick={closeQuality} aria-label="Close pointing accuracy"><X size={17} aria-hidden /></button></header><p>{headingAccuracy !== null ? `Compass reports about ±${Math.round(headingAccuracy)}°.` : "This browser cannot provide a reliable true-north accuracy estimate."}</p>{rawPointing && selectedTarget && targetPosition ? <button type="button" onClick={() => setCalibration(calibrationFromAlignment(rawPointing, targetPosition, selectedTarget.id, new Date().toISOString()))}>Align selected target here</button> : null}{calibration ? <button type="button" onClick={() => setCalibration(null)}>Clear calibration</button> : null}</section> : null}

        {navigationMode === "explore" && cameraPhase !== "active" ? <div className="tk-sky-zoom" onPointerDown={(event) => event.stopPropagation()}><button type="button" onClick={() => setZoom((value) => Math.min(2.8, value * 1.22))} aria-label="Zoom in"><ZoomIn size={18} aria-hidden /></button><button type="button" onClick={() => setZoom((value) => Math.max(0.72, value / 1.22))} aria-label="Zoom out"><ZoomOut size={18} aria-hidden /></button></div> : null}
        <div className="tk-finder-sky-context" aria-hidden><span>{navigationMode === "point" ? "Point" : "Explore"} · {expectedContext?.constellation?.name ?? "Current sky"}</span><strong>{cardinal(viewCentre.azimuthDeg)} · {Math.round(viewCentre.altitudeDeg)}°</strong></div>
        <div className="tk-finder-horizon" aria-hidden><span>{Math.round(viewCentre.azimuthDeg)}°</span><strong>{cardinal(viewCentre.azimuthDeg)}</strong></div>
        {selectedTarget ? <div className="tk-finder-guidance" aria-live="polite"><SkyMarkerGlyph kind={targetMarker!} phase={Number(moonPhase.illuminatedFraction)} waxing={moonPhase.waxing} /><span><small>{selectedTarget.title}</small><strong>{aboveHorizon ? guidanceTitle : "Below horizon"}</strong></span><em>{targetSecondaryLabel}</em></div> : browseHint ? <div className="tk-sky-browse-hint"><strong>{browseHint.title}</strong><span>{browseHint.detail}</span></div> : null}
        {aboveHorizon && projectedTarget?.inField && selectedTarget ? <div className="tk-finder-lock" data-shape={selectedTarget.shape} data-marker={targetMarker} aria-hidden><SkyMarkerGlyph kind={targetMarker!} phase={Number(moonPhase.illuminatedFraction)} waxing={moonPhase.waxing} /><em>{alignment.aligned ? `${selectedTarget.title} is here` : selectedTarget.title}</em></div> : null}
        {aboveHorizon && edgeCue && selectedTarget ? <div className="tk-finder-edge-cue" style={{ left: `${edgeCue.xPercent}%`, top: `${edgeCue.yPercent}%` }} aria-hidden><SkyMarkerGlyph kind={targetMarker!} phase={Number(moonPhase.illuminatedFraction)} waxing={moonPhase.waxing} /><span>{guidanceTitle}</span></div> : null}
        {message ? <p className="tk-sky-toast" role="status">{message}</p> : null}
        {diagnosticsEnabled ? <aside className="tk-finder-developer" aria-label="AR projection diagnostics"><header><strong>AR diagnostics</strong><span>Local developer view · not consumer UI</span></header><dl><div><dt>Target</dt><dd>{selectedTarget?.title ?? "None"}</dd></div><div><dt>UTC</dt><dd>{astronomyNow.toISOString()}</dd></div><div><dt>Observer</dt><dd>{observer.latitudeDeg.toFixed(5)}, {observer.longitudeDeg.toFixed(5)}</dd></div><div><dt>RA / Dec</dt><dd>{targetSolution?.equatorial ? `${targetSolution.equatorial.raHours.toFixed(5)}h / ${targetSolution.equatorial.decDeg.toFixed(4)}°` : "Not applicable"}</dd></div><div><dt>Expected Az / Alt</dt><dd>{targetPosition ? `${targetPosition.azimuthDeg.toFixed(3)}° / ${targetPosition.altitudeDeg.toFixed(3)}°` : "Unavailable"}</dd></div><div><dt>Local ENU</dt><dd>{targetSolution ? `${targetSolution.enu.east.toFixed(5)}, ${targetSolution.enu.north.toFixed(5)}, ${targetSolution.enu.up.toFixed(5)}` : "Unavailable"}</dd></div><div><dt>Device heading</dt><dd>{pointing ? `${pointing.azimuthDeg.toFixed(2)}°` : "Manual"}</dd></div><div><dt>Pitch / roll</dt><dd>{orientationTelemetry ? `${orientationTelemetry.betaDeg.toFixed(2)}° / ${orientationTelemetry.gammaDeg.toFixed(2)}°` : "Manual"}</dd></div><div><dt>Quaternion</dt><dd>{pose ? `${pose.x.toFixed(5)}, ${pose.y.toFixed(5)}, ${pose.z.toFixed(5)}, ${pose.w.toFixed(5)}` : "Manual view pose"}</dd></div><div><dt>Magnetic heading</dt><dd>{orientationTelemetry?.magneticHeadingDeg != null ? `${orientationTelemetry.magneticHeadingDeg.toFixed(2)}°` : "Unavailable"}</dd></div><div><dt>True-north correction</dt><dd>{calibration ? `${calibration.azimuthOffsetDeg.toFixed(2)}°` : "Unavailable in browser API"}</dd></div><div><dt>Screen orientation</dt><dd>{screenAngle()}°</dd></div><div><dt>Camera FOV</dt><dd>{effectiveProjection.horizontalFovDeg.toFixed(2)}° × {effectiveProjection.verticalFovDeg.toFixed(2)}°</dd></div><div><dt>Video / viewport</dt><dd>{cameraProjection.sourceWidthPx}×{cameraProjection.sourceHeightPx} / {cameraProjection.viewportWidthPx}×{cameraProjection.viewportHeightPx}</dd></div><div><dt>Crop</dt><dd>{effectiveProjection.cropAxis} · {(effectiveProjection.visibleFraction * 100).toFixed(1)}%</dd></div><div><dt>Projected X / Y</dt><dd>{projectedTarget ? `${projectedTarget.xPercent.toFixed(2)}% / ${projectedTarget.yPercent.toFixed(2)}%` : "Unavailable"}</dd></div><div><dt>Navigation</dt><dd>{navigationMode} · {pointActive ? "pose active" : "manual pose"}</dd></div><div><dt>Density</dt><dd>{density.tier} · mag ≤ {density.magnitudeLimit.toFixed(2)}</dd></div></dl></aside> : null}
      </div>
    </section>
  );
}
