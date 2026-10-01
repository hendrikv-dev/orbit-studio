import { CLOUD_CATEGORY_LABEL, type CloudCategory } from "./goesGrid";

/**
 * The words for a cloud number, chosen by what the number actually is.
 *
 * ## Why this is a module rather than a template literal at each call site
 *
 * Tracker holds three different cloud quantities and they are not
 * interchangeable:
 *
 *  - a **classification** — NOAA's four-level decision about one satellite
 *    pixel: clear, probably clear, probably cloudy, cloudy;
 *  - a **cloud probability** — the published confidence that *that pixel is
 *    cloudy*. It is a probability about a decision, not an amount of sky;
 *  - a **cloud cover fraction** — a forecast model's total cloud cover, which
 *    genuinely is a proportion of sky.
 *
 * Two of those are percentages, and the moment both are rendered as
 * `${value}%` at separate call sites, somebody reasonably attaches the same
 * noun to both. Then "84% cloud cover" appears against a pixel where the
 * satellite meant "84% sure this pixel has cloud in it" — a different claim,
 * about a different thing, that happens to share a number.
 *
 * So the noun is chosen here, from the kind of measurement, and there is no way
 * to ask for a percentage without saying which kind it is.
 */

export type CloudMeasure =
  | { kind: "observed-classification"; category: CloudCategory }
  | { kind: "observed-probability"; probability: number }
  | { kind: "forecast-cover"; percent: number };

/** The noun that may follow each kind of number. Never shared. */
export const CLOUD_MEASURE_NOUN = {
  "observed-probability": "cloud probability",
  "forecast-cover": "cloud cover",
} as const;

/**
 * The phrase for a measurement, with its own noun attached.
 *
 * A classification has no percentage at all — it is a category, and rendering
 * it as one would be the conversion this module exists to prevent.
 */
export function cloudPhrase(measure: CloudMeasure): string {
  switch (measure.kind) {
    case "observed-classification":
      return CLOUD_CATEGORY_LABEL[measure.category];
    case "observed-probability": {
      const percent = Math.round(clamp01(measure.probability) * 100);
      return `${percent}% ${CLOUD_MEASURE_NOUN["observed-probability"]}`;
    }
    case "forecast-cover": {
      const percent = Math.round(clamp(measure.percent, 0, 100));
      return `${percent}% ${CLOUD_MEASURE_NOUN["forecast-cover"]}`;
    }
  }
}

/**
 * Where a number came from, in the form the reader is owed beside it.
 *
 * An observed reading names the spacecraft and how long ago it looked. A
 * forecast names the model and the hour it is for. They are deliberately not
 * the same shape: a reader should be able to tell them apart at a glance,
 * before reading either.
 */
export type CloudSource =
  | { kind: "observed"; platform: string; ageMinutes: number }
  | { kind: "forecast"; model: string; validLocal: string };

export function cloudSourceLine(source: CloudSource): string {
  if (source.kind === "observed") {
    const age =
      source.ageMinutes < 1
        ? "just now"
        : `${Math.round(source.ageMinutes)} min ago`;
    return `${source.platform} · observed ${age}`;
  }
  return `Forecast · ${source.model} · ${source.validLocal}`;
}

/**
 * Whether a rendered string is making an observed or a forecast claim.
 *
 * Used by tests and by the interface where it needs to prove the two never
 * collapse into one generic percentage.
 */
export function describesCover(text: string): boolean {
  return /cloud cover/i.test(text);
}

export function describesProbability(text: string): boolean {
  return /cloud probability/i.test(text);
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
