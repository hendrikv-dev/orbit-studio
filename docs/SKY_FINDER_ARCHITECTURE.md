# Sky Finder architecture

Sky Finder is a projection of Tracker’s existing observing opportunities. It does not own a target catalogue, observer, clock, or recommendation rank.

## Phase 1 and 2 data flow

1. `TrackerApp` resolves the confirmed observer from the map pin and the selected date from URL-backed map state.
2. The existing ranking creates `Opportunity` records for planets, the Moon, deep-sky showpieces, meteor radiants, conjunctions, and propagated satellite passes.
3. `skyFinderTargetFor` admits only opportunities with meaningful locator geometry. Fixed bodies are recomputed with Astronomy Engine, catalogue targets use their source RA/Dec, and moving/radiant targets use their propagated sampled path.
4. Astronomy is refreshed on a 15-second cadence. Device orientation is handled on its own high-frequency event stream and never reruns ephemeris work.
5. `angularSeparation` compares the rear-camera pointing vector with the target’s local horizontal position. Alignment is withheld below the horizon or when orientation quality is poor.
6. Manual calibration stores only an in-memory azimuth/altitude correction for the current Finder session. Closing Finder clears it.

Historical or future selected dates enter an explicitly labelled preview. Live camera and phone alignment are disabled there, so a physical phone is never guided using stale/future coordinates.

The Finder can add restrained expected-sky context without pretending to see through the camera. `skyFinderContext.ts` resolves the selected target's real coordinate source, identifies its IAU constellation when that is scientifically meaningful, and projects nearby HYG v4.1 bright stars into an approximate target-centred field. That catalog is loaded lazily on Finder entry and recalculated on the slow astronomy cadence, never in the sensor loop. The layer is labelled **Expected star field**, appears in desktop preview or after sensor alignment, and does not set visual-verification state. Moving sampled targets such as satellites deliberately omit a made-up constellation label.

## Device-class eligibility and permission boundary

Live point-and-look guidance is a handheld feature. `classifySkyFinderDevice` combines mobile or tablet client hints and user-agent evidence with touch, coarse-pointer, hover, platform, and maximum-touch-point signals. Viewport width is deliberately excluded: a landscape tablet remains eligible, while a narrow desktop window and a desktop webcam do not become a live Finder.

The device-class decision is applied before individual capability checks:

- an eligible phone or tablet with orientation support can enter live guidance;
- an eligible phone or tablet with partial support receives the existing sensor or direction-only fallback;
- a desktop, laptop, or unknown class receives a selected-time sky preview with altitude, azimuth, direction, observability, and detail navigation, but no camera or guidance-permission controls.

Camera, orientation, and motion access is requested only from an eligible handheld and only from the reader’s original **Find in sky** action. `beginSkyFinderLaunch` starts protected calls synchronously inside that user-activation task, then the mounted Finder consumes the resulting permission/stream promises. There is no second Start/Guide/Lock control. Ordinary map, Tonight, Upcoming, detail, and desktop-preview use does not call protected APIs. Camera frames remain local and Phase 1/2 does not claim visual verification.

## Capability degradation

| Available capability | Behavior |
| --- | --- |
| Camera + absolute/fused orientation | Live camera background and sensor guidance |
| Orientation without camera | Live guidance over the dark instrument view |
| Relative orientation only | Directional guidance; alignment is withheld until manual calibration |
| No orientation | Existing altitude/azimuth direction guidance |
| Camera denied or failed | Sensor guidance continues; denial is stated |
| Desktop/laptop, including a webcam-equipped desktop | Sky preview only; protected camera and sensor APIs are not requested |
| Tablet without usable orientation | Direction-only handheld fallback |
| Historical/future date | Selected-time preview; no live camera/alignment claim |

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
