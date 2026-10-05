import {
  Camera,
  CameraOff,
  Compass,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import {
  calibratedDevicePose,
  devicePoseFromOrientationWithHeading,
  devicePoseLookingAt,
  DevicePoseStabilizer,
  edgeCueForProjection,
  effectiveCameraProjection,
  horizontalToEnu,
  normalizeDegrees,
  pointingFromDevicePose,
  projectEnuDirection,
  SKY_HORIZONTAL_FOV_DEG,
  SKY_VERTICAL_FOV_DEG,
  type CameraProjectionModel,
  type DevicePose,
} from "../../astronomy/topocentricSky";
import {
  alignmentFor,
  calibrationFromAlignment,
  canRequestSkyFinderPermission,
  detectSkyFinderCapabilities,
  describeTargetAltitude,
  guidanceForSkyTarget,
  nextRiseForSkyFinderTarget,
  positionForSkyFinderTarget,
  solutionForSkyFinderTarget,
  skyFinderExperience,
  supportsLiveSkyFinder,
  type FinderCalibration,
  type FinderCapabilities,
  type PhonePointing,
  type PointingQuality,
  type SkyFinderTarget,
} from "../../data/tracker/skyFinder";
import type { ExpectedSkyContext } from "../../data/tracker/skyFinderContext";
import { skyMarkerKindForTarget, type SkyMarkerKind } from "../../data/tracker/skyMarker";

type PermissionPhase = "idle" | "requesting" | "granted" | "denied" | "unavailable";
type CameraPhase = "idle" | "requesting" | "active" | "denied" | "unavailable";

interface Props {
  target: SkyFinderTarget;
  references: SkyFinderTarget[];
  observer: { latitudeDeg: number; longitudeDeg: number; label: string };
  clock: PlaceClock;
  /** False for historical/future Tracker dates: physical pointing is disabled. */
  liveDate: boolean;
  /** Permission work initiated synchronously by the original target action. */
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

interface PermissionConstructor {
  requestPermission?: () => Promise<"granted" | "denied">;
}

function permissionConstructor(name: "DeviceOrientationEvent" | "DeviceMotionEvent") {
  return (window[name] as unknown as PermissionConstructor | undefined) ?? null;
}

type LaunchSensorResult = "granted" | "denied" | "unavailable";
type LaunchCameraResult =
  | { phase: "active"; stream: MediaStream }
  | { phase: "denied" | "unavailable"; message: string };

export interface SkyFinderLaunchAttempt {
  targetId: string;
  sensor: Promise<LaunchSensorResult>;
  camera: Promise<LaunchCameraResult> | null;
}

/**
 * Begin protected work during the user's original Find in Sky action.
 *
 * iOS requires orientation permission to be requested from the gesture itself;
 * mounting a screen and asking from a later effect is already too late. Both
 * constructor calls and getUserMedia therefore happen synchronously here,
 * before navigation. Unsupported devices and selected dates return without
 * touching any protected API; the caller does not expose Sky in those states.
 */
export function beginSkyFinderLaunch(
  targetId: string,
  capabilities: FinderCapabilities,
  liveDate: boolean,
): SkyFinderLaunchAttempt | null {
  if (!supportsLiveSkyFinder(capabilities) || !liveDate) return null;

  let orientationRequest: Promise<"granted" | "denied">;
  try {
    const orientation = permissionConstructor("DeviceOrientationEvent");
    orientationRequest = orientation?.requestPermission
      ? orientation.requestPermission()
      : capabilities.orientation
        ? Promise.resolve("granted")
        : Promise.resolve("denied");
  } catch {
    orientationRequest = Promise.resolve("denied");
  }

  // Start the optional motion request before awaiting orientation so Safari
  // still sees the same user activation. Denial does not cancel orientation.
  try {
    const motion = permissionConstructor("DeviceMotionEvent");
    if (
      motion?.requestPermission &&
      canRequestSkyFinderPermission(capabilities, "motion", { liveDate, userInitiated: true })
    ) {
      void motion.requestPermission().catch(() => "denied");
    }
  } catch {
    // Orientation alone remains useful.
  }

  const sensor = orientationRequest.then<LaunchSensorResult>((answer) =>
    answer === "granted" ? "granted" : "denied",
  );

  let camera: Promise<LaunchCameraResult> | null = null;
  if (
    canRequestSkyFinderPermission(capabilities, "camera", { liveDate, userInitiated: true })
  ) {
    camera = navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => ({ phase: "active" as const, stream }))
      .catch((error: unknown) => {
        const denied =
          error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name);
        return {
          phase: denied ? "denied" as const : "unavailable" as const,
          message: denied
            ? "Camera unavailable — guidance continues with the night view."
            : "Camera unavailable — guidance continues with the night view.",
        };
      });
  }

  return { targetId, sensor, camera };
}

function screenAngle(): number {
  const modern = window.screen.orientation?.angle;
  if (typeof modern === "number") return modern;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

function qualityLabel(quality: PointingQuality): string {
  switch (quality) {
    case "good":
      return "Good";
    case "fair":
      return "Usable";
    case "poor":
      return "Low";
    default:
      return "Unavailable";
  }
}

function equipmentLabel(target: SkyFinderTarget): string {
  if (target.equipment === "telescope") return "Telescope recommended";
  if (target.equipment === "binoculars") return "Binoculars recommended";
  if (/dark|faint|averted/i.test(target.appearance)) return "Naked eye under dark skies";
  return "Easy naked eye";
}

function shapeLabel(target: SkyFinderTarget): string {
  if (target.shape === "radiant") return "Radiant region";
  if (target.shape === "cluster") return "Cluster region";
  if (target.shape === "region") return "Approximate object region";
  return "Target position";
}

function SkyMarkerGlyph({ kind, label }: { kind: SkyMarkerKind; label?: string }) {
  const art = (() => {
    switch (kind) {
      case "sun":
        return <><circle cx="16" cy="16" r="6.3" /><path d="M16 2.5v4M16 25.5v4M2.5 16h4M25.5 16h4M6.5 6.5l2.9 2.9M22.6 22.6l2.9 2.9M25.5 6.5l-2.9 2.9M9.4 22.6l-2.9 2.9" /></>;
      case "moon":
        return <><path d="M21.8 24.2A10.6 10.6 0 1 1 19 5.7c-4.2 2.2-6 7-4.2 11.1 1.2 2.9 3.8 5.5 7 7.4Z" /><circle cx="12" cy="11" r="1.1" /><circle cx="17" cy="20" r=".8" /></>;
      case "saturn":
        return <><circle cx="16" cy="16" r="6.2" /><path d="M4.2 19.1c2.2 3.2 9.8 3.1 17-.1 7.1-3.1 8.8-6.7 6.7-7.9-1.3-.8-4.1-.1-7.3 1.2M11.2 19.7c-4.2 1-7.2.9-7.8-.5-.8-1.8 2.7-5.2 8-7.6" /></>;
      case "jupiter":
        return <><circle cx="16" cy="16" r="9" /><path d="M8.1 12h15.8M7.2 16h17.6M8.1 20h15.8" /><ellipse cx="20" cy="17.8" rx="2.2" ry="1" /></>;
      case "venus":
        return <><circle cx="16" cy="13" r="7" /><path d="M16 20v9M11.8 25h8.4" /><path d="M19.7 7.1c-3.7 1-5.8 5-4.6 8.6.6 1.8 1.8 3.3 3.4 4.1" /></>;
      case "mercury":
        return <><circle cx="16" cy="14" r="6.5" /><path d="M10.5 4.1c1.1 2 3 3.1 5.5 3.1s4.4-1.1 5.5-3.1M16 20.5v8M12 25h8" /></>;
      case "mars":
        return <><circle cx="13" cy="18" r="7" /><path d="M18 13 27 4M20.5 4H27v6.5" /><path d="M9.3 15.7c2-1.8 5.2-1.8 7.2.1" /></>;
      case "satellite":
        return <><path d="m12 12 8 8M10 15l-4 4 7 7 4-4M15 10l4-4 7 7-4 4" /><circle cx="16" cy="16" r="3" /></>;
      case "radiant":
        return <><circle cx="16" cy="16" r="4" /><path d="M16 3v8M16 21v8M3 16h8M21 16h8M6.8 6.8l5.6 5.6M19.6 19.6l5.6 5.6M25.2 6.8l-5.6 5.6M12.4 19.6l-5.6 5.6" /></>;
      case "cluster":
        return <><circle cx="10" cy="17" r="2" /><circle cx="16" cy="10" r="2.4" /><circle cx="21" cy="18" r="2" /><circle cx="14" cy="23" r="1.5" /><circle cx="23" cy="9" r="1.2" /></>;
      case "deep-sky":
        return <><ellipse cx="16" cy="16" rx="11" ry="6" /><ellipse cx="16" cy="16" rx="5" ry="10" /><circle cx="16" cy="16" r="1.5" /></>;
      default:
        return <><circle cx="16" cy="16" r="8" /><path d="M8 16h16M16 8v16" /></>;
    }
  })();
  return (
    <span className="tk-sky-object-glyph" data-marker={kind} aria-label={label}>
      <svg viewBox="0 0 32 32" aria-hidden>{art}</svg>
    </span>
  );
}

function cardinalDirection(azimuthDeg: number): string {
  const labels = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  return labels[Math.round(normalizeDegrees(azimuthDeg) / 45) % labels.length];
}

function chooseReference(targets: SkyFinderTarget[]): SkyFinderTarget | null {
  const priorities = ["moon", "venus", "jupiter", "sirius", "mars", "saturn"];
  return (
    [...targets].sort((a, b) => {
      const aName = a.title.toLowerCase();
      const bName = b.title.toLowerCase();
      const aRank = priorities.findIndex((name) => aName.includes(name));
      const bRank = priorities.findIndex((name) => bName.includes(name));
      return (aRank < 0 ? 99 : aRank) - (bRank < 0 ? 99 : bRank);
    })[0] ?? null
  );
}

export function SkyFinder({ target, references, observer, clock, liveDate, launch = null, onClose }: Props) {
  const capabilities = useMemo(() => detectSkyFinderCapabilities(), []);
  const [astronomyNow, setAstronomyNow] = useState(() => new Date());
  const [sensorsEnabled, setSensorsEnabled] = useState(false);
  const [sensorPermission, setSensorPermission] = useState<PermissionPhase>("idle");
  const [rawPose, setRawPose] = useState<DevicePose | null>(null);
  const [rawPointing, setRawPointing] = useState<PhonePointing | null>(null);
  const [sensorQuality, setSensorQuality] = useState<PointingQuality>("unavailable");
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [orientationTelemetry, setOrientationTelemetry] = useState<OrientationTelemetry | null>(null);
  const [calibration, setCalibration] = useState<FinderCalibration | null>(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [cameraPhase, setCameraPhase] = useState<CameraPhase>("idle");
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [expectedContext, setExpectedContext] = useState<ExpectedSkyContext | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const stabilizer = useRef(new DevicePoseStabilizer());
  const lastAbsolute = useRef(0);
  const diagnosticsEnabled = useMemo(() => {
    if (typeof window === "undefined") return false;
    const local = ["127.0.0.1", "localhost"].includes(window.location.hostname);
    if (!local) return false;
    if (new URLSearchParams(window.location.search).get("skyDiagnostics") === "1") return true;
    try {
      return window.sessionStorage.getItem("orbit.skyDiagnostics") === "1";
    } catch {
      return false;
    }
  }, []);
  const cameraFov = useMemo(() => {
    if (typeof window === "undefined") {
      return { horizontal: SKY_HORIZONTAL_FOV_DEG, vertical: SKY_VERTICAL_FOV_DEG };
    }
    const params = new URLSearchParams(window.location.search);
    const requestedHorizontal = diagnosticsEnabled ? Number(params.get("skyHfov")) : Number.NaN;
    const requestedVertical = diagnosticsEnabled ? Number(params.get("skyVfov")) : Number.NaN;
    return {
      horizontal: Number.isFinite(requestedHorizontal) && requestedHorizontal >= 30 && requestedHorizontal <= 130
        ? requestedHorizontal
        : SKY_HORIZONTAL_FOV_DEG,
      vertical: Number.isFinite(requestedVertical) && requestedVertical >= 25 && requestedVertical <= 120
        ? requestedVertical
        : SKY_VERTICAL_FOV_DEG,
    };
  }, [diagnosticsEnabled]);
  const [cameraProjection, setCameraProjection] = useState<CameraProjectionModel>(() => ({
    horizontalFovDeg: cameraFov.horizontal,
    verticalFovDeg: cameraFov.vertical,
    sourceWidthPx: 0,
    sourceHeightPx: 0,
    viewportWidthPx: 0,
    viewportHeightPx: 0,
    fit: "cover",
  }));
  const deviceExperience = skyFinderExperience(
    capabilities,
    sensorPermission === "denied" || sensorPermission === "unavailable"
      ? sensorPermission
      : sensorPermission === "granted"
        ? "granted"
        : "unknown",
  );

  useEffect(() => {
    const timer = window.setInterval(() => setAstronomyNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const targetSolution = useMemo(
    () => (liveDate ? solutionForSkyFinderTarget(target, observer, astronomyNow) : null),
    [astronomyNow, liveDate, observer, target],
  );
  const targetPosition = targetSolution?.horizontal ?? null;
  const solutionAt = astronomyNow;

  const refreshCameraProjection = useCallback(() => {
    const media = video.current;
    const viewport = stage.current;
    const settings = stream.current?.getVideoTracks()[0]?.getSettings();
    setCameraProjection({
      horizontalFovDeg: cameraFov.horizontal,
      verticalFovDeg: cameraFov.vertical,
      sourceWidthPx: media?.videoWidth || settings?.width || 0,
      sourceHeightPx: media?.videoHeight || settings?.height || 0,
      viewportWidthPx: viewport?.clientWidth || 0,
      viewportHeightPx: viewport?.clientHeight || 0,
      fit: "cover",
    });
  }, [cameraFov.horizontal, cameraFov.vertical]);

  useEffect(() => {
    const media = video.current;
    const viewport = stage.current;
    if (!media || !viewport) return undefined;
    const resize = new ResizeObserver(refreshCameraProjection);
    resize.observe(viewport);
    media.addEventListener("loadedmetadata", refreshCameraProjection);
    window.addEventListener("orientationchange", refreshCameraProjection);
    refreshCameraProjection();
    return () => {
      resize.disconnect();
      media.removeEventListener("loadedmetadata", refreshCameraProjection);
      window.removeEventListener("orientationchange", refreshCameraProjection);
    };
  }, [refreshCameraProjection]);

  const referenceOptions = useMemo(
    () =>
      references
        .filter(
          (candidate) =>
            candidate.id !== target.id &&
            candidate.equipment === "eyes" &&
            candidate.shape === "point",
        )
        .map((candidate) => ({
          target: candidate,
          position: positionForSkyFinderTarget(candidate, observer, astronomyNow),
        }))
        .filter(
          (entry): entry is { target: SkyFinderTarget; position: NonNullable<typeof entry.position> } =>
            entry.position !== null && entry.position.altitudeDeg >= 10,
        ),
    [astronomyNow, observer, references, target.id],
  );

  useEffect(() => {
    if (referenceId && referenceOptions.some((entry) => entry.target.id === referenceId)) return;
    setReferenceId(chooseReference(referenceOptions.map((entry) => entry.target))?.id ?? null);
  }, [referenceId, referenceOptions]);

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCameraPhase((phase) => (phase === "active" ? "idle" : phase));
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (!launch || launch.targetId !== target.id) return undefined;
    let cancelled = false;
    setSensorPermission("requesting");
    void launch.sensor.then((result) => {
      if (cancelled) return;
      setSensorPermission(result);
      setSensorsEnabled(result === "granted");
    });
    if (launch.camera) {
      setCameraPhase("requesting");
      void launch.camera.then(async (result) => {
        if (cancelled) {
          if (result.phase === "active") result.stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (result.phase !== "active") {
          setCameraPhase(result.phase);
          setCameraMessage(result.message);
          return;
        }
        stream.current?.getTracks().forEach((track) => track.stop());
        stream.current = result.stream;
        if (video.current) {
          video.current.srcObject = result.stream;
          void video.current.play().then(refreshCameraProjection).catch(() => undefined);
        }
        setCameraPhase("active");
      });
    }
    return () => {
      cancelled = true;
    };
  }, [launch, refreshCameraProjection, target.id]);

  const startCamera = useCallback(async () => {
    if (
      !canRequestSkyFinderPermission(capabilities, "camera", {
        liveDate,
        userInitiated: true,
      })
    ) {
      setCameraPhase("unavailable");
      setCameraMessage(
        "Camera unavailable — direction guidance is still available.",
      );
      return;
    }
    setCameraPhase("requesting");
    setCameraMessage(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        void video.current.play().then(refreshCameraProjection).catch(() => undefined);
      }
      setCameraPhase("active");
    } catch (error) {
      const denied = error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name);
      setCameraPhase(denied ? "denied" : "unavailable");
      setCameraMessage(
        denied
          ? "Camera unavailable — guidance continues with the night view."
          : "Camera unavailable — guidance continues with the night view.",
      );
    }
  }, [capabilities, liveDate, refreshCameraProjection]);

  useEffect(() => {
    if (
      capabilities.handheldEligible &&
      capabilities.orientation &&
      !capabilities.orientationPermissionRequest
    ) {
      setSensorPermission("granted");
      setSensorsEnabled(true);
    }
  }, [
    capabilities.handheldEligible,
    capabilities.orientation,
    capabilities.orientationPermissionRequest,
  ]);

  useEffect(() => {
    if (!sensorsEnabled) return undefined;

    const update = (incoming: Event) => {
      const event = incoming as SafariOrientationEvent;
      if (event.alpha === null || event.beta === null || event.gamma === null) return;
      const isAbsoluteEvent = event.type === "deviceorientationabsolute" || event.absolute === true;
      if (!isAbsoluteEvent && Date.now() - lastAbsolute.current < 1_000) return;
      if (isAbsoluteEvent) lastAbsolute.current = Date.now();

      const safariHeading = event.webkitCompassHeading;
      const validSafariHeading = typeof safariHeading === "number" && Number.isFinite(safariHeading) && safariHeading >= 0
        ? safariHeading
        : null;
      const nextPose = devicePoseFromOrientationWithHeading(
        event.alpha,
        event.beta,
        event.gamma,
        screenAngle(),
        validSafariHeading,
      );
      const filteredPose = stabilizer.current.update(nextPose, event.timeStamp || performance.now());
      setRawPose(filteredPose);
      setRawPointing(pointingFromDevicePose(filteredPose));

      const accuracy = event.webkitCompassAccuracy;
      setOrientationTelemetry({
        alphaDeg: event.alpha,
        betaDeg: event.beta,
        gammaDeg: event.gamma,
        screenOrientationDeg: screenAngle(),
        magneticHeadingDeg: validSafariHeading,
        compassAccuracyDeg: typeof accuracy === "number" && accuracy >= 0 ? accuracy : null,
        absolute: isAbsoluteEvent,
      });
      setHeadingAccuracy(typeof accuracy === "number" && accuracy >= 0 ? accuracy : null);
      if (typeof accuracy === "number" && accuracy >= 0) {
        setSensorQuality(accuracy <= 15 ? "good" : accuracy <= 30 ? "fair" : "poor");
      } else {
        setSensorQuality(isAbsoluteEvent ? "fair" : "poor");
      }
    };

    window.addEventListener("deviceorientationabsolute", update, true);
    window.addEventListener("deviceorientation", update, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", update, true);
      window.removeEventListener("deviceorientation", update, true);
      stabilizer.current.reset();
    };
  }, [sensorsEnabled]);

  const pose = useMemo(
    () => (rawPose ? calibratedDevicePose(rawPose, calibration) : null),
    [calibration, rawPose],
  );
  const pointing = useMemo(() => (pose ? pointingFromDevicePose(pose) : null), [pose]);
  const contextAzimuth = pointing
    ? Math.round(pointing.azimuthDeg / 3) * 3
    : targetPosition?.azimuthDeg ?? null;
  const contextAltitude = pointing
    ? Math.round(pointing.altitudeDeg / 3) * 3
    : targetPosition?.altitudeDeg ?? null;
  const contextCentre = useMemo(
    () =>
      contextAzimuth === null || contextAltitude === null
        ? null
        : { azimuthDeg: normalizeDegrees(contextAzimuth), altitudeDeg: contextAltitude },
    [contextAltitude, contextAzimuth],
  );
  const displayPose = useMemo(
    () => pose ?? (contextCentre ? devicePoseLookingAt(contextCentre) : null),
    [contextCentre, pose],
  );

  useEffect(() => {
    if (!contextCentre) {
      setExpectedContext(null);
      return undefined;
    }
    let cancelled = false;
    // The catalog and conventional figure data stay in Sky's lazy chunk. The
    // three-degree bucket follows the live pointing field without recomputing
    // 8,404 catalog stars on every noisy sensor event.
    void import("../../data/tracker/skyFinderContext").then(({ expectedSkyContext }) => {
      if (cancelled) return;
      setExpectedContext(expectedSkyContext(target, observer, solutionAt, contextCentre, references));
    });
    return () => {
      cancelled = true;
    };
  }, [contextCentre, observer, references, solutionAt, target]);

  const projectedContext = useMemo(() => {
    if (!expectedContext || !displayPose) return null;
    const stars = expectedContext.stars.flatMap((star) => {
      const projected = projectEnuDirection(star.direction, displayPose, cameraProjection);
      return projected.inField ? [{ ...star, ...projected }] : [];
    });
    const lines = expectedContext.lines.flatMap((line) => {
      const start = projectEnuDirection(line.start, displayPose, cameraProjection);
      const end = projectEnuDirection(line.end, displayPose, cameraProjection);
      if (!start.inFront || !end.inFront) return [];
      const withinExtendedField = [start, end].some(
        (point) => point.xPercent >= -20 && point.xPercent <= 120 && point.yPercent >= -20 && point.yPercent <= 120,
      );
      return withinExtendedField ? [{ ...line, start, end }] : [];
    });
    const labels = expectedContext.labels.flatMap((label) => {
      const projected = projectEnuDirection(label.direction, displayPose, cameraProjection);
      return projected.inField ? [{ ...label, ...projected }] : [];
    });
    const objects = expectedContext.objects.flatMap((object) => {
      const projected = projectEnuDirection(object.direction, displayPose, cameraProjection);
      return projected.inField ? [{ ...object, ...projected }] : [];
    });
    return { stars, lines, labels, objects };
  }, [cameraProjection, displayPose, expectedContext]);

  const usesUncorrectedMagneticHeading =
    orientationTelemetry?.magneticHeadingDeg !== null &&
    orientationTelemetry?.magneticHeadingDeg !== undefined &&
    !calibration;
  // Astronomy Engine's azimuth is true-north referenced, while Safari exposes
  // only a magnetic heading. Without a declination source the browser cannot
  // honestly claim a precise lock, even when the compass reports low sensor
  // uncertainty. A user alignment supplies the missing whole-pose correction.
  const effectiveQuality: PointingQuality = calibration
    ? sensorQuality === "poor" ? "fair" : sensorQuality
    : usesUncorrectedMagneticHeading ? "poor" : sensorQuality;
  const alignment = useMemo(
    () =>
      alignmentFor(pointing, targetPosition, target.alignmentToleranceDeg, effectiveQuality),
    [effectiveQuality, pointing, target.alignmentToleranceDeg, targetPosition],
  );

  const projectedTarget = displayPose && targetPosition
    ? projectEnuDirection(horizontalToEnu(targetPosition), displayPose, cameraProjection)
    : null;
  const effectiveProjection = useMemo(
    () => effectiveCameraProjection(cameraProjection),
    [cameraProjection],
  );
  const targetEdgeCue = projectedTarget && !projectedTarget.inField
    ? edgeCueForProjection(projectedTarget)
    : null;
  const reticleStyle = {
    "--finder-x": `${(projectedTarget?.xPercent ?? 50) - 50}%`,
    "--finder-y": `${(projectedTarget?.yPercent ?? 50) - 50}%`,
    "--finder-radius": `${Math.max(28, Math.min(64, 28 + target.angularRadiusDeg * 8))}px`,
  } as CSSProperties;

  const selectedReference = referenceOptions.find((entry) => entry.target.id === referenceId) ?? null;
  const alignReference = () => {
    if (!rawPointing || !selectedReference) return;
    setCalibration(
      calibrationFromAlignment(
        rawPointing,
        selectedReference.position,
        selectedReference.target.id,
        new Date().toISOString(),
      ),
    );
    setCalibrationOpen(false);
  };

  const aboveHorizon = targetPosition !== null && targetPosition.altitudeDeg > 0;
  const nextRiseUtc = useMemo(
    () =>
      targetPosition && targetPosition.altitudeDeg < 0
        ? nextRiseForSkyFinderTarget(target, observer, astronomyNow)
        : null,
    [astronomyNow, observer, target, targetPosition],
  );
  const noSensors = !capabilities.orientation || sensorPermission === "denied" || sensorPermission === "unavailable";
  const finderAvailability =
    targetPosition === null
      ? "Unavailable"
      : rawPointing
          ? "Live"
          : noSensors
            ? "Direction only"
            : sensorsEnabled
              ? "Waiting for sensor"
              : "Permission needed";
  const precision = effectiveQuality === "good" ? 1 : 5;
  const roundedSeparation =
    alignment.separationDeg === null
      ? null
      : Math.round(alignment.separationDeg / precision) * precision;
  const guidance = guidanceForSkyTarget(
    target.title,
    pointing,
    targetPosition,
    target.alignmentToleranceDeg,
    effectiveQuality,
  );
  const guidanceTitle = guidance.kind === "direction" && !pointing && targetPosition
    ? `Face ${cardinalDirection(targetPosition.azimuthDeg)}`
    : guidance.instruction;
  const guidanceDetail = guidance.kind === "below-horizon"
    ? nextRiseUtc
      ? `Rises ${formatClockTime(nextRiseUtc, clock)}`
      : "Not visible right now"
    : guidance.kind === "aligned"
      ? "On target"
    : roundedSeparation !== null
      ? `${roundedSeparation}° away`
      : targetPosition
        ? `${Math.round(targetPosition.azimuthDeg)}° · ${describeTargetAltitude(targetPosition.altitudeDeg)}`
        : "Position unavailable";
  const targetMarker = skyMarkerKindForTarget(target);

  return (
    <section
      className="tk-sky-finder"
      data-camera={cameraPhase === "active" ? "active" : "off"}
      data-visual-base={cameraPhase === "active" ? "camera" : "rendered-fallback"}
      data-aligned={alignment.aligned ? "true" : "false"}
      data-mode={targetPosition ? "live" : "unavailable"}
      data-device-class={capabilities.deviceClass}
      data-device-experience={deviceExperience}
      data-target-altitude={targetPosition?.altitudeDeg.toFixed(3)}
      data-target-azimuth={targetPosition?.azimuthDeg.toFixed(3)}
      data-angular-separation={alignment.separationDeg?.toFixed(3)}
      data-pointing-quality={effectiveQuality}
      data-visual-verification="not-attempted"
      data-expected-constellation={expectedContext?.constellation?.symbol}
      data-expected-stars={projectedContext?.stars.length ?? 0}
      data-expected-lines={projectedContext?.lines.length ?? 0}
      data-expected-labels={projectedContext?.labels.length ?? 0}
      data-expected-objects={projectedContext?.objects.length ?? 0}
      data-camera-horizontal-fov={effectiveProjection.horizontalFovDeg.toFixed(3)}
      data-camera-vertical-fov={effectiveProjection.verticalFovDeg.toFixed(3)}
      data-camera-crop-axis={effectiveProjection.cropAxis}
      data-camera-crop-visible-fraction={effectiveProjection.visibleFraction.toFixed(4)}
      data-heading-reference={typeof orientationTelemetry?.magneticHeadingDeg === "number"
        ? calibration ? "magnetic-calibrated" : "magnetic-uncorrected"
        : "event-alpha"}
      aria-label={`Find ${target.title} in the sky`}
    >
      <header className="tk-finder-header">
        <button type="button" className="tk-finder-icon" onClick={onClose} aria-label="Close Sky">
          <X size={20} aria-hidden />
        </button>
        <div className="tk-finder-guidance" aria-live="polite">
          <SkyMarkerGlyph kind={targetMarker} />
          <span>
            <small>Finding {target.title}</small>
            <strong>{guidanceTitle}</strong>
          </span>
          <em>{guidanceDetail}</em>
        </div>
        {capabilities.camera ? (
          <button
            type="button"
            className="tk-finder-icon"
            onClick={cameraPhase === "active" ? stopCamera : startCamera}
            aria-label={cameraPhase === "active" ? "Turn camera off" : "Turn camera on"}
            disabled={cameraPhase === "requesting"}
          >
            {cameraPhase === "active" ? <Camera size={20} aria-hidden /> : <CameraOff size={20} aria-hidden />}
          </button>
        ) : <span aria-hidden />}
      </header>

      <div ref={stage} className="tk-finder-stage" style={reticleStyle}>
        <video ref={video} className="tk-finder-camera" autoPlay muted playsInline aria-hidden />
        <div className="tk-finder-sky" aria-hidden />
        <div className="tk-finder-shade" aria-hidden />
        {projectedContext ? (
          <div className="tk-finder-expected-field" aria-hidden>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <g className="tk-finder-constellation-lines">
                {projectedContext.lines.map((line) => (
                  <line
                    key={line.id}
                    x1={line.start.xPercent}
                    y1={line.start.yPercent}
                    x2={line.end.xPercent}
                    y2={line.end.yPercent}
                    data-primary={line.primary ? "true" : undefined}
                    data-constellation={line.constellation}
                    data-start-star={line.startStarId}
                    data-end-star={line.endStarId}
                  />
                ))}
              </g>
              <g className="tk-finder-constellation-labels">
                {projectedContext.labels.map((label) => (
                  <text
                    key={label.symbol}
                    x={label.xPercent}
                    y={label.yPercent}
                    data-primary={label.primary ? "true" : undefined}
                  >
                    {label.name}
                  </text>
                ))}
              </g>
            </svg>
            {projectedContext.stars.map((star) => (
              <span
                key={star.id}
                className="tk-finder-star"
                data-target-constellation={star.inTargetConstellation ? "true" : undefined}
                style={{
                  left: `${star.xPercent}%`,
                  top: `${star.yPercent}%`,
                  "--star-size": `${star.radiusPx}px`,
                  "--star-color": star.color,
                  "--star-opacity": 0.32 + star.luminance * 0.68,
                } as CSSProperties}
              >
                <i />
                {star.label ? <small>{star.label}</small> : null}
              </span>
            ))}
            {projectedContext.objects.map((object) => (
              <span
                key={object.id}
                className="tk-finder-object"
                style={{ left: `${object.xPercent}%`, top: `${object.yPercent}%` }}
              >
                <SkyMarkerGlyph kind={object.marker} />
                <small>{object.title}</small>
              </span>
            ))}
          </div>
        ) : null}
        <div className="tk-finder-sky-context" aria-hidden>
          <span>{expectedContext?.constellation?.name ?? "Local sky"}</span>
          {targetPosition ? (
            <strong>
              {cardinalDirection(targetPosition.azimuthDeg)} · {describeTargetAltitude(targetPosition.altitudeDeg)}
            </strong>
          ) : null}
        </div>
        <div className="tk-finder-horizon" aria-hidden>
          <span>{targetPosition ? `${Math.round(targetPosition.azimuthDeg)}°` : "—"}</span>
          <strong>{targetPosition ? cardinalDirection(targetPosition.azimuthDeg) : "Horizon"}</strong>
        </div>
        {aboveHorizon && projectedTarget?.inField ? (
          <div className="tk-finder-lock" data-shape={target.shape} data-marker={targetMarker} aria-hidden>
            <SkyMarkerGlyph kind={targetMarker} />
            <em>{target.title}</em>
          </div>
        ) : null}
        {aboveHorizon && targetEdgeCue ? (
          <div
            className="tk-finder-edge-cue"
            style={{ left: `${targetEdgeCue.xPercent}%`, top: `${targetEdgeCue.yPercent}%` }}
            aria-hidden
          >
            <SkyMarkerGlyph kind={targetMarker} />
            <span>{guidanceTitle}</span>
          </div>
        ) : null}

        <div className="tk-finder-target-card">
          <SkyMarkerGlyph kind={targetMarker} />
          <span>
            <small>Target</small>
            <strong>{target.title}</strong>
            <em>
              {!aboveHorizon && nextRiseUtc
                ? guidanceDetail
                : targetPosition
                ? `${cardinalDirection(targetPosition.azimuthDeg)} · ${describeTargetAltitude(targetPosition.altitudeDeg)}`
                : shapeLabel(target)}
            </em>
          </span>
          <b data-aligned={alignment.aligned ? "true" : undefined}>
            {alignment.aligned ? "On target" : !aboveHorizon ? "Below horizon" : equipmentLabel(target)}
          </b>
        </div>
        {diagnosticsEnabled ? (
          <aside className="tk-finder-developer" aria-label="AR projection diagnostics">
            <header>
              <strong>AR diagnostics</strong>
              <span>Local developer view · not consumer UI</span>
            </header>
            <dl>
              <div><dt>Target</dt><dd>{target.title}</dd></div>
              <div><dt>UTC</dt><dd>{solutionAt.toISOString()}</dd></div>
              <div><dt>Observer</dt><dd>{observer.latitudeDeg.toFixed(5)}, {observer.longitudeDeg.toFixed(5)}</dd></div>
              <div><dt>RA / Dec</dt><dd>{targetSolution?.equatorial ? `${targetSolution.equatorial.raHours.toFixed(5)}h / ${targetSolution.equatorial.decDeg.toFixed(4)}°` : "Not applicable"}</dd></div>
              <div><dt>Expected Az / Alt</dt><dd>{targetPosition ? `${targetPosition.azimuthDeg.toFixed(3)}° / ${targetPosition.altitudeDeg.toFixed(3)}°` : "Unavailable"}</dd></div>
              <div><dt>Local ENU</dt><dd>{targetSolution ? `${targetSolution.enu.east.toFixed(5)}, ${targetSolution.enu.north.toFixed(5)}, ${targetSolution.enu.up.toFixed(5)}` : "Unavailable"}</dd></div>
              <div><dt>Device heading</dt><dd>{pointing ? `${pointing.azimuthDeg.toFixed(2)}°` : "Waiting"}</dd></div>
              <div><dt>Pitch / roll</dt><dd>{orientationTelemetry ? `${orientationTelemetry.betaDeg.toFixed(2)}° / ${orientationTelemetry.gammaDeg.toFixed(2)}°` : "Waiting"}</dd></div>
              <div><dt>Quaternion</dt><dd>{pose ? `${pose.x.toFixed(5)}, ${pose.y.toFixed(5)}, ${pose.z.toFixed(5)}, ${pose.w.toFixed(5)}` : "Waiting"}</dd></div>
              <div><dt>Magnetic heading</dt><dd>{orientationTelemetry?.magneticHeadingDeg !== null && orientationTelemetry?.magneticHeadingDeg !== undefined ? `${orientationTelemetry.magneticHeadingDeg.toFixed(2)}° ± ${orientationTelemetry.compassAccuracyDeg?.toFixed(1) ?? "?"}°` : "Unavailable"}</dd></div>
              <div><dt>True-north correction</dt><dd>Unavailable in browser API</dd></div>
              <div><dt>Screen orientation</dt><dd>{orientationTelemetry ? `${orientationTelemetry.screenOrientationDeg}°${orientationTelemetry.absolute ? " · absolute event" : " · relative event"}` : `${screenAngle()}°`}</dd></div>
              <div><dt>Camera FOV</dt><dd>{`${effectiveProjection.horizontalFovDeg.toFixed(2)}° × ${effectiveProjection.verticalFovDeg.toFixed(2)}° effective`}</dd></div>
              <div><dt>Video / viewport</dt><dd>{`${cameraProjection.sourceWidthPx}×${cameraProjection.sourceHeightPx} / ${cameraProjection.viewportWidthPx}×${cameraProjection.viewportHeightPx}`}</dd></div>
              <div><dt>Aspect / crop</dt><dd>{`${effectiveProjection.sourceAspectRatio.toFixed(4)} / ${effectiveProjection.viewportAspectRatio.toFixed(4)} · ${effectiveProjection.cropAxis} ${(effectiveProjection.visibleFraction * 100).toFixed(1)}%`}</dd></div>
              <div><dt>Projected X / Y</dt><dd>{projectedTarget ? `${projectedTarget.xPercent.toFixed(2)}% / ${projectedTarget.yPercent.toFixed(2)}%` : "Unavailable"}</dd></div>
              <div><dt>Calibration offset</dt><dd>{calibration ? `${calibration.azimuthOffsetDeg.toFixed(2)}° az / ${calibration.altitudeOffsetDeg.toFixed(2)}° alt` : "None"}</dd></div>
            </dl>
            <p>Base FOV is estimated; browser media APIs do not expose camera intrinsics. Center crop is calculated from the live video and overlay viewport.</p>
          </aside>
        ) : null}
      </div>

      <div className="tk-finder-controls">
        {cameraMessage ? <p className="tk-finder-warning">{cameraMessage}</p> : null}
        {sensorPermission === "denied" ? (
          <p className="tk-finder-warning">
            Orientation access was denied. Sky will keep showing the target direction and altitude without live alignment.
          </p>
        ) : null}
        {rawPointing && usesUncorrectedMagneticHeading ? (
          <p className="tk-finder-warning">Magnetic heading needs a sky reference for precise alignment.</p>
        ) : rawPointing && sensorQuality === "poor" && !calibration ? (
          <p className="tk-finder-warning">Compass unreliable — calibrate for better guidance.</p>
        ) : null}
        <details className="tk-finder-details">
          <summary>Accuracy and calibration</summary>
          <dl className="tk-finder-status">
            <div>
              <dt>Above horizon</dt>
              <dd>{aboveHorizon ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Observable</dt>
              <dd>{target.observableTonight ? "Tonight" : "Not recommended"}</dd>
            </div>
            <div>
              <dt>Guidance</dt>
              <dd>{finderAvailability}</dd>
            </div>
            <div>
              <dt>Pointing accuracy</dt>
              <dd>
                {qualityLabel(effectiveQuality)}
                {headingAccuracy !== null ? ` · ±${Math.round(headingAccuracy)}°` : ""}
              </dd>
            </div>
          </dl>

          {sensorsEnabled ? (
            <div className="tk-finder-calibration-actions">
              <button type="button" onClick={() => setCalibrationOpen((open) => !open)}>
                <Compass size={15} aria-hidden />
                {calibration ? "Recalibrate" : "Improve pointing accuracy"}
              </button>
              {calibration ? (
                <button type="button" onClick={() => setCalibration(null)}>
                  <RotateCcw size={15} aria-hidden />
                  Clear calibration
                </button>
              ) : null}
            </div>
          ) : null}

          {calibrationOpen ? (
            <div className="tk-finder-calibration">
              <p className="tk-finder-calibration-title">Align with a known object</p>
              {referenceOptions.length > 0 ? (
                <>
                  <label>
                    Reference object
                    <select value={referenceId ?? ""} onChange={(event) => setReferenceId(event.target.value)}>
                      {referenceOptions.map((entry) => (
                        <option key={entry.target.id} value={entry.target.id}>{entry.target.title}</option>
                      ))}
                    </select>
                  </label>
                  <ol>
                    <li>Find the reference object with your eyes.</li>
                    <li>Point the rear camera directly at it and centre it.</li>
                    <li>Tap Align here.</li>
                  </ol>
                  <button type="button" className="tk-finder-primary" onClick={alignReference} disabled={!rawPointing || !selectedReference}>
                    Align here
                  </button>
                </>
              ) : (
                <p>No bright reference from tonight’s current recommendations is high enough to use right now.</p>
              )}
            </div>
          ) : null}

          <p className="tk-finder-context">
            Position for {observer.label} at {formatClockTime(solutionAt.toISOString(), clock)}. Correct pointing does not guarantee naked-eye visibility. Camera frames stay on this device and are not analysed or uploaded.
          </p>
        </details>
      </div>
    </section>
  );
}
