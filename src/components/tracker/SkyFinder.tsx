import { BellRing, Camera, CameraOff, Compass, Layers3, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { Body, Illumination } from "astronomy-engine";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

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
  DEFAULT_SKY_LAYERS, filterSkySearch, SKY_LAYER_IDS, SKY_LAYER_LABELS, skySearchCatalog,
  skyTargetEquipmentLabel, stationSearchEntries, type SkyLayerId, type SkySearchEntry,
} from "../../data/tracker/skyExplorer";
import type { CrewedStationEphemeris } from "../../data/tracker/satelliteSources";
import {
  loadSatelliteAlertPreferences, saveSatelliteAlertPreferences,
  type SatelliteAlertCategory, type SatelliteAlertLeadMinutes, type SatelliteAlertPreferences,
} from "../../data/tracker/satelliteAlerts";
import type { ExpectedSkyContext } from "../../data/tracker/skyFinderContext";
import { skyMarkerKindForTarget, type SkyMarkerKind } from "../../data/tracker/skyMarker";

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
  targetId: string;
  sensor: Promise<LaunchSensorResult>;
  camera: null;
}

function permissionConstructor(name: "DeviceOrientationEvent" | "DeviceMotionEvent") {
  return (window[name] as unknown as PermissionConstructor | undefined) ?? null;
}

/** Camera permission belongs only to the explicit Camera toggle. */
export function beginSkyFinderLaunch(targetId: string, capabilities: FinderCapabilities, liveDate: boolean): SkyFinderLaunchAttempt | null {
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

function SkyMarkerGlyph({ kind, label, phase = 0.5 }: { kind: SkyMarkerKind; label?: string; phase?: number }) {
  const art = (() => {
    switch (kind) {
      case "sun": return <><circle className="disc" cx="16" cy="16" r="7" /><circle className="corona" cx="16" cy="16" r="11" /><path d="M16 1.8v4M16 26.2v4M1.8 16h4M26.2 16h4M5.9 5.9l2.9 2.9M23.2 23.2l2.9 2.9M26.1 5.9l-2.9 2.9M8.8 23.2l-2.9 2.9" /></>;
      case "moon": return <><circle className="moon-disc" cx="16" cy="16" r="9" /><ellipse className="moon-shadow" cx={16 - (phase - 0.5) * 6} cy="16" rx={Math.max(2, Math.min(12, 2 + phase * 10))} ry="9" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="19" r="1" /></>;
      case "saturn": return <><ellipse className="planet-disc" cx="16" cy="16" rx="6" ry="5.6" /><path className="planet-band" d="M4 19.3c2.3 3.6 10.6 3.1 18.1-.3 7-3.2 8.2-6.9 5.5-7.8-2.2-.7-6.1.8-9.7 2.7M12.2 19.8c-4.4.9-7.6.5-8.1-1.1-.5-1.5 2.4-4.4 7.4-6.8" /></>;
      case "jupiter": return <><circle className="planet-disc" cx="16" cy="16" r="9" /><path className="planet-band" d="M8.1 11.5h15.8M7.1 15.4h17.8M8.1 20.3h15.8" /><ellipse cx="20.3" cy="17.7" rx="2.2" ry="1" /></>;
      case "venus": return <><circle className="planet-disc" cx="16" cy="16" r="8" /><path className="planet-shade" d="M18.8 8.6c-5.4 1.4-7.4 8-3.6 12.1 1.1 1.2 2.4 2 4 2.4" /></>;
      case "mercury": return <><circle className="planet-disc" cx="16" cy="16" r="7" /><path className="planet-shade" d="M17.8 9.2c-4.2 1-6.1 5.7-4.2 9.5 1 1.9 2.5 3.2 4.5 3.8" /></>;
      case "mars": return <><circle className="planet-disc" cx="16" cy="16" r="7.6" /><path className="planet-detail" d="M10.3 13.2c3.1-1.8 7.2-1.3 9.9 1.2M13 21c1.7-1 4-1.1 5.9-.2" /></>;
      case "uranus": return <><circle className="planet-disc" cx="16" cy="16" r="7.6" /><ellipse className="planet-band" cx="16" cy="16" rx="11" ry="4" /></>;
      case "neptune": return <><circle className="planet-disc" cx="16" cy="16" r="7.6" /><path className="planet-detail" d="M8.9 13.4h14.2M9.4 19h13.2" /></>;
      case "pluto": return <><circle className="planet-disc" cx="16" cy="16" r="5.4" /><path className="planet-detail" d="M13 13c2.4-1.4 5-.5 6.3 1.5" /></>;
      case "satellite": return <><path d="m12 12 8 8M10 15l-4 4 7 7 4-4M15 10l4-4 7 7-4 4" /><circle cx="16" cy="16" r="3" /></>;
      case "radiant": return <><circle cx="16" cy="16" r="4" /><path d="M16 3v8M16 21v8M3 16h8M21 16h8M6.8 6.8l5.6 5.6M19.6 19.6l5.6 5.6M25.2 6.8l-5.6 5.6M12.4 19.6l-5.6 5.6" /></>;
      case "cluster": return <><circle cx="10" cy="17" r="2" /><circle cx="16" cy="10" r="2.4" /><circle cx="21" cy="18" r="2" /><circle cx="14" cy="23" r="1.5" /><circle cx="23" cy="9" r="1.2" /></>;
      case "deep-sky": return <><ellipse cx="16" cy="16" rx="11" ry="6" /><ellipse cx="16" cy="16" rx="5" ry="10" /><circle cx="16" cy="16" r="1.5" /></>;
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
  const [layers, setLayers] = useState<Set<SkyLayerId>>(() => new Set(DEFAULT_SKY_LAYERS));
  const [searchOpen, setSearchOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
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
  const layersTrigger = useRef<HTMLButtonElement>(null);
  const layersClose = useRef<HTMLButtonElement>(null);
  const stream = useRef<MediaStream | null>(null);
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
    if (!layersOpen) return;
    const frame = window.requestAnimationFrame(() => layersClose.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [layersOpen]);

  const targetSolution = useMemo(() => selectedTarget ? solutionForSkyFinderTarget(selectedTarget, observer, astronomyNow) : null, [astronomyNow, observer, selectedTarget]);
  const targetPosition = targetSolution?.horizontal ?? null;
  useEffect(() => {
    if (!targetPosition || sensorsEnabled) return;
    setManualCentre({ altitudeDeg: Math.max(-10, targetPosition.altitudeDeg), azimuthDeg: targetPosition.azimuthDeg });
  }, [selectedTarget?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const requestOrientation = useCallback(async () => {
    if (!capabilities.orientation || !liveDate) { setMessage("Orientation isn’t available. Drag the sky to explore."); return; }
    setSensorPermission("requesting");
    try {
      const orientation = permissionConstructor("DeviceOrientationEvent");
      const result = orientation?.requestPermission ? await orientation.requestPermission() : "granted";
      setSensorPermission(result); setSensorsEnabled(result === "granted");
      if (result !== "granted") setMessage("Orientation wasn’t granted. Drag the sky to explore.");
    } catch { setSensorPermission("denied"); setMessage("Orientation wasn’t granted. Drag the sky to explore."); }
  }, [capabilities.orientation, liveDate]);
  useEffect(() => {
    if (!launch || !selectedTarget || launch.targetId !== selectedTarget.id) return;
    setSensorPermission("requesting");
    void launch.sensor.then((result) => { setSensorPermission(result); setSensorsEnabled(result === "granted"); });
  }, [launch, selectedTarget]);
  useEffect(() => {
    if (capabilities.handheldEligible && capabilities.orientation && !capabilities.orientationPermissionRequest) { setSensorPermission("granted"); setSensorsEnabled(true); }
  }, [capabilities]);
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
  const viewCentre = sensorsEnabled && pointing ? pointing : manualCentre;
  const displayPose = useMemo(() => sensorsEnabled && pose ? pose : devicePoseLookingAt(viewCentre), [pose, sensorsEnabled, viewCentre]);
  const displayProjection = useMemo<CameraProjectionModel>(() => cameraPhase === "active" ? cameraProjection : { ...cameraProjection, horizontalFovDeg: SKY_HORIZONTAL_FOV_DEG / zoom, verticalFovDeg: SKY_VERTICAL_FOV_DEG / zoom, sourceWidthPx: stage.current?.clientWidth || cameraProjection.viewportWidthPx, sourceHeightPx: stage.current?.clientHeight || cameraProjection.viewportHeightPx, fit: "contain" }, [cameraPhase, cameraProjection, zoom]);

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
      const points = figure.directions.map((direction) => projectEnuDirection(direction, displayPose, displayProjection)).filter((p) => p.inField);
      if (points.length < 3) return [];
      const c = points.reduce((sum, p) => ({ x: sum.x + p.xPercent, y: sum.y + p.yPercent }), { x: 0, y: 0 }); c.x /= points.length; c.y /= points.length;
      return [{ ...figure, points: [...points].sort((a, b) => Math.atan2(a.yPercent - c.y, a.xPercent - c.x) - Math.atan2(b.yPercent - c.y, b.xPercent - c.x)) }];
    });
    const milkyWay = expectedContext.milkyWay.flatMap((line) => { const start = projectEnuDirection(line.start, displayPose, displayProjection); const end = projectEnuDirection(line.end, displayPose, displayProjection); return start.inFront && end.inFront ? [{ ...line, start, end }] : []; });
    return { stars, lines, labels, objects, figures, milkyWay };
  }, [displayPose, displayProjection, expectedContext]);

  const usesMagnetic = orientationTelemetry?.magneticHeadingDeg != null && !calibration;
  const quality: PointingQuality = calibration ? sensorQuality === "poor" ? "fair" : sensorQuality : usesMagnetic ? "poor" : sensorQuality;
  const targetPointing = sensorsEnabled ? pointing : viewCentre;
  const alignment = alignmentFor(targetPointing, targetPosition, selectedTarget?.alignmentToleranceDeg ?? 3, sensorsEnabled ? quality : "fair");
  const projectedTarget = targetPosition ? projectEnuDirection(horizontalToEnu(targetPosition), displayPose, displayProjection) : null;
  const edgeCue = projectedTarget && !projectedTarget.inField ? edgeCueForProjection(projectedTarget) : null;
  const aboveHorizon = targetPosition !== null && targetPosition.altitudeDeg > 0;
  const nextRiseUtc = useMemo(() => selectedTarget && targetPosition && targetPosition.altitudeDeg < 0 ? nextRiseForSkyFinderTarget(selectedTarget, observer, astronomyNow) : null, [astronomyNow, observer, selectedTarget, targetPosition]);
  const guidance = selectedTarget ? guidanceForSkyTarget(selectedTarget.title, targetPointing, targetPosition, selectedTarget.alignmentToleranceDeg, sensorsEnabled ? quality : "fair") : null;
  const guidanceTitle = guidance?.kind === "direction" && !sensorsEnabled && targetPosition ? `${cardinal(targetPosition.azimuthDeg)} · ${describeTargetAltitude(targetPosition.altitudeDeg)}` : guidance?.instruction ?? "Explore the sky";
  const targetMarker = selectedTarget ? skyMarkerKindForTarget(selectedTarget) : null;
  const moonPhase = useMemo(() => { try { return Illumination(Body.Moon, astronomyNow).phase_fraction; } catch { return 0.5; } }, [astronomyNow]);
  const phase = skyPhase(expectedContext?.sunAltitudeDeg ?? null);
  const effectiveProjection = effectiveCameraProjection(displayProjection);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchTrigger.current?.focus());
  }, []);
  const closeLayers = useCallback(() => {
    setLayersOpen(false);
    window.requestAnimationFrame(() => layersTrigger.current?.focus());
  }, []);

  const chooseTarget = (entry: SkySearchEntry) => {
    setSelectedTarget(entry.target);
    const position = positionForSkyFinderTarget(entry.target, observer, astronomyNow);
    if (position) setManualCentre({ altitudeDeg: Math.max(-12, position.altitudeDeg), azimuthDeg: position.azimuthDeg });
    closeSearch(); setQuery("");
  };
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (sensorsEnabled) return; drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, centre: manualCentre }; event.currentTarget.setPointerCapture(event.pointerId); };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (!drag.current || drag.current.id !== event.pointerId || sensorsEnabled) return; const s = 0.14 / zoom; setManualCentre({ azimuthDeg: normalizeDegrees(drag.current.centre.azimuthDeg - (event.clientX - drag.current.x) * s), altitudeDeg: Math.max(-30, Math.min(89, drag.current.centre.altitudeDeg + (event.clientY - drag.current.y) * s)) }); };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (drag.current?.id === event.pointerId) drag.current = null; };
  const toggleLayer = (id: SkyLayerId) => setLayers((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const updateAlertCategory = (category: SatelliteAlertCategory) => setAlertPreferences((current) => ({ ...current, categories: { ...current.categories, [category]: !current.categories[category] } }));
  const targetStyle = { "--finder-x": `${(projectedTarget?.xPercent ?? 50) - 50}%`, "--finder-y": `${(projectedTarget?.yPercent ?? 50) - 50}%` } as CSSProperties;

  return <section className="tk-sky-finder tk-sky-explorer" data-camera={cameraPhase === "active" ? "active" : "off"} data-visual-base={cameraPhase === "active" ? "camera" : "rendered-sky"} data-aligned={alignment.aligned ? "true" : "false"} data-mode={selectedTarget ? "targeted" : "browse"} data-sky-phase={phase} data-device-class={capabilities.deviceClass} data-target-altitude={targetPosition?.altitudeDeg.toFixed(3)} data-target-azimuth={targetPosition?.azimuthDeg.toFixed(3)} data-expected-stars={projectedContext?.stars.length ?? 0} data-expected-lines={projectedContext?.lines.length ?? 0} data-expected-labels={projectedContext?.labels.length ?? 0} data-expected-objects={projectedContext?.objects.length ?? 0} data-constellation-identities="88" data-camera-horizontal-fov={effectiveProjection.horizontalFovDeg.toFixed(3)} data-camera-vertical-fov={effectiveProjection.verticalFovDeg.toFixed(3)} data-camera-crop-axis={effectiveProjection.cropAxis} data-heading-reference={orientationTelemetry?.magneticHeadingDeg != null ? calibration ? "magnetic-calibrated" : "magnetic-uncorrected" : "event-alpha"} aria-label="Sky">
    <div ref={stage} className="tk-finder-stage" style={targetStyle} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onWheel={(event) => { if (cameraPhase === "active") return; event.preventDefault(); setZoom((value) => Math.max(0.72, Math.min(2.8, value * (event.deltaY > 0 ? 0.9 : 1.1)))); }}>
      <video ref={video} className="tk-finder-camera" autoPlay muted playsInline aria-hidden />
      <div className="tk-finder-sky" aria-hidden /><div className="tk-finder-shade" aria-hidden />
      {projectedContext ? <div className="tk-finder-expected-field" aria-hidden><svg viewBox="0 0 100 100" preserveAspectRatio="none"><defs><filter id="sky-milky-blur"><feGaussianBlur stdDeviation="2.6" /></filter></defs>{layers.has("milky-way") ? <g className="tk-finder-milky-way" filter="url(#sky-milky-blur)">{projectedContext.milkyWay.map((line) => <line key={line.id} x1={line.start.xPercent} y1={line.start.yPercent} x2={line.end.xPercent} y2={line.end.yPercent} />)}</g> : null}{layers.has("constellation-figures") ? <g className="tk-finder-constellation-figures">{projectedContext.figures.map((figure) => <polygon key={figure.symbol} points={figure.points.map((p) => `${p.xPercent},${p.yPercent}`).join(" ")} data-primary={figure.primary ? "true" : undefined} />)}</g> : null}{layers.has("constellation-lines") ? <g className="tk-finder-constellation-lines">{projectedContext.lines.map((line) => <line key={line.id} x1={line.start.xPercent} y1={line.start.yPercent} x2={line.end.xPercent} y2={line.end.yPercent} data-primary={line.primary ? "true" : undefined} data-constellation={line.constellation} data-start-star={line.startStarId} data-end-star={line.endStarId} />)}</g> : null}{layers.has("constellation-names") ? <g className="tk-finder-constellation-labels">{projectedContext.labels.map((label) => <text key={label.symbol} x={label.xPercent} y={label.yPercent} data-primary={label.primary ? "true" : undefined}>{label.name}</text>)}</g> : null}</svg>
        {layers.has("stars") ? projectedContext.stars.map((star) => <span key={star.id} className="tk-finder-star" data-target-constellation={star.inTargetConstellation ? "true" : undefined} style={{ left: `${star.xPercent}%`, top: `${star.yPercent}%`, "--star-size": `${star.radiusPx}px`, "--star-color": star.color, "--star-opacity": Math.max(0.08, (0.28 + star.luminance * 0.72) * Math.max(0.24, Math.min(1, (star.direction.up + 0.18) / 0.7))) } as CSSProperties}><i />{layers.has("star-names") && star.label ? <small>{star.label}</small> : null}</span>) : null}
        {projectedContext.objects.map((object) => { const body = !["satellite", "deep-sky", "cluster"].includes(object.marker); if (body && !layers.has("solar-system")) return null; if (object.marker === "satellite" && !layers.has("space-stations") && !layers.has("notable-satellites")) return null; if ((object.marker === "deep-sky" || object.marker === "cluster") && !layers.has("deep-sky")) return null; return <span key={object.id} className="tk-finder-object" style={{ left: `${object.xPercent}%`, top: `${object.yPercent}%` }}><SkyMarkerGlyph kind={object.marker} phase={moonPhase} /><small>{object.title}</small></span>; })}</div> : null}

      <div className="tk-sky-floating-tools" onPointerDown={(event) => event.stopPropagation()}><button ref={searchTrigger} type="button" onClick={() => { if (searchOpen) closeSearch(); else { setSearchOpen(true); setLayersOpen(false); } }} aria-label="Search the sky" aria-expanded={searchOpen}><Search size={18} aria-hidden /></button>{capabilities.camera && liveDate ? <button type="button" onClick={cameraPhase === "active" ? stopCamera : startCamera} aria-label={cameraPhase === "active" ? "Turn camera off" : "Turn camera on"} aria-pressed={cameraPhase === "active"} disabled={cameraPhase === "requesting"}>{cameraPhase === "active" ? <Camera size={18} aria-hidden /> : <CameraOff size={18} aria-hidden />}</button> : null}{capabilities.orientation && liveDate ? <button type="button" onClick={sensorsEnabled ? () => setSensorsEnabled(false) : requestOrientation} aria-label={sensorsEnabled ? "Use manual sky navigation" : "Use device orientation"} aria-pressed={sensorsEnabled}><Compass size={18} aria-hidden /></button> : null}<button ref={layersTrigger} type="button" onClick={() => { if (layersOpen) closeLayers(); else { setLayersOpen(true); setSearchOpen(false); } }} aria-label="Sky layers" aria-expanded={layersOpen}><Layers3 size={18} aria-hidden /></button></div>

      {searchOpen ? <section className="tk-sky-popover tk-sky-search" role="dialog" aria-label="Search the sky" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeSearch(); } }} onPointerDown={(event) => event.stopPropagation()}><header><Search size={16} aria-hidden /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Planet, star, constellation…" aria-label="Search celestial objects" /><button type="button" onClick={closeSearch} aria-label="Close search"><X size={17} aria-hidden /></button></header><div className="tk-sky-search-results">{searchResults.map((entry) => <button type="button" key={`${entry.kind}-${entry.id}`} onClick={() => chooseTarget(entry)}><SkyMarkerGlyph kind={skyMarkerKindForTarget(entry.target)} /><span><strong>{entry.title}</strong><small>{entry.subtitle}</small></span></button>)}</div></section> : null}

      {layersOpen ? <section className="tk-sky-popover tk-sky-layers" role="dialog" aria-label="Sky layers" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeLayers(); } }} onPointerDown={(event) => event.stopPropagation()}><header><span><Layers3 size={16} aria-hidden /> Layers</span><button ref={layersClose} type="button" onClick={closeLayers} aria-label="Close layers"><X size={17} aria-hidden /></button></header><div className="tk-sky-layer-list">{SKY_LAYER_IDS.map((id) => <label key={id}><span>{SKY_LAYER_LABELS[id]}</span><input type="checkbox" checked={layers.has(id)} onChange={() => toggleLayer(id)} /></label>)}</div><details className="tk-sky-alerts"><summary><BellRing size={15} aria-hidden /> Satellite alerts</summary><label className="tk-sky-alert-master"><span>Alert me to worthwhile passes</span><input type="checkbox" checked={alertPreferences.enabled} onChange={() => setAlertPreferences((current) => ({ ...current, enabled: !current.enabled }))} /></label>{(["space-stations", "starlink-trains", "bright-satellites"] as SatelliteAlertCategory[]).map((category) => <label key={category}><span>{alertCategoryLabel(category)}</span><input type="checkbox" checked={alertPreferences.categories[category]} disabled={!alertPreferences.enabled} onChange={() => updateAlertCategory(category)} /></label>)}<label><span>Lead time</span><select value={alertPreferences.leadMinutes} disabled={!alertPreferences.enabled} onChange={(event) => setAlertPreferences((current) => ({ ...current, leadMinutes: Number(event.target.value) as SatelliteAlertLeadMinutes }))}><option value={10}>10 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={360}>Same day</option></select></label><p>Saved on this device. Push delivery still needs a notification service.</p></details><details className="tk-sky-accuracy"><summary>Accuracy and calibration</summary><p>{sensorsEnabled ? `Orientation ${quality}${headingAccuracy !== null ? ` · ±${Math.round(headingAccuracy)}°` : ""}` : "Manual sky navigation"}</p>{rawPointing && selectedTarget && targetPosition ? <button type="button" onClick={() => setCalibration(calibrationFromAlignment(rawPointing, targetPosition, selectedTarget.id, new Date().toISOString()))}>Align selected target here</button> : null}{calibration ? <button type="button" onClick={() => setCalibration(null)}>Clear calibration</button> : null}</details></section> : null}

      {!sensorsEnabled && cameraPhase !== "active" ? <div className="tk-sky-zoom" onPointerDown={(event) => event.stopPropagation()}><button type="button" onClick={() => setZoom((value) => Math.min(2.8, value * 1.22))} aria-label="Zoom in"><ZoomIn size={18} aria-hidden /></button><button type="button" onClick={() => setZoom((value) => Math.max(0.72, value / 1.22))} aria-label="Zoom out"><ZoomOut size={18} aria-hidden /></button></div> : null}
      <div className="tk-finder-sky-context" aria-hidden><span>{expectedContext?.constellation?.name ?? "Current sky"}</span><strong>{cardinal(viewCentre.azimuthDeg)} · {Math.round(viewCentre.altitudeDeg)}°</strong></div>{layers.has("horizon") ? <div className="tk-finder-horizon" aria-hidden><span>{Math.round(viewCentre.azimuthDeg)}°</span><strong>{cardinal(viewCentre.azimuthDeg)}</strong></div> : null}
      {selectedTarget ? <div className="tk-finder-guidance" aria-live="polite"><SkyMarkerGlyph kind={targetMarker!} phase={moonPhase} /><span><small>{selectedTarget.title}</small><strong>{aboveHorizon ? guidanceTitle : `${selectedTarget.title} is below the horizon`}</strong></span>{aboveHorizon && alignment.aligned ? <em>On target</em> : nextRiseUtc ? <em>Rises {formatClockTime(nextRiseUtc, clock)}</em> : null}</div> : <div className="tk-sky-browse-hint"><strong>Explore tonight’s sky</strong><span>Drag to look around · use zoom controls</span></div>}
      {aboveHorizon && projectedTarget?.inField && selectedTarget ? <div className="tk-finder-lock" data-shape={selectedTarget.shape} data-marker={targetMarker} aria-hidden><SkyMarkerGlyph kind={targetMarker!} phase={moonPhase} /><em>{alignment.aligned ? `${selectedTarget.title} is here` : selectedTarget.title}</em></div> : null}{aboveHorizon && edgeCue && selectedTarget ? <div className="tk-finder-edge-cue" style={{ left: `${edgeCue.xPercent}%`, top: `${edgeCue.yPercent}%` }} aria-hidden><SkyMarkerGlyph kind={targetMarker!} phase={moonPhase} /><span>{guidanceTitle}</span></div> : null}
      {selectedTarget ? <div className="tk-finder-target-card"><span><small>{targetPosition ? `${cardinal(targetPosition.azimuthDeg)} · ${describeTargetAltitude(targetPosition.altitudeDeg)}` : "Position unavailable"}</small><strong>{selectedTarget.appearance}</strong></span><b>{aboveHorizon ? skyTargetEquipmentLabel(selectedTarget) : nextRiseUtc ? `Rises ${formatClockTime(nextRiseUtc, clock)}` : "Below horizon"}</b></div> : null}
      {message ? <p className="tk-sky-toast" role="status">{message}</p> : null}
      {diagnosticsEnabled ? <aside className="tk-finder-developer" aria-label="AR projection diagnostics"><header><strong>AR diagnostics</strong><span>Local developer view · not consumer UI</span></header><dl><div><dt>Target</dt><dd>{selectedTarget?.title ?? "None"}</dd></div><div><dt>UTC</dt><dd>{astronomyNow.toISOString()}</dd></div><div><dt>Observer</dt><dd>{observer.latitudeDeg.toFixed(5)}, {observer.longitudeDeg.toFixed(5)}</dd></div><div><dt>RA / Dec</dt><dd>{targetSolution?.equatorial ? `${targetSolution.equatorial.raHours.toFixed(5)}h / ${targetSolution.equatorial.decDeg.toFixed(4)}°` : "Not applicable"}</dd></div><div><dt>Expected Az / Alt</dt><dd>{targetPosition ? `${targetPosition.azimuthDeg.toFixed(3)}° / ${targetPosition.altitudeDeg.toFixed(3)}°` : "Unavailable"}</dd></div><div><dt>Local ENU</dt><dd>{targetSolution ? `${targetSolution.enu.east.toFixed(5)}, ${targetSolution.enu.north.toFixed(5)}, ${targetSolution.enu.up.toFixed(5)}` : "Unavailable"}</dd></div><div><dt>Device heading</dt><dd>{pointing ? `${pointing.azimuthDeg.toFixed(2)}°` : "Manual"}</dd></div><div><dt>Pitch / roll</dt><dd>{orientationTelemetry ? `${orientationTelemetry.betaDeg.toFixed(2)}° / ${orientationTelemetry.gammaDeg.toFixed(2)}°` : "Manual"}</dd></div><div><dt>Quaternion</dt><dd>{pose ? `${pose.x.toFixed(5)}, ${pose.y.toFixed(5)}, ${pose.z.toFixed(5)}, ${pose.w.toFixed(5)}` : "Manual view pose"}</dd></div><div><dt>Magnetic heading</dt><dd>{orientationTelemetry?.magneticHeadingDeg != null ? `${orientationTelemetry.magneticHeadingDeg.toFixed(2)}°` : "Unavailable"}</dd></div><div><dt>True-north correction</dt><dd>{calibration ? `${calibration.azimuthOffsetDeg.toFixed(2)}°` : "Unavailable in browser API"}</dd></div><div><dt>Screen orientation</dt><dd>{screenAngle()}°</dd></div><div><dt>Camera FOV</dt><dd>{effectiveProjection.horizontalFovDeg.toFixed(2)}° × {effectiveProjection.verticalFovDeg.toFixed(2)}°</dd></div><div><dt>Video / viewport</dt><dd>{cameraProjection.sourceWidthPx}×{cameraProjection.sourceHeightPx} / {cameraProjection.viewportWidthPx}×{cameraProjection.viewportHeightPx}</dd></div><div><dt>Crop</dt><dd>{effectiveProjection.cropAxis} · {(effectiveProjection.visibleFraction * 100).toFixed(1)}%</dd></div><div><dt>Projected X / Y</dt><dd>{projectedTarget ? `${projectedTarget.xPercent.toFixed(2)}% / ${projectedTarget.yPercent.toFixed(2)}%` : "Unavailable"}</dd></div></dl></aside> : null}
    </div>
  </section>;
}
