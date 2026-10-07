# Sky architecture

Sky is Tracker's rendered celestial explorer. The rendered sphere is the
foundation; device orientation is its default live handheld navigation and the
rear camera is an optional way to register that same sphere over the physical
view. Sky does not own the observer, selected date, or
recommendation rank. Its searchable browse registry is a view over Astronomy
Engine bodies, the retained BSC5P star catalogue, the 88 identities derived
from the retained constellation figures, retained deep-sky showpieces, and the
existing runtime satellite feeds.

## Authoritative data flow

1. `TrackerApp` resolves the confirmed observer from the map pin and the selected date from URL-backed map state.
2. The existing ranking creates `Opportunity` records for recommended planets, the Moon, deep-sky showpieces, meteor radiants, conjunctions, and propagated satellite passes. `skyFinderTargetFor` admits only recommendations with meaningful locator geometry.
3. `skyExplorer.ts` adds browse/search identities without creating a second position authority: fixed bodies are recomputed with Astronomy Engine, catalogue targets use source RA/Dec, constellations use the centre of their real figure stars, and moving targets use the existing sampled-path or TLE authority.
4. `topocentricSky.ts` is the single transformation owner: catalogue/apparent equatorial position → observer and UTC → local Alt/Az → fixed ENU direction → stabilized device quaternion → camera projection. Astronomy refreshes on a 15-second cadence; sensor events change only device pose.
5. W3C intrinsic Z-X'-Y'' orientation and the screen rotation are composed exactly once as a quaternion; camera-local -Z is the rear optical axis. Safari's magnetic heading replaces its arbitrary alpha yaw before quaternion construction instead of forcing a tilted optical axis toward a compass value. An 0.18° deadband and time-based 85 ms quaternion slerp suppress stationary jitter without smoothing or recalibrating celestial targets.
6. Astronomy Engine azimuths use true north. Safari exposes magnetic heading but no declination correction, so an uncalibrated magnetic session may guide but cannot assert **On target**. A known-object calibration supplies a whole-pose correction and upgrades that evidence. `angularSeparation` then compares the stabilized rear-camera optical axis with the same fixed target direction. Alignment is also withheld below the horizon or when orientation quality is poor. Below-horizon targets stop movement guidance and show the next upward horizon crossing when one can be found.
7. Manual calibration stores only an in-memory yaw/pitch correction for the current Sky session and applies it to the whole pose. Closing Sky clears it.

Selected historical or future dates remain useful in rendered/manual Sky. Protected camera and orientation controls are withheld for a non-live date, so planning never presents a future camera pose as live guidance.

`skyFinderContext.ts` resolves the selected target and BSC5P bright-star catalogue into fixed local ENU vectors for the current observer and UTC instant. Magnitude controls size/luminance; B−V supplies restrained colour; only selected bright IAU names are labelled. A coarse pointing bucket selects candidates for performance but never sets screen position. Final placement always projects each fixed vector through the same display pose, so manual pan, optional sensor motion, camera overlays, targets, stars, figure lines, labels and noteworthy markers move as one scene.

The complete star-direction frame is a one-entry derived cache keyed by observer latitude,
longitude, and UTC instant. A location change or the 15-second astronomy tick replaces it; pointing
changes only re-cull the cached fixed vectors. This prevents sensor movement from rerunning the full
catalog transformation while making stale observer/time state impossible to retain as a second
authority.

Conventional figures use the BSD-licensed d3-celestial line dataset. The deterministic generator maps all 893 endpoints to BSC5P HR stars within 0.008397°, and figure geometry then follows those same catalogue stars through the same proper-motion and pose pipeline. These are conventional figure lines, not IAU boundaries. The optional figure apparition is original project-authored display geometry derived from the projected real endpoints; no historical or proprietary art asset is included. The Milky Way display spine is the J2000 galactic equator transformed into the same ENU frame; it is not a static photograph or a claim of photometric surface brightness.

Solar-system context contains Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune and Pluto through Astronomy Engine. Runtime crewed-station context is an extensible collection: the ISS retains its segmented SupGP/GP path and Tiangong is selected from the existing CelesTrak stations response. Station path predictions use the same SGP4 authority and are labelled geometry-only unless independent photometry supports visibility. Starlink search/events retain the existing post-deployment stack classifier; the ordinary Starlink population is not loaded into Sky.

Rendered Sky is the normal visual base. A live orientation-capable handheld enters **Point** immediately, so the sphere follows physical device direction without camera access. **Explore** is the explicit manual pan/zoom mode, and **Recenter** restores Point without changing observer, UTC, target, or target coordinates. Search and target selection work in either mode. Field of view, magnitude, selection, relevance and collision rules automatically compose supporting stars, constellation geometry, labels, deep-sky objects and Milky Way context; there is no user-selectable celestial Layers menu. When camera permission succeeds, the live rear-camera `<video>` replaces the rendered background and the identical celestial context remains overlaid in the same viewport. The renderer reads the video track or media dimensions and the overlay content box, then adjusts the estimated base FOV for the centred `object-fit: cover` crop before projecting any celestial vector. `data-visual-base` exposes the distinction to review tooling. Browser overlays are expected positions, not camera-frame detections, and never set visual-verification state.

Browser media APIs do not expose calibrated lens intrinsics. The current base estimate is **82° horizontal × 66° vertical**; localhost-only diagnostics may override those values for a measured device/session and display the effective crop-adjusted FOV. This is an explicit uncertainty, not a camera calibration claim.

## Device-class and permission boundary

Sky is a handheld feature. `classifySkyFinderDevice` requires phone/tablet identity evidence to agree with an actual touch or coarse-pointer capability; user-agent or client hints alone never qualify a device. Viewport width is deliberately excluded: a landscape tablet remains eligible, while a narrow desktop window and a desktop webcam do not become Sky.

The device-class decision is applied before optional capability checks. A confirmed phone or tablet receives rendered Sky even when it has no camera or orientation API. Desktop, laptop and unknown devices receive Map, Tonight and Object Detail only, with no reserved navigation space and no fake desktop AR mode.

**Find in Sky** selects the target and enters rendered Sky immediately. Direct Sky navigation and **Find in Sky** both call `beginSkyFinderLaunch` synchronously from the user's gesture so iOS may grant orientation/motion access without an intermediate action. The launch target may be absent for untargeted browsing; that changes neither permission ownership nor the celestial state. Camera access belongs only to the explicit Camera control. There is no second Start/Guide/Lock control. Camera frames remain local and no browser path claims visual verification.

The primary overlay has one target lock. Its position carries the pointing error, the compact instruction strip states the correction, and the same lock changes to the aligned treatment when the sensor solution reaches tolerance. The selected target's object-specific marker sits inside that lock, so Saturn remains recognizable without becoming a second indicator. A second crosshair, detached arrow, or diagnostic reticle would create competing instructions and is deliberately absent.

## Physical-device validation gate

Browser fixtures can prove capability gating, permission orchestration, state transitions, and deterministic movement calculations. They cannot prove rear-camera composition, magnetic-heading behavior, sensor jitter, operating-system permission presentation, or background/resume recovery. A release claim for the primary Sky experience therefore requires an attached physical phone or tablet and evidence from the production build.

The device record must name hardware, operating system, browser, build hash, location/time, and whether compass or known-object calibration was performed. It must test the Moon, Sun, Venus, Mercury, one bright named star, and Saturn or Jupiter when available. For each target, centre the physical object, record angular/screen error, hold for at least 20 seconds, pan away, return, and record repeatability. It must also capture camera permission granted, a movement cue in at least two axes, rotation/orientation change, permission denial and recovery, and background/resume. Screenshots or recording frames must show the live camera feed; the deterministic fixture camera and rendered field are fixture evidence only. Any angular-error note is a measured observation for that device/session, not a general accuracy claim.

The browser path is accepted only if centred physical targets land within the declared product tolerance on that device. If transform, crop, measured-FOV, and known-object calibration checks still leave the Moon or Sun off-screen or unreliable, the smallest next step is a native ARKit/Core Location camera-pose and intrinsics bridge feeding the existing web astronomy and UI layer. That decision cannot be made from browser fixtures alone.

## Capability degradation

| Available capability | Behavior |
| --- | --- |
| Handheld, no camera or orientation | Full rendered Explore with manual pan/zoom, search and target context; no Layers menu |
| Orientation, camera off | Point is the default; rendered Sky follows the stabilized device pose |
| Camera + true-north/fused orientation | Live camera background and sensor guidance; alignment may be asserted within tolerance |
| Camera + magnetic heading only | Directional guidance; alignment is withheld until known-object calibration |
| Relative orientation only | Directional guidance; alignment is withheld until known-object calibration |
| Camera permission denied or stream fails after entry | Rendered Sky continues; denial is stated briefly |
| Orientation permission denied after entry | Sky enters Explore; manual pan/zoom and the target’s true direction/altitude remain usable |
| Camera API absent | Rendered Sky remains available; Camera control is absent |
| Orientation API absent | Manual rendered Sky remains available; orientation control is absent |
| Desktop/laptop, including a webcam-equipped desktop | Sky tab and Find in Sky are absent; protected APIs are not requested |
| Historical/future date | Rendered Sky is available; live camera/orientation controls are withheld |

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
