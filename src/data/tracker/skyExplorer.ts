import { Body } from "astronomy-engine";

import { formatClockTime, type PlaceClock } from "../../lib/localTime";
import figuresJson from "../constellations/constellationFigureStars.bsc5p.json";
import deepSkyJson from "../deep-sky/showpieces.json";
import starsJson from "../stars/bsc5pBrightStars.json";
import { crewedStationPassPredictions } from "./satellites";
import { segmentFor, type CrewedStationEphemeris } from "./satelliteSources";
import type { SkyFinderTarget } from "./skyFinder";

interface FigureRecord {
  id: string;
  rank: number;
  lines: number[][];
}

interface StarRecord {
  id: number;
  name: string | null;
  designation: string | null;
  raHours: number;
  decDeg: number;
  magnitude: number;
  constellation: string;
}

interface DeepSkyRecord {
  id: string;
  name: string;
  designation: string;
  type: string;
  rightAscensionDeg: number;
  declinationDeg: number;
  visualMagnitude: number;
  majorAxisArcmin: number | null;
  equipment: "eyes" | "binoculars" | "telescope";
  appearance: string;
}

export type SkySearchKind = "solar-system" | "constellation" | "star" | "deep-sky" | "station" | "satellite-event";

export interface SkySearchEntry {
  id: string;
  title: string;
  subtitle: string;
  aliases: readonly string[];
  kind: SkySearchKind;
  target: SkyFinderTarget;
}

export const SOLAR_SYSTEM_BODIES = [
  Body.Sun,
  Body.Moon,
  Body.Mercury,
  Body.Venus,
  Body.Mars,
  Body.Jupiter,
  Body.Saturn,
  Body.Uranus,
  Body.Neptune,
  Body.Pluto,
] as const;

const CONSTELLATION_NAMES: Record<string, string> = {
  And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aql: "Aquila", Aqr: "Aquarius", Ara: "Ara",
  Ari: "Aries", Aur: "Auriga", Boo: "Boötes", CMa: "Canis Major", CMi: "Canis Minor",
  CVn: "Canes Venatici", Cae: "Caelum", Cam: "Camelopardalis", Cap: "Capricornus", Car: "Carina",
  Cas: "Cassiopeia", Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus", Cha: "Chamaeleon",
  Cir: "Circinus", Cnc: "Cancer", Col: "Columba", Com: "Coma Berenices", CrA: "Corona Australis",
  CrB: "Corona Borealis", Crt: "Crater", Cru: "Crux", Crv: "Corvus", Cyg: "Cygnus",
  Del: "Delphinus", Dor: "Dorado", Dra: "Draco", Equ: "Equuleus", Eri: "Eridanus", For: "Fornax",
  Gem: "Gemini", Gru: "Grus", Her: "Hercules", Hor: "Horologium", Hya: "Hydra", Hyi: "Hydrus",
  Ind: "Indus", LMi: "Leo Minor", Lac: "Lacerta", Leo: "Leo", Lep: "Lepus", Lib: "Libra",
  Lup: "Lupus", Lyn: "Lynx", Lyr: "Lyra", Men: "Mensa", Mic: "Microscopium", Mon: "Monoceros",
  Mus: "Musca", Nor: "Norma", Oct: "Octans", Oph: "Ophiuchus", Ori: "Orion", Pav: "Pavo",
  Peg: "Pegasus", Per: "Perseus", Phe: "Phoenix", Pic: "Pictor", PsA: "Piscis Austrinus",
  Psc: "Pisces", Pup: "Puppis", Pyx: "Pyxis", Ret: "Reticulum", Scl: "Sculptor", Sco: "Scorpius",
  Sct: "Scutum", Ser: "Serpens", Sex: "Sextans", Sge: "Sagitta", Sgr: "Sagittarius", Tau: "Taurus",
  Tel: "Telescopium", TrA: "Triangulum Australe", Tri: "Triangulum", Tuc: "Tucana",
  UMa: "Ursa Major", UMi: "Ursa Minor", Vel: "Vela", Vir: "Virgo", Vol: "Volans", Vul: "Vulpecula",
};

const FIGURES = figuresJson as FigureRecord[];
const STARS = starsJson as StarRecord[];
const STAR_BY_ID = new Map(STARS.map((star) => [star.id, star]));
const DEEP_SKY = (deepSkyJson as { objects: DeepSkyRecord[] }).objects;

export interface ConstellationIdentity {
  symbol: string;
  name: string;
  aliases: readonly string[];
  rightAscensionHours: number;
  declinationDeg: number;
  majorStars: readonly string[];
}

function equatorialCentre(stars: readonly StarRecord[]): { rightAscensionHours: number; declinationDeg: number } {
  const sum = stars.reduce((total, star) => {
    const ra = star.raHours * Math.PI / 12;
    const dec = star.decDeg * Math.PI / 180;
    return {
      x: total.x + Math.cos(dec) * Math.cos(ra),
      y: total.y + Math.cos(dec) * Math.sin(ra),
      z: total.z + Math.sin(dec),
    };
  }, { x: 0, y: 0, z: 0 });
  return {
    rightAscensionHours: ((Math.atan2(sum.y, sum.x) * 12 / Math.PI) + 24) % 24,
    declinationDeg: Math.atan2(sum.z, Math.hypot(sum.x, sum.y)) * 180 / Math.PI,
  };
}

/** All 88 searchable IAU constellation identities, backed by the existing real-star figure data. */
export const CONSTELLATIONS: readonly ConstellationIdentity[] = (() => {
  const bySymbol = new Map<string, Set<number>>();
  for (const figure of FIGURES) {
    const ids = bySymbol.get(figure.id) ?? new Set<number>();
    for (const id of figure.lines.flat()) ids.add(id);
    bySymbol.set(figure.id, ids);
  }
  return [...bySymbol.entries()]
    .map(([symbol, ids]) => {
      const stars = [...ids].flatMap((id) => STAR_BY_ID.get(id) ?? []);
      const centre = equatorialCentre(stars);
      return {
        symbol,
        name: CONSTELLATION_NAMES[symbol] ?? symbol,
        aliases: [symbol],
        ...centre,
        majorStars: stars
          .filter((star) => star.name)
          .sort((a, b) => a.magnitude - b.magnitude)
          .slice(0, 4)
          .map((star) => star.name!),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
})();

function baseTarget(
  id: string,
  title: string,
  at: Date,
  source: SkyFinderTarget["source"],
  options: Partial<Pick<SkyFinderTarget, "shape" | "angularRadiusDeg" | "alignmentToleranceDeg" | "equipment" | "appearance">> = {},
): SkyFinderTarget {
  return {
    id,
    title,
    source,
    shape: options.shape ?? "point",
    angularRadiusDeg: options.angularRadiusDeg ?? 0.2,
    alignmentToleranceDeg: options.alignmentToleranceDeg ?? 3,
    equipment: options.equipment ?? "eyes",
    appearance: options.appearance ?? `The real current position of ${title}.`,
    recommendedAtUtc: at.toISOString(),
    observableTonight: true,
    visualVerification: "not-attempted",
  };
}

export function solarSystemTargets(at: Date): SkyFinderTarget[] {
  return SOLAR_SYSTEM_BODIES.map((body) => baseTarget(`body-${body.toLowerCase()}`, body, at, { kind: "body", body }, {
    angularRadiusDeg: body === Body.Sun || body === Body.Moon ? 0.27 : 0.12,
    equipment: body === Body.Neptune || body === Body.Pluto
      ? "telescope"
      : body === Body.Uranus
        ? "binoculars"
        : "eyes",
    appearance: body === Body.Sun
      ? "Our star. Never look directly at it without certified solar equipment."
      : `${body} at its calculated apparent position.`,
  }));
}

export function skyTargetEquipmentLabel(target: SkyFinderTarget): string {
  if (target.source.kind === "body" && target.source.body === Body.Sun) return "Certified solar filter";
  return target.equipment === "telescope" ? "Telescope" : target.equipment === "binoculars" ? "Binoculars" : "Naked eye";
}

export function constellationTargets(at: Date): SkyFinderTarget[] {
  return CONSTELLATIONS.map((constellation) => baseTarget(
    `constellation-${constellation.symbol.toLowerCase()}`,
    constellation.name,
    at,
    {
      kind: "equatorial",
      rightAscensionHours: constellation.rightAscensionHours,
      declinationDeg: constellation.declinationDeg,
    },
    {
      shape: "region",
      angularRadiusDeg: 12,
      alignmentToleranceDeg: 12,
      appearance: `The conventional ${constellation.name} figure, anchored to its catalogued stars.`,
    },
  ));
}

export function stationSearchEntries(
  stations: readonly CrewedStationEphemeris[],
  at: Date,
  observer?: { latitudeDeg: number; longitudeDeg: number },
  clock?: PlaceClock,
): SkySearchEntry[] {
  const passes = observer ? crewedStationPassPredictions(
    observer.latitudeDeg,
    observer.longitudeDeg,
    stations,
    at.toISOString(),
    new Date(at.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
  ) : [];
  return stations.flatMap((station) => {
    const element = segmentFor(station.segments, at);
    if (!element) return [];
    const nextPass = passes.find((candidate) => candidate.stationId === station.id)?.pass ?? null;
    const nextPassText = nextPass
      ? ` Next path above 10° starts ${clock ? formatClockTime(nextPass.startUtc, clock) : nextPass.startUtc.slice(11, 16) + " UTC"} and peaks ${Math.round(nextPass.peakAltitudeDeg)}° high. Visibility still depends on illumination and brightness.`
      : " No path above 10° is predicted in the next 24 hours.";
    const target = {
      ...baseTarget(
      `station-${station.id}`,
      station.id === "iss" ? "ISS" : station.name,
      at,
      { kind: "tle", line1: element.line1, line2: element.line2 },
      {
        appearance: `${station.name} at its propagated current position.${nextPassText}`,
      },
      ),
      // A station is rendered at the current propagated position. This instant
      // is metadata for review/planning only and points at the same TLE path's
      // best upcoming geometry rather than inventing a second position model.
      recommendedAtUtc: nextPass?.bestUtc ?? at.toISOString(),
    };
    return [{
      id: target.id,
      title: target.title,
      subtitle: nextPass
        ? `Crewed station · next path peaks ${Math.round(nextPass.peakAltitudeDeg)}°`
        : `Crewed space station · ${station.source.toUpperCase()}`,
      aliases: [station.name, station.catalogNumber],
      kind: "station" as const,
      target,
    }];
  });
}

export function skySearchCatalog(at: Date, extras: readonly SkySearchEntry[] = []): SkySearchEntry[] {
  const bodies = solarSystemTargets(at).map((target) => ({
    id: target.id,
    title: target.title,
    subtitle: target.title === "Pluto" ? "Dwarf planet" : "Solar system",
    aliases: [] as readonly string[],
    kind: "solar-system" as const,
    target,
  }));
  const constellations = constellationTargets(at).map((target, index) => ({
    id: target.id,
    title: target.title,
    subtitle: `Constellation · ${CONSTELLATIONS[index].symbol}`,
    aliases: CONSTELLATIONS[index].aliases,
    kind: "constellation" as const,
    target,
  }));
  const stars = STARS
    .filter((star) => star.name)
    .map((star) => {
      const target = baseTarget(
        `star-${star.id}`,
        star.name!,
        at,
        { kind: "equatorial", rightAscensionHours: star.raHours, declinationDeg: star.decDeg },
        { appearance: `${star.name} · magnitude ${star.magnitude.toFixed(2)}.` },
      );
      return {
        id: target.id,
        title: target.title,
        subtitle: `Named star · mag ${star.magnitude.toFixed(1)}`,
        aliases: [star.designation ?? ""].filter(Boolean),
        kind: "star" as const,
        target,
      };
    });
  const deepSky = DEEP_SKY.map((object) => {
    const target = baseTarget(
      `deep-sky-${object.id}`,
      object.name,
      at,
      { kind: "equatorial", rightAscensionHours: object.rightAscensionDeg / 15, declinationDeg: object.declinationDeg },
      {
        shape: object.type.includes("cluster") ? "cluster" : "region",
        angularRadiusDeg: Math.max(0.35, (object.majorAxisArcmin ?? 42) / 120),
        alignmentToleranceDeg: 6,
        equipment: object.equipment,
        appearance: object.appearance,
      },
    );
    return {
      id: target.id,
      title: target.title,
      subtitle: `${object.designation} · ${object.type}`,
      aliases: [object.designation],
      kind: "deep-sky" as const,
      target,
    };
  });
  const entries = [...bodies, ...constellations, ...stars, ...deepSky, ...extras];
  const byIdentity = new Map<string, SkySearchEntry>();
  for (const entry of entries) {
    const identity = entry.title.trim().toLocaleLowerCase();
    if (!byIdentity.has(identity)) byIdentity.set(identity, entry);
  }
  return [...byIdentity.values()];
}

export function filterSkySearch(entries: readonly SkySearchEntry[], query: string, limit = 18): SkySearchEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return entries.filter((entry) => entry.kind === "solar-system").slice(0, limit);
  return entries
    .flatMap((entry) => {
      const values = [entry.title, entry.subtitle, ...entry.aliases].map((value) => value.toLocaleLowerCase());
      const title = values[0];
      const score = title === needle ? 0 : title.startsWith(needle) ? 1 : values.some((value) => value.startsWith(needle)) ? 2 : values.some((value) => value.includes(needle)) ? 3 : 99;
      return score < 99 ? [{ entry, score }] : [];
    })
    .sort((left, right) => left.score - right.score || left.entry.title.localeCompare(right.entry.title))
    .slice(0, limit)
    .map(({ entry }) => entry);
}
