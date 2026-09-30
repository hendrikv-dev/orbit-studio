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
  alignmentFor,
  applyCalibration,
  calibrationFromAlignment,
  canRequestSkyFinderPermission,
  detectSkyFinderCapabilities,
  normalizeDegrees,
  pointingFromDeviceOrientation,
  positionForSkyFinderTarget,
  signedAngleDifference,
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

function smoothAngle(previous: number, next: number, strength = 0.22): number {
  return normalizeDegrees(previous + signedAngleDifference(previous, next) * strength);
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
  return (
    <span className="tk-sky-object-glyph" data-marker={kind} aria-label={label}>
      <i aria-hidden />
    </span>
  );
}

function movementGuidance(horizontalDeg: number, verticalDeg: number): string {
  const horizontalMagnitude = Math.abs(horizontalDeg);
  const verticalMagnitude = Math.abs(verticalDeg);
  if (horizontalMagnitude < 3 && verticalMagnitude < 3) return "Almost there";
  if (horizontalMagnitude >= verticalMagnitude) {
    const qualifier = horizontalMagnitude < 15 ? " slightly" : "";
    return `Move${qualifier} ${horizontalDeg < 0 ? "left" : "right"}`;
  }
  const qualifier = verticalMagnitude < 15 ? " slightly" : "";
  return verticalDeg < 0 ? `Lower phone${qualifier}` : `Raise phone${qualifier}`;
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
  const [rawPointing, setRawPointing] = useState<PhonePointing | null>(null);
  const [sensorQuality, setSensorQuality] = useState<PointingQuality>("unavailable");
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [calibration, setCalibration] = useState<FinderCalibration | null>(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [cameraPhase, setCameraPhase] = useState<CameraPhase>("idle");
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [expectedContext, setExpectedContext] = useState<ExpectedSkyContext | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const smoothed = useRef<PhonePointing | null>(null);
  const lastAbsolute = useRef(0);
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

  const livePosition = useMemo(
    () =>
      liveDate
        ? positionForSkyFinderTarget(target, observer, astronomyNow)
        : null,
    [astronomyNow, liveDate, observer, target],
  );
  const targetPosition = livePosition;
  const solutionAt = astronomyNow;

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
          void video.current.play().catch(() => undefined);
        }
        setCameraPhase("active");
      });
    }
    return () => {
      cancelled = true;
    };
  }, [launch, target.id]);

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
        void video.current.play().catch(() => undefined);
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
  }, [capabilities, liveDate]);

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

      let next = pointingFromDeviceOrientation(
        event.alpha,
        event.beta,
        event.gamma,
        screenAngle(),
      );
      const safariHeading = event.webkitCompassHeading;
      if (typeof safariHeading === "number" && Number.isFinite(safariHeading)) {
        next = { ...next, azimuthDeg: normalizeDegrees(safariHeading) };
      }
      const previous = smoothed.current;
      const filtered = previous
        ? {
            azimuthDeg: smoothAngle(previous.azimuthDeg, next.azimuthDeg),
            altitudeDeg: previous.altitudeDeg + (next.altitudeDeg - previous.altitudeDeg) * 0.22,
          }
        : next;
      smoothed.current = filtered;
      setRawPointing(filtered);

      const accuracy = event.webkitCompassAccuracy;
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
    };
  }, [sensorsEnabled]);

  const pointing = useMemo(
    () => (rawPointing ? applyCalibration(rawPointing, calibration) : null),
    [calibration, rawPointing],
  );
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

  useEffect(() => {
    if (!contextCentre) {
      setExpectedContext(null);
      return undefined;
    }
    let cancelled = false;
    // The catalog and conventional figure data stay in Sky's lazy chunk. The
    // three-degree bucket follows the live pointing field without recomputing
    // 1,839 catalog stars on every noisy sensor event.
    void import("../../data/tracker/skyFinderContext").then(({ expectedSkyContext }) => {
      if (cancelled) return;
      setExpectedContext(expectedSkyContext(target, observer, solutionAt, contextCentre, references));
    });
    return () => {
      cancelled = true;
    };
  }, [contextCentre, observer, references, solutionAt, target]);

  const effectiveQuality: PointingQuality = calibration && sensorQuality === "poor" ? "fair" : sensorQuality;
  const alignment = useMemo(
    () =>
      alignmentFor(pointing, targetPosition, target.alignmentToleranceDeg, effectiveQuality),
    [effectiveQuality, pointing, target.alignmentToleranceDeg, targetPosition],
  );

  const horizontalError =
    pointing && targetPosition
      ? signedAngleDifference(pointing.azimuthDeg, targetPosition.azimuthDeg)
      : null;
  const verticalError =
    pointing && targetPosition ? targetPosition.altitudeDeg - pointing.altitudeDeg : null;
  const arrowAngle =
    horizontalError !== null && verticalError !== null
      ? degreesForArrow(horizontalError, verticalError)
      : 0;
  const reticleStyle = {
    "--finder-x": `${Math.max(-42, Math.min(42, (horizontalError ?? 0) * 1.7))}%`,
    "--finder-y": `${Math.max(-34, Math.min(34, -(verticalError ?? 0) * 1.7))}%`,
    "--finder-radius": `${Math.max(28, Math.min(64, 28 + target.angularRadiusDeg * 8))}px`,
    "--finder-angle": `${arrowAngle}deg`,
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
  const guidanceTitle = alignment.aligned
    ? `${target.title} is here`
    : horizontalError !== null && verticalError !== null
      ? movementGuidance(horizontalError, verticalError)
      : noSensors && targetPosition
        ? `Face ${cardinalDirection(targetPosition.azimuthDeg)}`
        : "Preparing live guidance";
  const guidanceDetail = alignment.aligned
    ? "On target"
    : roundedSeparation !== null
      ? `${roundedSeparation}° away`
      : targetPosition
        ? `${Math.round(targetPosition.azimuthDeg)}° · ${Math.round(targetPosition.altitudeDeg)}° high`
        : "Position unavailable";
  const targetMarker = skyMarkerKindForTarget(target);

  return (
    <section
      className="tk-sky-finder"
      data-camera={cameraPhase === "active" ? "active" : "off"}
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
      data-expected-stars={expectedContext?.stars.length ?? 0}
      data-expected-lines={expectedContext?.lines.length ?? 0}
      data-expected-labels={expectedContext?.labels.length ?? 0}
      data-expected-objects={expectedContext?.objects.length ?? 0}
      aria-label={`Find ${target.title} in the sky`}
    >
      <video ref={video} className="tk-finder-camera" autoPlay muted playsInline aria-hidden />
      <div className="tk-finder-sky" aria-hidden />
      <div className="tk-finder-shade" aria-hidden />

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
            {cameraPhase === "active" ? <CameraOff size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
          </button>
        ) : <span aria-hidden />}
      </header>

      <div className="tk-finder-stage" style={reticleStyle}>
        {expectedContext ? (
          <div className="tk-finder-expected-field" aria-hidden>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <g className="tk-finder-constellation-lines">
                {expectedContext.lines.map((line) => (
                  <line
                    key={line.id}
                    x1={line.points[0].xPercent}
                    y1={line.points[0].yPercent}
                    x2={line.points[1].xPercent}
                    y2={line.points[1].yPercent}
                    data-primary={line.primary ? "true" : undefined}
                    data-constellation={line.constellation}
                  />
                ))}
              </g>
              {expectedContext.stars.map((star) => (
                <g key={star.id} className="tk-finder-star">
                  <circle
                    cx={star.xPercent}
                    cy={star.yPercent}
                    r={star.radiusPx / 2}
                    data-target-constellation={star.inTargetConstellation ? "true" : undefined}
                  />
                  {star.label ? (
                    <text className="tk-finder-star-label" x={star.xPercent + 1.2} y={star.yPercent - 1.2}>{star.label}</text>
                  ) : null}
                </g>
              ))}
              <g className="tk-finder-constellation-labels">
                {expectedContext.labels.map((label) => (
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
            {expectedContext.objects.map((object) => (
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
              {cardinalDirection(targetPosition.azimuthDeg)} · {Math.round(targetPosition.altitudeDeg)}° high
            </strong>
          ) : null}
        </div>
        <div className="tk-finder-horizon" aria-hidden>
          <span>{targetPosition ? `${Math.round(targetPosition.azimuthDeg)}°` : "—"}</span>
          <strong>{targetPosition ? cardinalDirection(targetPosition.azimuthDeg) : "Horizon"}</strong>
        </div>
        {targetPosition ? (
          <div className="tk-finder-lock" data-shape={target.shape} data-marker={targetMarker} aria-hidden>
            <SkyMarkerGlyph kind={targetMarker} />
            <em>{target.title}</em>
          </div>
        ) : null}

        <div className="tk-finder-target-card">
          <SkyMarkerGlyph kind={targetMarker} />
          <span>
            <small>Target</small>
            <strong>{target.title}</strong>
            <em>
              {targetPosition
                ? `${cardinalDirection(targetPosition.azimuthDeg)} · ${Math.round(targetPosition.altitudeDeg)}° high`
                : shapeLabel(target)}
            </em>
          </span>
          <b data-aligned={alignment.aligned ? "true" : undefined}>
            {alignment.aligned ? "On target" : equipmentLabel(target)}
          </b>
        </div>
      </div>

      <div className="tk-finder-controls">
        {cameraMessage ? <p className="tk-finder-warning">{cameraMessage}</p> : null}
        {sensorPermission === "denied" ? (
          <p className="tk-finder-warning">
            Orientation access was denied. Sky will keep showing the target direction and altitude without live alignment.
          </p>
        ) : null}
        {rawPointing && sensorQuality === "poor" && !calibration ? (
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

function degreesForArrow(horizontalError: number, verticalError: number): number {
  return (Math.atan2(horizontalError, verticalError) * 180) / Math.PI;
}
