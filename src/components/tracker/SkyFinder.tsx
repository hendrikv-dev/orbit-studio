import {
  AlertTriangle,
  Camera,
  CameraOff,
  Compass,
  Crosshair,
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
  detectSkyFinderCapabilities,
  normalizeDegrees,
  pointingFromDeviceOrientation,
  positionForSkyFinderTarget,
  previewPositionForTarget,
  signedAngleDifference,
  type FinderCalibration,
  type PhonePointing,
  type PointingQuality,
  type SkyFinderTarget,
} from "../../data/tracker/skyFinder";

type PermissionPhase = "idle" | "requesting" | "granted" | "denied" | "unavailable";
type CameraPhase = "idle" | "requesting" | "active" | "denied" | "unavailable";

interface Props {
  target: SkyFinderTarget;
  references: SkyFinderTarget[];
  observer: { latitudeDeg: number; longitudeDeg: number; label: string };
  clock: PlaceClock;
  /** False for historical/future Tracker dates: physical pointing is disabled. */
  liveDate: boolean;
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

export function SkyFinder({ target, references, observer, clock, liveDate, onClose }: Props) {
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
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const smoothed = useRef<PhonePointing | null>(null);
  const lastAbsolute = useRef(0);

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
  const previewPosition = useMemo(
    () => previewPositionForTarget(target, observer),
    [observer, target],
  );
  const previewMode = !liveDate || livePosition === null;
  const targetPosition = previewMode ? previewPosition : livePosition;
  const solutionAt = previewMode ? new Date(target.recommendedAtUtc) : astronomyNow;

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

  const startCamera = useCallback(async () => {
    if (!capabilities.camera || previewMode) {
      setCameraPhase("unavailable");
      setCameraMessage(
        previewMode
          ? "Camera mode is available only for the live sky, not a selected-time preview."
          : "This browser cannot open a rear camera here. Sensor guidance still works.",
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
        await video.current.play();
      }
      setCameraPhase("active");
    } catch (error) {
      const denied = error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name);
      setCameraPhase(denied ? "denied" : "unavailable");
      setCameraMessage(
        denied
          ? "Camera access was denied. Finder is continuing with the dark sensor view."
          : "The rear camera could not start. Finder is continuing with the dark sensor view.",
      );
    }
  }, [capabilities.camera, previewMode]);

  const startGuidance = useCallback(async () => {
    if (!capabilities.orientation || previewMode) {
      setSensorPermission("unavailable");
      return;
    }
    setSensorPermission("requesting");
    try {
      const orientation = permissionConstructor("DeviceOrientationEvent");
      if (orientation?.requestPermission) {
        const answer = await orientation.requestPermission();
        if (answer !== "granted") {
          setSensorPermission("denied");
          return;
        }
      }
      const motion = permissionConstructor("DeviceMotionEvent");
      if (motion?.requestPermission) {
        // Motion improves the fused orientation stream on supporting iPhones,
        // but denial does not invalidate orientation guidance.
        await motion.requestPermission().catch(() => "denied");
      }
      setSensorPermission("granted");
      setSensorsEnabled(true);
    } catch {
      setSensorPermission("denied");
    }
  }, [capabilities.orientation, previewMode]);

  useEffect(() => {
    if (!previewMode && capabilities.orientation && !capabilities.orientationPermissionRequest) {
      setSensorPermission("granted");
      setSensorsEnabled(true);
    }
  }, [capabilities.orientation, capabilities.orientationPermissionRequest, previewMode]);

  useEffect(() => {
    if (!sensorsEnabled || previewMode) return undefined;

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
  }, [previewMode, sensorsEnabled]);

  const pointing = useMemo(
    () => (rawPointing ? applyCalibration(rawPointing, calibration) : null),
    [calibration, rawPointing],
  );
  const effectiveQuality: PointingQuality = calibration && sensorQuality === "poor" ? "fair" : sensorQuality;
  const alignment = useMemo(
    () =>
      previewMode
        ? { separationDeg: null, aligned: false }
        : alignmentFor(pointing, targetPosition, target.alignmentToleranceDeg, effectiveQuality),
    [effectiveQuality, pointing, previewMode, target.alignmentToleranceDeg, targetPosition],
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
      : previewMode
        ? "Preview"
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

  return (
    <section
      className="tk-sky-finder"
      data-camera={cameraPhase === "active" ? "active" : "off"}
      data-aligned={alignment.aligned ? "true" : "false"}
      data-mode={previewMode ? "preview" : "live"}
      data-target-altitude={targetPosition?.altitudeDeg.toFixed(3)}
      data-target-azimuth={targetPosition?.azimuthDeg.toFixed(3)}
      data-angular-separation={alignment.separationDeg?.toFixed(3)}
      data-pointing-quality={effectiveQuality}
      data-visual-verification="not-attempted"
      aria-label={`Find ${target.title} in the sky`}
    >
      <video ref={video} className="tk-finder-camera" autoPlay muted playsInline aria-hidden />
      <div className="tk-finder-sky" aria-hidden />
      <div className="tk-finder-shade" aria-hidden />

      <header className="tk-finder-header">
        <button type="button" className="tk-finder-icon" onClick={onClose} aria-label="Close Sky Finder">
          <X size={20} aria-hidden />
        </button>
        <div>
          <p className="tk-finder-kicker">Sky Finder</p>
          <h1>{target.title}</h1>
          <p>{shapeLabel(target)} · {equipmentLabel(target)}</p>
        </div>
        <button
          type="button"
          className="tk-finder-icon"
          onClick={cameraPhase === "active" ? stopCamera : startCamera}
          aria-label={cameraPhase === "active" ? "Turn camera off" : "Turn camera on"}
          disabled={cameraPhase === "requesting" || previewMode}
        >
          {cameraPhase === "active" ? <CameraOff size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
        </button>
      </header>

      {previewMode ? (
        <div className="tk-finder-mode-note" role="status">
          <AlertTriangle size={16} aria-hidden />
          <span>
            <strong>Selected-time preview</strong>
            Live camera and phone alignment are off. This shows the target at {formatClockTime(target.recommendedAtUtc, clock)} for the selected Tracker date.
          </span>
        </div>
      ) : null}

      <div className="tk-finder-stage" style={reticleStyle}>
        <div className="tk-finder-horizon" aria-hidden />
        <div className="tk-finder-centre" aria-hidden>
          <span />
          <span />
        </div>
        {targetPosition && pointing && !previewMode ? (
          <div className="tk-finder-target" data-shape={target.shape} aria-hidden>
            <span />
          </div>
        ) : null}
        {horizontalError !== null && verticalError !== null && !alignment.aligned && !previewMode ? (
          <div className="tk-finder-arrow" style={{ transform: `rotate(${arrowAngle}deg)` }} aria-hidden>
            ↑
          </div>
        ) : null}

        <div className="tk-finder-guidance" aria-live="polite">
          {alignment.aligned ? (
            <>
              <Crosshair size={28} aria-hidden />
              <strong>Target aligned</strong>
              <span>Expected position within {target.alignmentToleranceDeg}°</span>
            </>
          ) : previewMode ? (
            <>
              <Compass size={25} aria-hidden />
              <strong>{aboveHorizon ? "Above horizon" : "Below horizon"}</strong>
              <span>
                {targetPosition
                  ? `${Math.round(targetPosition.azimuthDeg)}° azimuth · ${Math.round(targetPosition.altitudeDeg)}° altitude`
                  : "No position is available for this selected time."}
              </span>
            </>
          ) : horizontalError !== null && verticalError !== null ? (
            <>
              <strong>{Math.abs(Math.round(horizontalError))}° {horizontalError < 0 ? "left" : "right"}</strong>
              <strong>{Math.abs(Math.round(verticalError))}° {verticalError < 0 ? "down" : "up"}</strong>
              <span>{roundedSeparation}° from target</span>
            </>
          ) : (
            <>
              <Compass size={25} aria-hidden />
              <strong>{noSensors ? "Use direction guidance" : "Start live guidance"}</strong>
              <span>
                {targetPosition
                  ? `${Math.round(targetPosition.azimuthDeg)}° azimuth · ${Math.round(targetPosition.altitudeDeg)}° altitude`
                  : "Waiting for a current target position."}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="tk-finder-controls">
        {cameraMessage ? <p className="tk-finder-warning">{cameraMessage}</p> : null}
        {sensorPermission === "denied" ? (
          <p className="tk-finder-warning">
            Orientation access was denied. Enable Motion &amp; Orientation Access in the browser, or use the altitude/azimuth fallback.
          </p>
        ) : null}
        {rawPointing && sensorQuality === "poor" && !calibration ? (
          <p className="tk-finder-warning">Compass unreliable — calibrate for better guidance.</p>
        ) : null}
        {!previewMode && !sensorsEnabled && capabilities.orientation ? (
          <button
            type="button"
            className="tk-finder-primary"
            onClick={startGuidance}
            disabled={sensorPermission === "requesting"}
          >
            <Compass size={17} aria-hidden />
            {sensorPermission === "requesting" ? "Waiting for permission…" : "Start live guidance"}
          </button>
        ) : null}

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
            <dt>Finder available</dt>
            <dd>{finderAvailability}</dd>
          </div>
          <div>
            <dt>Pointing accuracy</dt>
            <dd>
              {qualityLabel(effectiveQuality)}
              {headingAccuracy !== null ? ` · ±${Math.round(headingAccuracy)}°` : ""}
            </dd>
          </div>
          <div>
            <dt>Visual verification</dt>
            <dd>Not performed</dd>
          </div>
        </dl>

        {!previewMode && sensorsEnabled ? (
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
      </div>
    </section>
  );
}

function degreesForArrow(horizontalError: number, verticalError: number): number {
  return (Math.atan2(horizontalError, verticalError) * 180) / Math.PI;
}
