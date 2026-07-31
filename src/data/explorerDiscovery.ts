import type { ExplorerCatalogEntry } from "./explorerCatalog";
import { explorerFeaturedEducationPriority } from "./explorerEducation";

export const explorerDiscoveryCollectionIds = [
  "featured",
  "constellations",
  "historic-missions",
  "human-spaceflight",
  "science-missions",
  "navigation",
  "earth-observation",
  "complete-catalog",
] as const;

export type ExplorerDiscoveryCollectionId =
  (typeof explorerDiscoveryCollectionIds)[number];

export interface ExplorerDiscoveryCollection {
  id: ExplorerDiscoveryCollectionId;
  label: string;
  description: string;
}

export const explorerDiscoveryCollections: readonly ExplorerDiscoveryCollection[] = [
  {
    id: "featured",
    label: "Featured Objects",
    description: "Recognizable missions and systems selected for educational relevance.",
  },
  {
    id: "constellations",
    label: "Major Constellations",
    description: "Explore coordinated orbital systems before their individual members.",
  },
  {
    id: "historic-missions",
    label: "Historic Missions",
    description: "Milestones that changed what people could do in space.",
  },
  {
    id: "human-spaceflight",
    label: "Human Spaceflight",
    description: "Crewed spacecraft, stations, and programs.",
  },
  {
    id: "science-missions",
    label: "Science Missions",
    description: "Observatories, research spacecraft, and deep-space missions.",
  },
  {
    id: "navigation",
    label: "Navigation Systems",
    description: "Global positioning, navigation, and timing infrastructure.",
  },
  {
    id: "earth-observation",
    label: "Earth Observation",
    description: "Weather, climate, land, ocean, and environmental monitoring.",
  },
  {
    id: "complete-catalog",
    label: "Complete Catalog",
    description: "Every object available in the selected catalog snapshot.",
  },
];

function searchableEntryText(entry: ExplorerCatalogEntry): string {
  return [
    entry.name,
    entry.objectType,
    entry.operator,
    entry.summary,
    ...(entry.alternateNames ?? []),
    ...(entry.semanticTerms ?? []),
  ].join(" ").toLowerCase();
}

function matchesDiscoveryCollection(
  entry: ExplorerCatalogEntry,
  collectionId: ExplorerDiscoveryCollectionId,
): boolean {
  const text = searchableEntryText(entry);

  switch (collectionId) {
    case "featured":
      return explorerFeaturedEducationPriority(entry) !== null;
    case "constellations":
      return entry.selectionKind === "constellation";
    case "historic-missions":
      return (
        entry.status === "Historical" &&
        (
          entry.categoryId === "missions" ||
          /\bmission|program|spacecraft|launch vehicle|satellite\b/.test(text)
        )
      );
    case "human-spaceflight":
      return /\bcrewed|human spaceflight|space station|apollo|vostok|tiangong|tianhe\b/.test(text);
    case "science-missions":
      return (
        entry.categoryId === "missions" ||
        /\bscience|research|observatory|telescope|voyager|environmental\b/.test(text)
      ) && !/\bnavigation|communications constellation\b/.test(text);
    case "navigation":
      return /\bnavigation|positioning|timing|gnss|gps|galileo|beidou|navstar\b/.test(text);
    case "earth-observation":
      return /\bearth observation|earth-observation|weather|climate|environmental|noaa|sentinel|landsat|meteorological\b/.test(text);
    case "complete-catalog":
      return true;
  }
}

function collectionPriority(
  entry: ExplorerCatalogEntry,
  collectionId: ExplorerDiscoveryCollectionId,
): number {
  if (collectionId === "featured") {
    return explorerFeaturedEducationPriority(entry) ?? 0;
  }

  if (entry.selectionKind === "constellation") return 40;
  if (entry.status === "Operational") return 20;
  if (entry.visualRole === "catalog-reference") return 10;
  return 0;
}

export function explorerEntriesForDiscoveryCollection(
  entries: readonly ExplorerCatalogEntry[],
  collectionId: ExplorerDiscoveryCollectionId,
): ExplorerCatalogEntry[] {
  if (collectionId === "complete-catalog") return [...entries];

  return entries
    .map((entry, sourceIndex) => ({ entry, sourceIndex }))
    .filter(({ entry }) => matchesDiscoveryCollection(entry, collectionId))
    .sort((left, right) => {
      const priorityDifference =
        collectionPriority(right.entry, collectionId) -
        collectionPriority(left.entry, collectionId);
      return priorityDifference || left.sourceIndex - right.sourceIndex;
    })
    .map(({ entry }) => entry);
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function searchScore(entry: ExplorerCatalogEntry, normalizedQuery: string): number {
  const name = normalizeSearchValue(entry.name);
  const catalogNumber = normalizeSearchValue(entry.catalogNumber ?? "");
  const alternates = (entry.alternateNames ?? []).map(normalizeSearchValue);
  const semanticTerms = (entry.semanticTerms ?? []).map(normalizeSearchValue);
  const text = normalizeSearchValue(searchableEntryText(entry));
  let score = 0;

  if (catalogNumber === normalizedQuery) score = Math.max(score, 5_000);
  if (name === normalizedQuery) score = Math.max(score, 4_900);
  if (alternates.includes(normalizedQuery)) score = Math.max(score, 4_800);
  if (semanticTerms.includes(normalizedQuery)) score = Math.max(score, 4_700);
  if (name.startsWith(`${normalizedQuery} `)) score = Math.max(score, 3_900);
  if (alternates.some((alternate) => alternate.startsWith(`${normalizedQuery} `))) {
    score = Math.max(score, 3_800);
  }
  if (semanticTerms.some((term) => term.startsWith(normalizedQuery))) {
    score = Math.max(score, 3_700);
  }
  if (text.includes(normalizedQuery)) score = Math.max(score, 2_000);
  if (entry.selectionKind === "constellation") score += 600;
  score += (explorerFeaturedEducationPriority(entry) ?? 0) / 10;

  return score;
}

export function prioritizeExplorerSearchResults(
  entries: ExplorerCatalogEntry[],
  query: string,
): ExplorerCatalogEntry[] {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return entries;

  const ranked = entries
    .map((entry, sourceIndex) => ({
      entry,
      score: searchScore(entry, normalizedQuery),
      sourceIndex,
    }))
    .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .map(({ entry }) => entry);

  const exactAliasOwner = ranked.find((entry) =>
    (entry.alternateNames ?? []).some(
      (alternate) => normalizeSearchValue(alternate) === normalizedQuery,
    ),
  );
  if (!exactAliasOwner) return ranked;

  return ranked.filter((entry) => (
    entry.id === exactAliasOwner.id ||
    !normalizeSearchValue(entry.name).startsWith(`${normalizedQuery} `)
  ));
}
