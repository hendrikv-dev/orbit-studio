import type { SkyCondition, Viewability } from "../../data/tracker/conditions";

/**
 * The compact event-time condition: an icon, the sky in words, the temperature,
 * and the time all three apply to.
 *
 * The follow-on specification is specific about this being the condition at the
 * *recommended time*, never the current temperature or the daily high. That is
 * the difference between something a camper can act on and a weather widget.
 *
 * Icon meaning never rests on colour alone (every glyph differs in shape), and
 * smoke is never drawn with the ordinary cloud mark — a clear but smoky sky is
 * the case the vocabulary exists to express, and reusing the cloud icon for it
 * would say the opposite of what is true.
 */

function ConditionIcon({ condition }: { condition: SkyCondition }) {
  // Drawn rather than imported, because the required vocabulary — smoky and
  // very smoky as distinct from cloud, fog as distinct from both — does not
  // exist in a general-purpose icon set.
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (condition) {
    case "clear":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
        </svg>
      );
    case "somewhat-cloudy":
      return (
        <svg {...common}>
          <circle cx="8.5" cy="9" r="3" />
          <path d="M13 19h4.5a3 3 0 0 0 0-6 4 4 0 0 0-7.6-1.1A3.2 3.2 0 0 0 10 19h3z" />
        </svg>
      );
    case "cloudy":
    case "overcast":
      return (
        <svg {...common}>
          <path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4-1.3A3.6 3.6 0 0 0 7 18z" />
          {condition === "overcast" ? <path d="M5 21h14" /> : null}
        </svg>
      );
    case "foggy":
      return (
        <svg {...common}>
          <path d="M3 9h18M5 13h14M4 17h16M7 21h10" />
        </svg>
      );
    case "precipitating":
      return (
        <svg {...common}>
          <path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4-1.3A3.6 3.6 0 0 0 7 15z" />
          <path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" />
        </svg>
      );
    case "smoky":
    case "very-smoky":
      // Layered wisps crossing the sky, with a star still showing through on the
      // lighter of the two. The dense case loses the star, because that is the
      // point: the sky is open and you still cannot see into it.
      return (
        <svg {...common}>
          {condition === "smoky" ? <path d="M17.5 5.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" /> : null}
          <path d="M3 11c3-1.6 6-1.6 9 0s6 1.6 9 0" />
          <path d="M3 15c3-1.6 6-1.6 9 0s6 1.6 9 0" />
          {condition === "very-smoky" ? <path d="M3 19c3-1.6 6-1.6 9 0s6 1.6 9 0M3 7c3-1.6 6-1.6 9 0s6 1.6 9 0" /> : null}
        </svg>
      );
  }
}

export function TrackerCondition({
  viewability,
  temperatureC,
  atUtc,
  showFreshness = true,
}: {
  viewability: Viewability;
  temperatureC: number | null;
  atUtc: string;
  /**
   * Freshness belongs to the forecast, not to any one item, so the ranked list
   * suppresses it: repeated down five rows it read as five separate warnings
   * about five separate forecasts, when there is only one.
   */
  showFreshness?: boolean;
}) {
  const { reading, band, freshness } = viewability;
  const time = `${atUtc.slice(11, 16)} UTC`;
  const temperature = temperatureC === null ? null : `${Math.round(temperatureC)}°C`;

  // A span rather than a paragraph: this renders inside the list's buttons, and
  // a button may only contain phrasing content.
  return (
    <span
      className={`tracker-condition tracker-condition-${reading.condition}`}
      // The accessible text names the specific sky state and the time it is
      // for, because the icon carries no text and "weather" would be useless.
      aria-label={`${reading.label}${temperature ? `, ${temperature}` : ""} at ${time}. Viewing ${band}.`}
    >
      <ConditionIcon condition={reading.condition} />
      <span>
        {reading.label}
        {temperature ? ` · ${temperature}` : ""} at {time}
      </span>
      <span className={`tracker-viewability tracker-viewability-${band}`}>{band}</span>
      {showFreshness && freshness !== "current" ? (
        <span className="tracker-freshness">
          {freshness === "stale" ? "forecast is out of date" : "forecast is a few hours old"}
        </span>
      ) : null}
    </span>
  );
}
