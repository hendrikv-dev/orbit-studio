// The Explorer's playback control is a continuous logarithmic slider that snaps to a few
// anchor speeds. These are the anchors the review harness samples, and `max` is the
// slider's own ceiling. playback-speeds.test.mjs pins them to the slider itself, because a
// stale entry here does not fail loudly: the harness simply waits for a state the
// application will never reach.
export const reviewPlaybackTimeScales = {
  "1x": 1,
  "10x": 10,
  "100x": 100,
  "1000x": 1_000,
  max: 3_000,
};

export const reviewPlaybackSpeeds = Object.keys(reviewPlaybackTimeScales);

// The Explorer renders the active speed as a localized number, and the review page runs
// under an en-US locale. Deriving the label from the time scale keeps the harness from
// hand-mirroring a formatting decision that belongs to the application.
export function reviewPlaybackSpeedLabel(timeScale) {
  return `${timeScale.toLocaleString("en-US")}×`;
}
