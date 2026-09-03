import { useId } from "react";
import type { CloudTimeline } from "../../../data/tracker/cloudTimeline";
import {
  SUITABILITY_LABEL,
  type CloudSample,
  type Suitability,
} from "../../../data/tracker/cloudSuitability";
import { SUITABILITY_PAINT, isHatched } from "../../../data/tracker/cloudPalette";

/**
 * The night as one strip of time, and the key to the field drawn over the map.
 *
 * ## Why a timeline rather than a number
 *
 * "62% cloud" answers a question nobody asked. What an observer needs is
 * whether the sky is open *when the thing they want to see is up*, and that is
 * a shape over hours, not a value. A strip shows it directly: where the night
 * is open, where it closes, and — the part a single figure can never carry —
 * when it changes.
 *
 * ## Why the two halves look different
 *
 * Everything left of now is a measurement; everything right of it is a model.
 * They are drawn in the same colours because they answer the same question, and
 * separated by a marked boundary because they do not answer it with the same
 * authority. The reader can see at a glance how much of what they are being
 * shown was actually observed.
 *
 * ## Why the legend says "Cloud viewing conditions"
 *
 * A title like "Stargazing quality" would be a claim about the night as a whole,
 * and this layer is in no position to make one: it knows nothing about the
 * Moon, the transparency, the horizon or the light on the ground. It explains
 * one field — cloud — and its title says so, so a reader is never invited to
 * read a verdict on the night out of a key to a single layer.
 */

interface Props {
  timeline: CloudTimeline;
  /** How the reader's own clock formats an instant. */
  format: (atUtc: string) => string;
  /** The frame being shown on the map, or null for the latest. */
  selectedUtc: string | null;
  onSelect: (atUtc: string | null) => void;
  /** How far apart the satellite's samples are, in kilometres. */
  spacingKm: number | null;
}

const LEVELS: Suitability[] = ["good", "fair", "poor", "bad"];

function swatch(suitability: Suitability): string {
  const [r, g, b, a] = SUITABILITY_PAINT[suitability].fill;
  return `rgba(${r}, ${g}, ${b}, ${(a * 3).toFixed(2)})`;
}

export function TrackerCloudTimeline({ timeline, format, selectedUtc, onSelect, spacingKm }: Props) {
  const id = useId();
  const { samples, nowIndex } = timeline;

  if (!samples.length) {
    return (
      <div className="tk-cloud-key" role="group" aria-label="Cloud viewing conditions">
        <p className="tk-cloud-key-title">Cloud viewing conditions</p>
        <p className="tk-cloud-key-empty">
          No cloud information for tonight. Neither the satellite nor the forecast answered for
          this place.
        </p>
      </div>
    );
  }

  /**
   * Which sample is on screen.
   *
   * Falls back to now when the selection no longer exists, which happens every
   * time a new scan arrives while the reader is scrubbing: the sample they had
   * chosen may not be in the refreshed series. Without the fallback the slider
   * silently jumps to the start of the night while the map stays where it was.
   */
  const found = selectedUtc ? samples.findIndex((sample) => sample.atUtc === selectedUtc) : -1;
  const selectedIndex = found >= 0 ? found : nowIndex;
  const observedCount = samples.filter((sample) => sample.basis === "observed").length;

  return (
    <div className="tk-cloud-key" role="group" aria-label="Cloud viewing conditions">
      <p className="tk-cloud-key-title">Cloud viewing conditions</p>

      <ol className="tk-cloud-strip" aria-hidden>
        {samples.map((sample, index) => (
          <li
            key={sample.atUtc}
            className="tk-cloud-cell"
            data-basis={sample.basis}
            data-level={sample.suitability}
            data-selected={index === selectedIndex ? "true" : undefined}
            style={{ background: swatch(sample.suitability) }}
          >
            {isHatched(sample.suitability) ? <span className="tk-cloud-cell-hatch" /> : null}
          </li>
        ))}
        {/*
          Where the measuring stops and the guessing starts. Drawn as a rule
          across the strip rather than as a colour change, because the boundary
          is about provenance and the colours are about the sky.
        */}
        {observedCount > 0 && observedCount < samples.length ? (
          <li
            className="tk-cloud-boundary"
            style={{ left: `${((observedCount / samples.length) * 100).toFixed(2)}%` }}
          />
        ) : null}
      </ol>

      <label className="tk-visually-hidden" htmlFor={`${id}-scrub`}>
        Time through tonight
      </label>
      <input
        id={`${id}-scrub`}
        className="tk-cloud-scrub"
        type="range"
        min={0}
        max={samples.length - 1}
        step={1}
        value={Math.max(0, selectedIndex)}
        onChange={(event) => {
          const index = Number(event.target.value);
          // Returning to the newest observation clears the selection rather
          // than pinning it, so the map goes back to following the satellite.
          onSelect(index === nowIndex ? null : samples[index].atUtc);
        }}
        aria-valuetext={describe(samples[Math.max(0, selectedIndex)], format)}
      />

      {/*
        The button is a sibling of the sentence rather than inside it, so a
        screen reader does not read "forecast 12% cloudBack to now" as one run.
      */}
      <div className="tk-cloud-key-now">
        <p>{describe(samples[Math.max(0, selectedIndex)], format)}</p>
        {selectedIndex !== nowIndex && nowIndex >= 0 ? (
          <button type="button" className="tk-cloud-key-reset" onClick={() => onSelect(null)}>
            Back to now
          </button>
        ) : null}
      </div>

      <ul className="tk-cloud-levels" aria-hidden>
        {LEVELS.map((level) => (
          <li key={level}>
            <span className="tk-cloud-levels-swatch" style={{ background: swatch(level) }}>
              {isHatched(level) ? <span className="tk-cloud-cell-hatch" /> : null}
            </span>
            {SUITABILITY_LABEL[level]}
          </li>
        ))}
      </ul>

      <p className="tk-cloud-key-source">
        {timeline.observedSource ? `Observed: ${timeline.observedSource}.` : null}
        {timeline.forecastModel ? ` Forecast: ${timeline.forecastModel}.` : null}
        {spacingKm ? ` Samples about ${Math.round(spacingKm)} km apart.` : null}
      </p>
    </div>
  );
}

/** One sample, said out loud — the sentence the slider announces as it moves. */
function describe(sample: CloudSample, format: (atUtc: string) => string): string {
  const when = format(sample.atUtc);
  if (sample.basis === "observed") {
    return `${when} · ${SUITABILITY_LABEL[sample.suitability]} · observed by satellite`;
  }
  return `${when} · ${SUITABILITY_LABEL[sample.suitability]} · forecast${
    sample.percent === undefined ? "" : ` ${Math.round(sample.percent)}% cloud`
  }`;
}
