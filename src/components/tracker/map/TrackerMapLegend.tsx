import { DETECTION_FLOOR, lightPollutionRamp } from "../../../data/tracker/lightPollution";

/**
 * The key to the light-pollution field.
 *
 * ## Why the map needs one at all
 *
 * The field is the only layer Tracker draws whose colour *is* a number. Twilight
 * has four named states and an aurora field is a probability the panel states in
 * words, but an orange smear over a city is a radiance, and without a key it is
 * decoration: the reader can see that somewhere is brighter than somewhere else
 * and has no way to find out by how much, or what "bright" costs them.
 *
 * ## Why the stops are the band thresholds
 *
 * The panel already names a band — "Moderate · 8.1 nW/cm²/sr" — from a table of
 * thresholds. Drawing the legend's ticks at those same thresholds makes the two
 * one statement instead of two: the reader can see where the boundary between
 * Low and Moderate falls on the ramp, and where their own place sits relative
 * to it. Ticks at round numbers would have looked tidier and meant less.
 *
 * The scale is logarithmic because the data is: the useful range runs from a
 * quarter of a nanowatt to well past sixty, and a linear bar spends nine tenths
 * of its length on the difference between one city centre and another.
 */

/** The band boundaries, which are what the reading's words are made of. */
const STOPS = [DETECTION_FLOOR, 1, 4, 16, 64];

/** The map's own ramp, so the key cannot drift from the thing it explains. */
function rampColour(t: number, alpha = 1): string {
  const a = (0.1 + 0.62 * t) * 0.9 * alpha;
  return `rgba(255, ${Math.round(214 - 74 * t)}, ${Math.round(150 - 120 * t)}, ${a.toFixed(3)})`;
}

const GRADIENT = Array.from({ length: 11 }, (_, index) => {
  const t = index / 10;
  return `${rampColour(t)} ${(t * 100).toFixed(0)}%`;
}).join(", ");

interface Props {
  /**
   * The reading at the selected place, when there is one.
   *
   * Marking it is the whole reason the legend earns its space: "8.1" means
   * little on its own and a great deal when the reader can see it sitting two
   * thirds of the way up a scale whose top is a city centre.
   */
  radiance: number | null;
}

export function TrackerMapLightLegend({ radiance }: Props) {
  const here = radiance !== null && radiance >= DETECTION_FLOOR ? lightPollutionRamp(radiance) : null;

  return (
    <div className="tk-map-legend" role="img" aria-label={legendLabel(radiance)}>
      <p className="tk-map-legend-title">Artificial light at night</p>
      <div className="tk-map-legend-bar" style={{ background: `linear-gradient(90deg, ${GRADIENT})` }}>
        {here !== null ? (
          <span className="tk-map-legend-here" style={{ left: `${(here * 100).toFixed(1)}%` }} />
        ) : null}
      </div>
      <ul className="tk-map-legend-scale" aria-hidden>
        {STOPS.map((stop) => (
          <li key={stop} style={{ left: `${(lightPollutionRamp(stop) * 100).toFixed(1)}%` }}>
            {stop < 1 ? stop.toFixed(2) : stop}
          </li>
        ))}
      </ul>
      <p className="tk-map-legend-unit">
        nW/cm²/sr — upward radiance, not sky brightness
      </p>
    </div>
  );
}

/**
 * What the whole block says to a screen reader, in one sentence.
 *
 * A gradient and five numbers positioned along it are a picture; read out as
 * list items they are noise. So the bar is one labelled image and the ticks are
 * hidden, which is the same treatment a chart's axis gets.
 */
function legendLabel(radiance: number | null): string {
  const scale =
    `Light-pollution scale, ${DETECTION_FLOOR} to 64 nW/cm²/sr of upward radiance, ` +
    "pale where there is least artificial light and orange where there is most.";
  if (radiance === null) return scale;
  if (radiance < DETECTION_FLOOR) {
    return `${scale} No artificial light is detected at the selected place.`;
  }
  return `${scale} The selected place reads ${radiance.toFixed(1)}.`;
}
