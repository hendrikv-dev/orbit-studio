import { SearchLunarEclipse } from "astronomy-engine";
import type { CatalogueEvent } from "./eventCatalogue";
import { showerFor } from "./eventCatalogue";
import {
  angularSeparationDeg,
  lunarEclipseTiming,
  lunarLocalVisibility,
  sublunarCap,
  type LunarEclipseTiming,
  type LunarVisibilityBand,
  type SublunarCap,
} from "./lunarEclipse";
import {
  coverageField,
  localSolarCircumstances,
  nextSolarEclipses,
  traceCentralPath,
  type CentralPathPoint,
  type CoverageField,
  type SolarEclipseEvent,
} from "./solarEclipse";
import {
  describePotential,
  meteorPotentialAt,
  meteorPotentialField,
  type MeteorPotentialField,
} from "./meteorPotential";

/**
 * The geographic face of a selected event.
 *
 * ## Why this is a union rather than one field
 *
 * Because the phenomena are not the same shape. A solar eclipse lands on the
 * Earth and has a track you can stand on; a lunar eclipse is visible from
 * wherever the Moon is up, which is a hemisphere, not a path; a meteor shower
 * touches nothing at all and only varies in how good the opportunity is.
 *
 * Forcing all three into one "visibility heat map" would draw two lies to save
 * writing three renderers. So each event kind produces the representation its
 * physics actually has, and the map switches on the kind.
 *
 * ## What it is not
 *
 * Not an environment layer. Cloud, light pollution and smoke describe a place
 * whatever is happening in the sky; this describes one event, and it goes away
 * when the reader stops looking at that event. Keeping them apart is what lets
 * the panel say *why* somewhere is good — the astronomy is favourable, or the
 * weather is — rather than blending both into one number that explains nothing.
 */

export type EventOverlay =
  | {
      kind: "solar-eclipse";
      event: SolarEclipseEvent;
      /** The centre line, and the band edges where the umbra has width. */
      centralPath: CentralPathPoint[];
      /** Greatest obscuration reached everywhere else, for the partial zones. */
      coverage: CoverageField;
    }
  | {
      kind: "lunar-eclipse";
      atUtc: string;
      /**
       * The sub-lunar caps across the observable phase, not a sampled grid.
       *
       * The bands are categorical — "visible throughout" is not more of "Moon
       * rises during it" — so they cannot be interpolated, and a grid coarse
       * enough to compute quickly shows as a staircase along every boundary.
       * Finer grids are not the answer either: at two degrees it took forty
       * seconds. Carrying the caps lets the renderer ask the exact question at
       * every pixel it draws, which is both faster and exactly right.
       */
      caps: SublunarCap[];
      timing: LunarEclipseTiming;
    }
  | {
      kind: "meteor-potential";
      field: MeteorPotentialField;
    };

/** What one place experiences, in the terms that event actually has. */
export interface EventReading {
  /** "Total solar eclipse here", "Perseids observing potential". */
  label: string;
  /** The headline answer: "Total", "97% covered", "Strong". */
  value: string;
  /** One sentence of why, or what to do about it. */
  detail: string | null;
  /** The facts behind it, which the panel lists rather than hiding. */
  facts: { label: string; value: string }[];
}

/** The whole world, which is the only sensible extent for an event overlay. */
const WORLD = { south: -80, north: 80, west: -180, east: 178 };

/**
 * Build the overlay for an event.
 *
 * Deliberately synchronous and deliberately coarse by default. These fields are
 * sampled globally, and the resolution that reads well on a world map is not
 * the resolution the panel needs — the panel asks `readEventAt`, which computes
 * the exact point rather than looking up a neighbouring cell.
 */
export function buildEventOverlay(event: CatalogueEvent): EventOverlay | null {
  if (event.kind === "solar-eclipse") {
    const found = solarEclipseFor(event);
    if (!found) return null;
    return {
      kind: "solar-eclipse",
      event: found,
      centralPath: traceCentralPath(found, 8, 260, true),
      /**
       * Eight degrees, and the reason is a measurement.
       *
       * At four this blocked the main thread for four and a half seconds when
       * an eclipse was selected — the field samples the whole world and refines
       * around each cell's maximum, and that is thousands of disc-geometry
       * solutions. Eight quarters it.
       *
       * Nothing precise is lost. The partial zones are a smooth gradient with
       * no features at this scale, and they are drawn interpolated; everything
       * that has to be exact — where the band is, what happens at the reader's
       * own point — comes from `traceCentralPath` and `localSolarCircumstances`
       * at full precision, not from this grid.
       */
      coverage: coverageField(found, WORLD, 8),
    };
  }

  if (event.kind === "lunar-eclipse") {
    const info = SearchLunarEclipse(new Date(Date.parse(event.atUtc) - 2 * 86_400_000));
    if (!info) return null;
    const timing = lunarEclipseTiming(info);
    const start = Date.parse(timing.observablePhase.startUtc);
    const end = Date.parse(timing.observablePhase.endUtc);
    const caps: SublunarCap[] = [];
    for (let index = 0; index < 9; index += 1) {
      caps.push(sublunarCap(new Date(start + ((end - start) * index) / 8)));
    }
    return { kind: "lunar-eclipse", atUtc: event.atUtc, caps, timing };
  }

  const shower = showerFor(event);
  if (!shower) return null;
  return {
    kind: "meteor-potential",
    field: meteorPotentialField(shower, new Date(event.atUtc), 4),
  };
}

/**
 * What a point experiences, computed for that point.
 *
 * Never read out of the drawn field. The field is sampled at whatever step
 * draws well; quoting a cell four degrees away as "here" would be wrong by up
 * to a few hundred kilometres, which for an eclipse is the difference between
 * totality and a partial.
 */
export function readEventAt(
  event: CatalogueEvent,
  overlay: EventOverlay,
  latitudeDeg: number,
  longitudeDeg: number,
  timeZone?: string,
): EventReading | null {
  if (overlay.kind === "solar-eclipse") {
    const local = localSolarCircumstances(
      overlay.event,
      latitudeDeg,
      longitudeDeg,
      overlay.centralPath,
    );
    if (local.kind === "none" || local.obscurationFraction <= 0) {
      return {
        label: "This eclipse here",
        value: "Not visible",
        detail: "The Moon's shadow does not reach this place.",
        facts: [],
      };
    }
    const percent = Math.round(local.obscurationFraction * 100);
    const central = local.kind === "total" || local.kind === "annular";
    const facts: { label: string; value: string }[] = [];
    if (local.peakUtc) facts.push({ label: "Maximum", value: clock(local.peakUtc, timeZone) });
    if (local.partialBeginUtc && local.partialEndUtc) {
      facts.push({
        label: "Partial phase",
        value: `${clock(local.partialBeginUtc, timeZone)} – ${clock(local.partialEndUtc, timeZone)}`,
      });
    }
    if (central && local.centralDurationSeconds !== null) {
      facts.push({
        label: local.kind === "total" ? "Totality" : "Annularity",
        value: duration(local.centralDurationSeconds),
      });
    }
    facts.push({ label: "Sun altitude", value: `${Math.round(local.sunAltitudeAtPeakDeg)}°` });
    return {
      label: "This eclipse here",
      value: central
        ? `${titleCase(local.kind)} · ${percent}% covered`
        : `Partial · ${percent}% covered`,
      detail:
        local.sunAltitudeAtPeakDeg <= 0
          ? "The Sun is below the horizon here at maximum, so none of it is visible."
          : central
            ? "Inside the central band. Eye protection is required except during totality itself."
            : "A partial eclipse. Eye protection is required throughout.",
      facts,
    };
  }

  if (overlay.kind === "lunar-eclipse") {
    const { timing } = overlay;
    const local = lunarLocalVisibility(timing, latitudeDeg, longitudeDeg);
    return {
      label: "This eclipse here",
      value: bandWords(local.band),
      detail:
        local.band === "none"
          ? "The Moon is below the horizon here for the whole eclipse."
          : local.band === "all"
            ? "The whole of the observable phase happens with the Moon up."
            : "Only part of the eclipse happens with the Moon above the horizon here.",
      facts: [
        { label: "Observable phase", value: `${clock(timing.observablePhase.startUtc, timeZone)} – ${clock(timing.observablePhase.endUtc, timeZone)}` },
        { label: "Greatest", value: clock(timing.maximumUtc, timeZone) },
      ],
    };
  }

  const shower = showerFor(event);
  if (!shower) return null;
  const cell = meteorPotentialAt(shower, new Date(event.atUtc), latitudeDeg, longitudeDeg);
  return {
    label: `${shower.name} observing potential`,
    value: describePotential(cell.potential),
    detail:
      cell.darkHours === 0
        ? "It does not get astronomically dark here on this night."
        : cell.radiantTerm === 0
          ? "The radiant does not rise here, so none of this shower's meteors reach this place."
          : null,
    facts: [
      { label: "Astronomical darkness", value: `${cell.darkHours.toFixed(1)} h` },
      { label: "Radiant elevation", value: describeRadiant(cell.radiantTerm) },
      { label: "Moonlight", value: describeMoon(cell.moonTerm) },
      { label: "Activity vs peak", value: `${Math.round(cell.activityTerm * 100)}%` },
    ],
  };
}

/** Which layer of the layer control the event overlay is, for the panel. */
export function overlayTitle(event: CatalogueEvent): string {
  if (event.kind === "meteor-shower") return `${event.title} observing potential`;
  return `${event.title} visibility`;
}

function solarEclipseFor(event: CatalogueEvent): SolarEclipseEvent | null {
  const at = new Date(event.atUtc);
  // Search from a day before, so the eclipse this entry names is the first hit.
  const found = nextSolarEclipses(new Date(at.getTime() - 86_400_000), 2);
  return found.find((entry) => Math.abs(Date.parse(entry.peakUtc) - at.getTime()) < 86_400_000) ?? null;
}

function bandWords(band: LunarVisibilityBand): string {
  if (band === "all") return "Visible throughout";
  if (band === "moonrise") return "Moon rises during the eclipse";
  if (band === "moonset") return "Moon sets during the eclipse";
  return "Not visible";
}

function describeRadiant(term: number): string {
  if (term <= 0) return "Never rises";
  const degrees = Math.round((Math.asin(Math.min(1, term)) * 180) / Math.PI);
  return `${degrees}° average while dark`;
}

function describeMoon(term: number): string {
  if (term >= 0.95) return "No interference";
  if (term >= 0.75) return "Slight";
  if (term >= 0.45) return "Noticeable";
  return "Washes out the faint end";
}

/**
 * The reader's own clock, not UTC.
 *
 * These times used to be printed in UTC with the zone spelled out, on the
 * reasoning that an event's circumstances are a global fact. On the card that
 * read as a contradiction: the same eclipse announced "12:35–1:37 PM" from the
 * observing window two lines above and "10:05 AM UTC" for its maximum here, and
 * nothing on the card explained that those are the same afternoon.
 *
 * Every other time Tracker prints is in the time zone of the selected place, so
 * this one is too. `timeZone` comes from that place; where it is somehow
 * unknown the formatter falls back to the host's zone, which is what the rest
 * of the product does in the same situation.
 */
function clock(utc: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(utc));
}

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}


/**
 * Which visibility band a point falls in, from the caps alone.
 *
 * The same rule `lunarGeographicVisibility` applies per grid cell, exposed so
 * the renderer can ask it per pixel instead. A boundary computed where it is
 * drawn has no staircase in it, and costs less than a grid fine enough to hide
 * one.
 */
export function lunarBandAt(
  caps: SublunarCap[],
  latitudeDeg: number,
  longitudeDeg: number,
): LunarVisibilityBand {
  let up = 0;
  for (const cap of caps) {
    if (angularSeparationDeg(latitudeDeg, longitudeDeg, cap.latitudeDeg, cap.longitudeDeg) <= cap.radiusDeg) {
      up += 1;
    }
  }
  if (up === 0) return "none";
  if (up === caps.length) return "all";
  const first =
    angularSeparationDeg(latitudeDeg, longitudeDeg, caps[0].latitudeDeg, caps[0].longitudeDeg) <=
    caps[0].radiusDeg;
  return first ? "moonset" : "moonrise";
}
