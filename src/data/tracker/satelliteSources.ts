/**
 * Where the orbits come from, and in what order of preference.
 *
 * ## SupGP first, GP second
 *
 * CelesTrak publishes two things. GP is its own fit to the public catalogue —
 * one element set per object, good to a kilometre or so, and the right answer
 * for almost everything. SupGP is derived from the operator's own data: NASA's
 * trajectory for the ISS, SpaceX's post-deployment state vector for a Starlink
 * stack. It is better where it exists, and for the two cases here it exists.
 *
 * For the ISS that difference is a segmented ephemeris — sixty element sets at
 * six-hour intervals covering a fortnight — rather than one set propagated
 * across the whole window. A pass tonight is predicted from the segment whose
 * epoch is nearest tonight, which is what a segmented ephemeris is for.
 *
 * For a Starlink deployment it is the difference between an answer and a guess.
 * A freshly deployed stack has no catalogue entries for hours or days, so GP
 * cannot describe it at all; SpaceX's post-deployment vector can, and CelesTrak
 * publishes it as a single object that *is* the deployment.
 *
 * ## What the recent-launch feed is and is not
 *
 * `GROUP=last-30-days` is every object catalogued in the last month, from every
 * launch, mixed together — payloads, upper stages and debris. It is a discovery
 * and cross-check source: it can say that a deployment's objects have been
 * catalogued and roughly where they are. It is not the train, and grouping its
 * Starlink rows by launch designator would be inventing a deployment out of a
 * feed that never claimed to describe one.
 */

const CELESTRAK = "https://celestrak.org/NORAD/elements";

export interface ElementSet {
  name: string;
  line1: string;
  line2: string;
  /** Parsed from the element set itself, not from anywhere else. */
  epochUtc: string;
  catalogNumber: string;
}

/* --------------------------------------------------------------- parsing */

/**
 * The epoch a two-line element set carries, which is the only time it is about.
 *
 * Columns 19–32 of line 1, as a two-digit year and a fractional day. Two-digit
 * years are the format's own limitation and its own convention: 57 and above is
 * the twentieth century, below that the twenty-first.
 */
export function epochOf(line1: string): string | null {
  const field = line1.slice(18, 32).trim();
  const match = /^(\d{2})(\d{1,3}\.\d+)$/.exec(field);
  if (!match) return null;
  const twoDigit = Number(match[1]);
  const year = twoDigit >= 57 ? 1900 + twoDigit : 2000 + twoDigit;
  const dayOfYear = Number(match[2]);
  if (!Number.isFinite(dayOfYear) || dayOfYear < 1) return null;
  const start = Date.UTC(year, 0, 1);
  return new Date(start + (dayOfYear - 1) * 86_400_000).toISOString();
}

/** CelesTrak's three-line format: a name, then the two element lines. */
export function parseElementSets(text: string): ElementSet[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const sets: ElementSet[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line1 = lines[index + 1];
    const line2 = lines[index + 2];
    if (!line1?.startsWith("1 ") || !line2?.startsWith("2 ")) continue;
    const epochUtc = epochOf(line1);
    if (!epochUtc) continue;
    sets.push({
      name: lines[index].trim(),
      line1,
      line2,
      epochUtc,
      catalogNumber: line1.slice(2, 7).trim(),
    });
    index += 2;
  }
  return sets;
}

/**
 * The segment of an ephemeris that actually describes a given moment.
 *
 * Nearest epoch rather than the first one, because a segmented ephemeris is a
 * sequence of short-arc fits and propagating the first across a fortnight
 * throws away the whole point of having the rest.
 */
export function segmentFor(sets: readonly ElementSet[], when: Date): ElementSet | null {
  if (sets.length === 0) return null;
  const target = when.getTime();
  return sets.reduce((best, candidate) => {
    const a = Math.abs(Date.parse(best.epochUtc) - target);
    const b = Math.abs(Date.parse(candidate.epochUtc) - target);
    return b < a ? candidate : best;
  });
}

/**
 * Deployment files named on CelesTrak's supplemental index.
 *
 * Deliberately narrow: only `starlink-g<group>-<launch>`, which is the shape
 * CelesTrak uses for a post-deployment stack, and never the constellation-wide
 * `starlink` file, which is eleven thousand on-station satellites and describes
 * no deployment at all.
 */
export function deploymentFiles(indexHtml: string): string[] {
  const found = new Set<string>();
  for (const match of indexHtml.matchAll(/FILE=(starlink-g\d+-\d+)\b/gi)) {
    found.add(match[1].toLowerCase());
  }
  return [...found].sort();
}

/**
 * The stack rather than the sample satellite.
 *
 * CelesTrak publishes two objects per deployment: the whole stack, and one
 * representative satellite whose drag term already differs from it. The train
 * a reader sees is the stack.
 */
export function stackOf(sets: readonly ElementSet[]): ElementSet | null {
  return sets.find((set) => /\bSTACK\b/i.test(set.name)) ?? null;
}

/* -------------------------------------------------------------- fetching */

async function text(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export interface IssEphemeris {
  segments: ElementSet[];
  /** Which of the two sources answered, so the page can say. */
  source: "supgp" | "gp";
}

/**
 * The ISS's orbit, from NASA's own trajectory where it can be had.
 *
 * The fallback is not a lesser answer for the reader — GP is accurate to well
 * inside what a naked-eye pass needs — so nothing is withheld when it is used.
 * It is recorded because a prediction should be able to say what it came from.
 */
export async function fetchIssEphemeris(signal?: AbortSignal): Promise<IssEphemeris | null> {
  const supplemental = await text(
    `${CELESTRAK}/supplemental/sup-gp.php?FILE=iss&FORMAT=tle`,
    signal,
  );
  const segments = supplemental ? parseElementSets(supplemental) : [];
  if (segments.length > 0) return { segments, source: "supgp" };

  const gp = await text(`${CELESTRAK}/gp.php?CATNR=25544&FORMAT=tle`, signal);
  const single = gp ? parseElementSets(gp) : [];
  return single.length > 0 ? { segments: single, source: "gp" } : null;
}

export interface Deployment {
  file: string;
  stack: ElementSet;
  /**
   * How many objects from this launch the public catalogue has caught up with.
   *
   * Evidence that the deployment is real and is being tracked, not a screen: a
   * stack separated this morning legitimately has none, which is the whole
   * reason the supplemental vector exists. Null where the feed was not read.
   */
  catalogued: number | null;
  /**
   * When the stack separated from the upper stage.
   *
   * The element set's own epoch, which for a post-deployment vector *is* the
   * deployment. Taking it from there rather than from the index page means the
   * time and the orbit cannot disagree.
   */
  deployedUtc: string;
}

/**
 * The most recent Starlink deployment CelesTrak is publishing a stack for.
 *
 * Null is a complete answer and the common one: most nights there is no
 * post-deployment stack on the index, and on those nights there is no train.
 */
export async function fetchLatestDeployment(signal?: AbortSignal): Promise<Deployment | null> {
  const index = await text(`${CELESTRAK}/supplemental/`, signal);
  if (!index) return null;
  const files = deploymentFiles(index);
  if (files.length === 0) return null;

  /**
   * One request per listed deployment, and it stops at the first refusal.
   *
   * CelesTrak's usage policy asks machine-to-machine software to stop querying
   * the moment it gets anything other than a 200 rather than working through
   * the rest of its list — repeatedly ignoring that is what gets an address
   * firewalled. There is normally one deployment on the index and never many,
   * so the cap is a guard rather than a limit anybody reaches.
   */
  const found: Deployment[] = [];
  for (const file of files.slice(0, 4)) {
    const body = await text(
      `${CELESTRAK}/supplemental/sup-gp.php?FILE=${encodeURIComponent(file)}&FORMAT=tle`,
      signal,
    );
    if (!body) break;
    const stack = stackOf(parseElementSets(body));
    if (stack) found.push({ file, stack, deployedUtc: stack.epochUtc, catalogued: null });
  }
  if (found.length === 0) return null;
  const latest = found.reduce((best, candidate) =>
    Date.parse(candidate.deployedUtc) > Date.parse(best.deployedUtc) ? candidate : best,
  );

  /**
   * And one look at the recent-launch feed, on the rare nights this gets here.
   *
   * Discovery only, and never on the common path: this is the one request the
   * feed is good for, and it answers "has the catalogue caught up with this
   * launch" rather than "which objects are the train". Grouping its Starlink
   * rows by launch designator and calling the result a deployment is the thing
   * this whole module is arranged not to do.
   */
  return {
    ...latest,
    catalogued: await countCataloguedFromLaunch(latest.stack.line1.slice(9, 17).trim(), signal),
  };
}

/**
 * Whether the catalogue has caught up with a deployment yet, and with how many.
 *
 * A cross-check rather than a source: if the recent-launch feed already holds a
 * couple of dozen objects from this launch, the deployment is real and has been
 * tracked. It is never used to *build* a train — see the note at the top.
 */
export async function countCataloguedFromLaunch(
  internationalDesignator: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const body = await text(`${CELESTRAK}/gp.php?GROUP=last-30-days&FORMAT=tle`, signal);
  if (!body) return null;
  const prefix = internationalDesignator.replace(/[^0-9A-Za-z]/g, "").slice(0, 5).toUpperCase();
  if (prefix.length < 5) return null;
  return parseElementSets(body).filter((set) =>
    set.line1.slice(9, 14).trim().toUpperCase().startsWith(prefix),
  ).length;
}
