# Sky Finder architecture

Sky Finder is a projection of Tracker’s existing observing opportunities. It does not own a target catalogue, observer, clock, or recommendation rank.

## Phase 1 and 2 data flow

1. `TrackerApp` resolves the confirmed observer from the map pin and the selected date from URL-backed map state.
2. The existing ranking creates `Opportunity` records for planets, the Moon, deep-sky showpieces, meteor radiants, conjunctions, and propagated satellite passes.
3. `skyFinderTargetFor` admits only opportunities with meaningful locator geometry. Fixed bodies are recomputed with Astronomy Engine, catalogue targets use their source RA/Dec, and moving/radiant targets use their propagated sampled path.
4. `topocentricSky.ts` is the single transformation owner: catalogue/apparent equatorial position → observer and UTC → local Alt/Az → fixed ENU direction → stabilized device quaternion → camera projection. Astronomy refreshes on a 15-second cadence; sensor events change only device pose.
5. W3C device orientation, the rear-camera correction and screen rotation are composed once as a quaternion. Safari heading correction rotates the whole pose rather than overwriting target azimuth. An 0.18° deadband and time-based 85 ms quaternion slerp suppress stationary jitter without smoothing or recalibrating celestial targets.
6. `angularSeparation` compares the stabilized rear-camera optical axis with the same fixed target direction. Alignment is withheld below the horizon or when orientation quality is poor. Below-horizon targets stop movement guidance and show the next upward horizon crossing when one can be found.
7. Manual calibration stores only an in-memory yaw/pitch correction for the current Finder session and applies it to the whole camera pose. Closing Finder clears it.

Historical or future selected dates do not expose Sky or **Find in Sky**. Planning remains in Tonight and Object Detail, so a physical phone is never guided using stale or future coordinates.

Sky adds restrained expected-sky context without pretending the browser solved an image. `skyFinderContext.ts` resolves the selected target and BSC5P bright-star catalogue into fixed local ENU vectors for the current observer and UTC instant. Magnitude controls size/luminance; B−V supplies restrained colour; only selected bright IAU names are labelled. A coarse pointing bucket selects candidates for performance but never sets their screen position. Final placement always projects each fixed vector through the exact stabilized quaternion, so the target, surrounding stars, figure lines, labels and noteworthy-object markers move as one scene.

The complete star-direction frame is a one-entry derived cache keyed by observer latitude,
longitude, and UTC instant. A location change or the 15-second astronomy tick replaces it; pointing
changes only re-cull the cached fixed vectors. This prevents sensor movement from rerunning the full
catalog transformation while making stale observer/time state impossible to retain as a second
authority.

Conventional figures use the BSD-licensed d3-celestial line dataset. The deterministic generator maps all 893 endpoints to BSC5P HR stars within 0.008397°, and figure geometry then follows those same catalogue stars through the same proper-motion and pose pipeline. These are conventional figure lines, not IAU boundaries. Noteworthy markers remain projections of Tracker's existing ranked targets and satellite pipeline rather than a second authority. Moving sampled targets deliberately omit an invented target-constellation identity.

When camera permission succeeds, the live rear-camera `<video>` is the visual base and the celestial layers are overlays. The rendered night field is used only for fixtures, simulator work, camera-denied recovery, and explicit non-camera fallback. `data-visual-base` exposes that distinction to review tooling. Browser overlays are expected positions, not camera-frame detections, and never set visual-verification state.

## Device-class eligibility and permission boundary

Live point-and-look guidance is a handheld feature. `classifySkyFinderDevice` requires phone/tablet identity evidence to agree with an actual touch or coarse-pointer capability; user-agent or client hints alone never qualify a device. Viewport width is deliberately excluded: a landscape tablet remains eligible, while a narrow desktop window and a desktop webcam do not become Sky.

The device-class decision is applied before individual capability checks. Sky is exposed only when every pre-permission capability is present:

- phone or tablet form factor confirmed by capability evidence;
- a secure camera API;
- device-orientation support consumed by the live guidance loop;
- the current observing date.

Desktop, laptop, unknown, sensorless and camera-less devices receive Map, Tonight and Object Detail only. No navigation space is reserved for Sky and no sensor-free preview is substituted. Direction, altitude, coordinates, charts and equipment information remain available through Object Detail where relevant.

Camera, orientation, and motion access is requested only from an eligible handheld and only from the reader’s original **Find in Sky** action. `beginSkyFinderLaunch` starts protected calls synchronously inside that user-activation task, then the mounted Sky surface consumes the resulting permission/stream promises. There is no second Start/Guide/Lock control. Ordinary Map, Tonight, planning and detail use does not call protected APIs. Camera frames remain local and Phase 1/2 does not claim visual verification.

The primary overlay has one target lock. Its position carries the pointing error, the compact instruction strip states the correction, and the same lock changes to the aligned treatment when the sensor solution reaches tolerance. The selected target's object-specific marker sits inside that lock, so Saturn remains recognizable without becoming a second indicator. A second crosshair, detached arrow, or diagnostic reticle would create competing instructions and is deliberately absent.

## Physical-device validation gate

Browser fixtures can prove capability gating, permission orchestration, state transitions, and deterministic movement calculations. They cannot prove rear-camera composition, magnetic-heading behavior, sensor jitter, operating-system permission presentation, or background/resume recovery. A release claim for the primary Sky experience therefore requires an attached physical phone or tablet and evidence from the production build.

The device record must name hardware, operating system, browser, build hash, location/time, and whether compass calibration was performed. It must capture camera permission granted, a movement cue in at least two axes, the aligned state, rotation/orientation change, ten seconds of steady-hand jitter, permission denial and recovery, and background/resume. Screenshots or recording frames must show the live camera feed; a deterministic star field or empty `MediaStream` is fixture evidence only. Any angular-error note is a measured observation for that device/session, not a general accuracy claim.

## Capability degradation

| Available capability | Behavior |
| --- | --- |
| Camera + absolute/fused orientation | Live camera background and sensor guidance |
| Relative orientation only | Directional guidance; alignment is withheld until manual calibration |
| Camera permission denied or stream fails after entry | Sensor guidance continues against the restrained night view; denial is stated |
| Orientation permission denied after entry | The selected target’s live direction and altitude remain usable; alignment and diagnostics do not dominate the screen |
| Camera API absent before entry | Sky tab and Find in Sky are absent |
| Orientation API absent before entry | Sky tab and Find in Sky are absent |
| Desktop/laptop, including a webcam-equipped desktop | Sky tab and Find in Sky are absent; protected APIs are not requested |
| Historical/future date | Sky tab and Find in Sky are absent |

Browser access to camera, geolocation, and several sensor APIs requires HTTPS or localhost. iOS browsers may require a user gesture and `requestPermission()` for orientation/motion. Android browsers more commonly emit orientation directly. Magnetic accuracy is not consistently reported, so missing accuracy is described as usable or low confidence rather than invented as a number.

## Phase 3: visual star-field verification

Phase 3 is not implemented in this pass. `VisualSkySolver` is the boundary for it, and Phase 1/2 never emits a visually verified state.

The proposed on-device pipeline is:

1. Sample occasional rear-camera frames, not every video frame.
2. Correct luminance, reject hot pixels and edges, and detect compact star-like centroids.
3. Query a magnitude-limited local star catalogue around the sensor-derived field of view.
4. Build rotation/scale-invariant triangles or quads for detections and catalogue candidates.
5. Use a robust fit to solve camera attitude and field of view.
6. Reject solutions below a declared match-count/confidence threshold or above a declared residual.
7. Feed only accepted solved attitude back as a correction; report `Sky locked` and the actual match count separately from `Target aligned`.

Likely inputs are a redistribution-cleared bright-star catalogue with stable identifiers, apparent positions at the captured UTC, camera intrinsics or an estimated field of view, and an on-device image-processing worker. The work should be throttled to roughly one candidate frame every 0.5–2 seconds and cancelled/versioned when target, observer, time, orientation, or camera changes.

The next concrete step is a deterministic prototype of centroid detection plus triangle matching against synthetic rendered fields, with tests that reject low-confidence and mirrored/ambiguous matches before any camera UI claims a lock.
