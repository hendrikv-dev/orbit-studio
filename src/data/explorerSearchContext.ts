import type { ExplorerCatalogEntry } from "./explorerCatalog";
import { explorerHistoricalCatalog } from "./explorerHistoricalCatalog";

/**
 * Context the search results need in order to be honest.
 *
 * Two problems the audit found, both about what the list does not say.
 *
 * The list is capped at ten and reported the capped length as the match count,
 * so a search returning 1,716 fragments said "10 matches". And every fragment
 * of one break-up carries the same name, so ten rows reading "deb Kosmos-2251 ·
 * Satellite · Debris" were indistinguishable — the reader cannot tell which one
 * they are about to select, or that they are all different objects.
 *
 * The third problem is not a defect but reads as one. Searching a famous
 * satellite can return only its debris, because the satellite itself decayed
 * and is genuinely absent from a present-day snapshot: Kosmos-2251 has a decay
 * date of 2009-02-10 and was last present in 2008. Saying so, with the year,
 * turns a confusing empty result into the thing worth learning.
 */

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A distinguishing detail for a row whose name is shared with others. */
export function searchResultDetail(entry: ExplorerCatalogEntry): string | null {
  const parts: string[] = [];
  if (entry.catalogNumber) parts.push(`#${entry.catalogNumber}`);
  const altitudeKm = entry.orbit?.altitudeKm;
  if (typeof altitudeKm === "number" && Number.isFinite(altitudeKm)) {
    parts.push(`${Math.round(altitudeKm).toLocaleString()} km`);
  }
  if (entry.launchDate) parts.push(entry.launchDate.slice(0, 4));
  return parts.length ? parts.join(" · ") : null;
}

export interface HistoricalOnlyMatch {
  id: string;
  name: string;
  /** Last year the object was present in the catalog. */
  lastPresentYear: number;
  decayDate?: string;
}

/**
 * An object matching the query that exists in the record but not in the current
 * snapshot, because it has since decayed.
 *
 * Only exact name matches are returned. A substring rule would surface a
 * decayed object for almost any query and bury the point in noise.
 */
export function historicalOnlyMatches(
  query: string,
  presentIds: ReadonlySet<string>,
  limit = 3,
): HistoricalOnlyMatch[] {
  const normalized = normalize(query);
  if (normalized.length < 3) return [];

  const found: HistoricalOnlyMatch[] = [];
  for (const object of explorerHistoricalCatalog.objects) {
    if (found.length >= limit) break;
    if (presentIds.has(object.id)) continue;
    if (!object.decayDate) continue;
    if (normalize(object.name) !== normalized) continue;
    const lastPresent = Number(object.decayDate.slice(0, 4)) - 1;
    if (!Number.isFinite(lastPresent)) continue;
    found.push({
      id: object.id,
      name: object.name,
      lastPresentYear: lastPresent,
      decayDate: object.decayDate,
    });
  }
  return found;
}
