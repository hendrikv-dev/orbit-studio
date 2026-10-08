/**
 * Playground's camera stability under orbital-element edits.
 *
 * A tester reported that dragging the RAAN slider moved the Earth/camera view
 * enough to be disorienting: changing the orbit is meant to change the orbit,
 * not where the reader is standing. The root cause was the selected-orbit
 * framing heuristic in `CameraRig` — it read target drift caused by the
 * reader's own edit as "the reader is lost" and re-framed. Playground now
 * preserves the camera through element edits (`preserveCameraOnOrbitEdit`),
 * while selection, viewport, and first-frame framing still re-frame, and the
 * explicit camera modes (Free, Follow Sat, Earth Fixed, Inertial, Station)
 * behave exactly as before.
 *
 * The camera is read from the renderer itself: with `?review=1` the rig
 * publishes its actual position, orientation and controls target onto the
 * canvas each frame (`data-camera-state`). The scenario never drives the
 * camera; it observes what the product's own editing gestures do to it.
 */

/** The sliders Playground offers for the orbit, and an edit that must move it. */
export const ORBIT_ELEMENT_SLIDERS = [
  "Altitude",
  "Eccentricity",
  "Inclination",
  "RAAN",
  "Argument of Periapsis",
  "True Anomaly",
];

/**
 * How far the camera is allowed to drift while the reader edits an element.
 *
 * A re-framing move is thousands of kilometres; a settled OrbitControls rig
 * that nobody is touching is static to floating-point noise. The tolerance
 * sits far below the former and far above the latter, so only a real
 * re-framing can fail this check.
 */
export const cameraPositionToleranceKm = 0.5;
export const cameraQuaternionTolerance = 1e-6;

function arraysClose(a, b, tolerance) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
}

/**
 * One edit's outcome, judged from the rig's own state.
 *
 * The element must have changed (the gesture did something to the orbit) and
 * the camera must not have (the gesture did nothing to the reader's view).
 */
export function orbitEditCameraValidation(before, after, label) {
  const failures = [];
  if (!before) failures.push(`${label}:camera-state-missing-before`);
  if (!after) failures.push(`${label}:camera-state-missing`);
  if (before && after) {
    const elementChanged =
      JSON.stringify(before.elements) !== JSON.stringify(after.elements);
    if (!elementChanged) failures.push(`${label}:element-did-not-change`);
    if (!arraysClose(before.position, after.position, cameraPositionToleranceKm)) {
      failures.push(`${label}:camera-position-moved`);
    }
    if (!arraysClose(before.target, after.target, cameraPositionToleranceKm)) {
      failures.push(`${label}:camera-target-moved`);
    }
    if (!arraysClose(before.quaternion, after.quaternion, cameraQuaternionTolerance)) {
      failures.push(`${label}:camera-orientation-moved`);
    }
    if (before.mode !== after.mode) failures.push(`${label}:camera-mode-changed`);
  }
  return {
    label,
    pass: failures.length === 0,
    failures,
    before: before ? { position: before.position, target: before.target, mode: before.mode } : null,
    after: after ? { position: after.position, target: after.target, mode: after.mode } : null,
  };
}

/**
 * Read the rig's published state, and the named slider's own bounds.
 *
 * The replacement value is picked inside the slider's real range and away from
 * where the handle is, so the edit is a real edit whatever the current orbit
 * is; the bounds are read from the control rather than presumed.
 */
async function readCameraState(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas[data-camera-state]");
    const raw = canvas?.getAttribute("data-camera-state");
    if (!raw) return null;
    const state = JSON.parse(raw);
    return {
      position: state.position,
      quaternion: state.quaternion,
      target: state.target,
      mode: state.mode,
      follow: state.follow,
      satelliteId: state.satelliteId,
      elements: state.elements,
    };
  });
}

async function slideElement(page, label) {
  return page.evaluate((name) => {
    const slider = document.querySelector(
      `input[type="range"][aria-label="${name}"]`,
    );
    if (!slider) return null;
    const min = Number(slider.min);
    const max = Number(slider.max);
    const current = Number(slider.value);
    const span = max - min;
    const target = current - min > span * 0.5 ? min + span * 0.25 : min + span * 0.75;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(slider, String(target));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    return { from: current, to: target, min, max };
  }, label);
}

export const playgroundReviewScenario = {
  id: "playground",
  title: "Playground",
  /**
   * Playground opens on project-authored satellites, so its states certify no
   * current-catalog identity. Importing a catalog object is a reader action
   * this scenario never takes; see `catalogAuthority` in
   * scripts/release/source-identity.mjs.
   */
  catalogAuthority: "none",
  requiresReviewBridge: false,
  readySelector: ".maplibregl-map, canvas",
  /**
   * `review=1` is what makes the camera rig publish its state, and it is also
   * what the app reads to pick the workspace it *opens* in — always Explorer.
   * Rather than teach the routing a second flag, the scenario arrives the way
   * a reader does: Explorer opens, and the app menu switches to Playground.
   * The mode switch keeps the query string, so the rig is still publishing.
   */
  reviewUrl: "http://127.0.0.1:4179/?review=1",
  notes: {
    featuresImplemented: [
      "Keplerian orbit editing through shape, orientation and position controls",
      "Camera-stable element editing: changing an orbit moves the orbit, not the observer's view",
      "Explicit camera modes (Free, Follow Sat, Earth Fixed, Inertial, Station) unchanged",
    ],
    knownLimitations: [
      "The scenario edits the default project-authored satellite and does not import catalog objects, so it certifies no catalog identity.",
      "Camera stability is observed from the renderer's published rig state rather than from screenshots; the screenshots show the scene each edit leaves behind.",
    ],
    expectedReviewFocus: [
      "Verify each orbital-element slider changes the orbit without moving the camera.",
      "Verify the scene is still framed and usable after every edit.",
    ],
  },

  async run({ captureSurface, page }) {
    // Explorer to start (the review flag opens there), then the app menu's own
    // route into Playground.
    await page.getByRole("button", { name: "Open Orbit Studio menu" }).click();
    await page.getByRole("menuitem", { name: "Playground" }).click();
    const canvas = page.locator("canvas[data-camera-state]");
    await canvas.waitFor({ timeout: 60_000 });
    await page.locator('input[type="range"][aria-label="RAAN"]').waitFor({ timeout: 30_000 });
    // Let the initial framing transition finish and the controls come to rest,
    // so the baseline is a settled camera rather than a moving one.
    await page.waitForTimeout(2_500);
    const entryState = await readCameraState(page);
    if (!entryState) throw new Error("The camera rig published no state for review.");
    if (!entryState.elements) {
      throw new Error("No satellite is selected in Playground, so there is no orbit to edit.");
    }
    await captureSurface("playground-entry", {
      camera: { position: entryState.position, target: entryState.target, mode: entryState.mode },
    });

    const results = [];
    for (const label of ORBIT_ELEMENT_SLIDERS) {
      const before = await readCameraState(page);
      const gesture = await slideElement(page, label);
      if (!gesture) throw new Error(`The "${label}" slider was not found in the orbit controls.`);
      await page.waitForTimeout(1_000);
      const after = await readCameraState(page);
      const result = orbitEditCameraValidation(before, after, label);
      results.push({ ...result, gesture });
      if (!result.pass) {
        throw new Error(
          `Editing ${label} moved the camera: ${result.failures.join(", ")}; ` +
            `evidence=${JSON.stringify(result)}`,
        );
      }
      console.info(`[review:orbit-edit] ${JSON.stringify(result)}`);
    }

    await captureSurface("playground-after-orbit-edits", {
      edits: results.map((result) => ({
        label: result.label,
        gesture: result.gesture,
        pass: result.pass,
      })),
    });
  },
};
