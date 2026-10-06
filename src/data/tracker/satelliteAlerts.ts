import type { Opportunity } from "./opportunity";

export const SATELLITE_ALERTS_STORAGE_KEY = "orbit-studio:tracker:satellite-alerts:v1";

export type SatelliteAlertCategory = "space-stations" | "starlink-trains" | "bright-satellites";
export type SatelliteAlertLeadMinutes = 10 | 30 | 60 | 360;

export interface SatelliteAlertPreferences {
  version: 1;
  enabled: boolean;
  categories: Record<SatelliteAlertCategory, boolean>;
  leadMinutes: SatelliteAlertLeadMinutes;
}

export interface SatelliteAlertCandidate {
  opportunity: Opportunity;
  category: SatelliteAlertCategory;
  notifyAtUtc: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_SATELLITE_ALERT_PREFERENCES: SatelliteAlertPreferences = {
  version: 1,
  enabled: false,
  categories: {
    "space-stations": true,
    "starlink-trains": true,
    "bright-satellites": false,
  },
  leadMinutes: 30,
};

function alertCategory(opportunity: Opportunity): SatelliteAlertCategory | null {
  if (opportunity.kind !== "satellite") return null;
  if (/starlink train/i.test(`${opportunity.id} ${opportunity.title}`)) return "starlink-trains";
  if (/\biss\b|space station|tiangong/i.test(`${opportunity.id} ${opportunity.title}`)) return "space-stations";
  return "bright-satellites";
}

/**
 * Select only orbital events strong enough to justify interrupting somebody.
 * Delivery is deliberately not implemented here: Tracker has no account or
 * push service, so this module owns transparent preferences and event timing,
 * not a simulated notification system.
 */
export function satelliteAlertCandidates(
  opportunities: readonly Opportunity[],
  preferences: SatelliteAlertPreferences,
): SatelliteAlertCandidate[] {
  if (!preferences.enabled) return [];
  return opportunities.flatMap((opportunity) => {
    const category = alertCategory(opportunity);
    if (!category || !preferences.categories[category]) return [];
    const highInterest =
      category === "starlink-trains" ||
      (opportunity.significance?.tier === "notable" || opportunity.significance?.tier === "favourable") ||
      (opportunity.qualities.observability >= 0.78 && opportunity.qualities.confidence >= 0.82);
    if (!highInterest) return [];
    return [{
      opportunity,
      category,
      notifyAtUtc: new Date(
        Date.parse(opportunity.guidance.whenUtc) - preferences.leadMinutes * 60_000,
      ).toISOString(),
    }];
  });
}

export function loadSatelliteAlertPreferences(storage: StorageLike | null): SatelliteAlertPreferences {
  if (!storage) return DEFAULT_SATELLITE_ALERT_PREFERENCES;
  try {
    const value = JSON.parse(storage.getItem(SATELLITE_ALERTS_STORAGE_KEY) ?? "null") as Partial<SatelliteAlertPreferences> | null;
    if (
      value?.version !== 1 ||
      typeof value.enabled !== "boolean" ||
      !value.categories ||
      ![10, 30, 60, 360].includes(value.leadMinutes ?? -1)
    ) return DEFAULT_SATELLITE_ALERT_PREFERENCES;
    return {
      version: 1,
      enabled: value.enabled,
      leadMinutes: value.leadMinutes as SatelliteAlertLeadMinutes,
      categories: {
        "space-stations": value.categories["space-stations"] !== false,
        "starlink-trains": value.categories["starlink-trains"] !== false,
        "bright-satellites": value.categories["bright-satellites"] === true,
      },
    };
  } catch {
    return DEFAULT_SATELLITE_ALERT_PREFERENCES;
  }
}

export function saveSatelliteAlertPreferences(
  storage: StorageLike | null,
  preferences: SatelliteAlertPreferences,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SATELLITE_ALERTS_STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}
