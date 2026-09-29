import { describe, expect, it } from "vitest";

import type { ConditionSnapshot, EnvironmentalEvidence } from "./conditions";
import {
  anticipationWorthyRecoveryEvent,
  chanceDateLabel,
  findNextBestChance,
  recoveryContent,
  recoveryCopy,
} from "./nextBestChance";
import type { NightPlan } from "./schedule";
import type { UpcomingEvent } from "./upcomingEvents";

const NOW = new Date("2026-09-01T20:00:00.000Z");
const SOURCE = {
  id: "test",
  name: "Test forecast",
  attribution: "Test only",
  cost: "public-no-fee" as const,
  coverage: "global" as const,
};

function snapshot(atUtc: string, cloudCoverPercent: number): ConditionSnapshot {
  return {
    atUtc,
    cloudCoverPercent,
    temperatureC: 12,
    issuedUtc: "2026-09-01T19:30:00.000Z",
    precipitating: false,
    visibilityM: 20_000,
    lowCloudPercent: null,
    midCloudPercent: null,
    highCloudPercent: null,
    relativeHumidityPercent: 50,
    smokeColumnMgM2: null,
    surfacePm25: null,
    source: "test",
  };
}

function evidence(...samples: ConditionSnapshot[]): EnvironmentalEvidence {
  return { status: "available", snapshots: samples, source: SOURCE, message: null };
}

function plan(input: {
  key: string;
  dateKey: string;
  startUtc: string;
  peakUtc: string;
  endUtc: string;
  strength?: number;
  latitudeDeg?: number;
  longitudeDeg?: number;
  title?: string;
}): NightPlan {
  const opportunity = {
    id: `planet-${input.dateKey}`,
    kind: "planet",
    title: input.title ?? "Saturn",
    persistence: "routine",
    shortTitle: input.title ?? "Saturn",
    summary: "A bright planet high in the sky.",
    qualities: {
      observability: 0.9,
      spectacle: 0.7,
      recognisability: 0.9,
      ease: 0.8,
      confidence: 0.9,
      rarity: 0.1,
    },
    guidance: {
      appearance: "A steady golden point of light.",
      whenUtc: input.peakUtc,
      durationMinutes: 60,
      direction: "south-east",
      elevation: "High in the sky",
      howLong: "Allow half an hour.",
      equipment: "eyes",
      technique: null,
      safety: null,
    },
    phenomenon: "A planet reflecting sunlight.",
    tonight: "High enough to see clearly.",
    missingInputs: [],
    limitations: [],
    significance: { tier: "favourable", reasons: ["High and easy to recognize."] },
    profile: [
      { atUtc: input.startUtc, relative: 0.72, altitudeDeg: 32, azimuthDeg: 118 },
      { atUtc: input.peakUtc, relative: 1, altitudeDeg: 47, azimuthDeg: 135 },
      { atUtc: input.endUtc, relative: 0.74, altitudeDeg: 39, azimuthDeg: 151 },
    ],
    transparency: "low",
  };
  const strength = input.strength ?? 0.62;
  return {
    identity: {
      key: input.key,
      modelVersion: "test",
      latitudeDeg: input.latitudeDeg ?? 45.52,
      longitudeDeg: input.longitudeDeg ?? -122.68,
      timeZone: "America/Los_Angeles",
      periodStartUtc: input.startUtc,
    },
    dateKey: input.dateKey,
    period: { startUtc: input.startUtc, endUtc: input.endUtc } as never,
    ranking: {
      ranked: [
        {
          opportunity,
          rank: 1,
          band: "very good",
          strength,
          significance: opportunity.significance,
          priority: strength,
          rarityContribution: 0,
          promotable: true,
          appliedRules: [],
        },
      ],
      hero: null,
      notTonight: [],
    } as never,
    meteors: { best: null } as never,
  };
}

function find(plans: NightPlan[], forecast: EnvironmentalEvidence, overrides = {}) {
  return findNextBestChance({
    plans,
    evidence: forecast,
    equipment: "eyes",
    observer: {
      latitudeDeg: 45.52,
      longitudeDeg: -122.68,
      timeZone: "America/Los_Angeles",
    },
    anchorPlanIdentityKey: plans[0]?.identity.key ?? "missing",
    artificialLightRadiance: null,
    now: NOW,
    ...overrides,
  });
}

const tonight = plan({
  key: "tonight",
  dateKey: "2026-09-01",
  startUtc: "2026-09-02T02:00:00.000Z",
  peakUtc: "2026-09-02T03:00:00.000Z",
  endUtc: "2026-09-02T04:00:00.000Z",
});
const tomorrow = plan({
  key: "tomorrow",
  dateKey: "2026-09-02",
  startUtc: "2026-09-03T02:00:00.000Z",
  peakUtc: "2026-09-03T03:00:00.000Z",
  endUtc: "2026-09-03T04:00:00.000Z",
  title: "Jupiter",
});

describe("next best chance", () => {
  it("keeps an all-clouded current night honest", () => {
    const result = find(
      [tonight],
      evidence(snapshot("2026-09-02T03:00:00.000Z", 100)),
    );
    expect(result).toBeNull();
    expect(
      recoveryCopy({ withheldByCloud: 3, selectedDate: "2026-09-01", today: "2026-09-01" }),
    ).toEqual({
      title: "Clouded out tonight",
      detail: "3 worthwhile targets are blocked by cloud.",
    });
  });

  it("does not promote an otherwise ineligible target", () => {
    const weak = plan({
      key: "weak",
      dateKey: "2026-09-01",
      startUtc: "2026-09-02T02:00:00.000Z",
      peakUtc: "2026-09-02T03:00:00.000Z",
      endUtc: "2026-09-02T04:00:00.000Z",
      strength: 0.12,
    });
    expect(find([weak], evidence(snapshot(weak.ranking.ranked[0].opportunity.guidance.whenUtc, 0)))).toBeNull();
    expect(
      recoveryCopy({ withheldByCloud: 0, selectedDate: "2026-09-01", today: "2026-09-01" }),
    ).toEqual({
      title: "Not tonight",
      detail: "Nothing is well placed enough to recommend.",
    });
  });

  it("finds a forecast-backed window later tonight", () => {
    const result = find(
      [tonight],
      evidence(snapshot("2026-09-02T03:00:00.000Z", 5)),
    );
    expect(result).toMatchObject({ dateKey: "2026-09-01", title: "Saturn", quality: "excellent", where: "SE · 47°" });
    expect(chanceDateLabel(result!.dateKey, "2026-09-01", "2026-09-01")).toBe("Later tonight");
  });

  it("skips a closed night and finds tomorrow's first worthwhile window", () => {
    const result = find(
      [tonight, tomorrow],
      evidence(
        snapshot("2026-09-02T03:00:00.000Z", 100),
        snapshot("2026-09-03T03:00:00.000Z", 10),
      ),
    );
    expect(result).toMatchObject({ dateKey: "2026-09-02", title: "Jupiter" });
    expect(chanceDateLabel(result!.dateKey, "2026-09-01", "2026-09-01")).toBe("Tomorrow");
  });

  it("returns no chance when several forecast nights remain poor", () => {
    const plans = [tonight, tomorrow];
    expect(
      find(
        plans,
        evidence(
          snapshot("2026-09-02T03:00:00.000Z", 95),
          snapshot("2026-09-03T03:00:00.000Z", 90),
        ),
      ),
    ).toBeNull();
  });

  it("changes when the forecast changes", () => {
    const cloudy = find([tonight], evidence(snapshot("2026-09-02T03:00:00.000Z", 100)));
    const clearer = find([tonight], evidence(snapshot("2026-09-02T03:00:00.000Z", 15)));
    expect(cloudy).toBeNull();
    expect(clearer?.opportunityId).toBe("planet-2026-09-01");
  });

  it("rejects plans from the previous observer", () => {
    expect(
      find([tonight], evidence(snapshot("2026-09-02T03:00:00.000Z", 0)), {
        observer: {
          latitudeDeg: 39.0,
          longitudeDeg: -76.8,
          timeZone: "America/New_York",
        },
      }),
    ).toBeNull();
  });

  it("removes a stale future result when the selected plan changes", () => {
    expect(
      find([tonight], evidence(snapshot("2026-09-02T03:00:00.000Z", 0)), {
        anchorPlanIdentityKey: "new-date-or-time",
      }),
    ).toBeNull();
  });
});

describe("recovery content", () => {
  function upcoming(
    id: string,
    kind: "quarter-phase" | "moon-phase" | "shower-peak" | "conjunction",
    tier: "routine" | "good-example" | "favourable" | "notable" = "notable",
  ): UpcomingEvent {
    return {
      kind: "notable",
      id,
      title: id,
      atUtc: id.includes("moon") ? "2026-09-02T03:00:00Z" : "2026-09-05T03:00:00Z",
      notable: {
        kind,
        entry: { significance: { tier } },
      },
    } as UpcomingEvent;
  }

  const strong = upcoming("Orionids peak", "shower-peak");

  it("falls back to the authoritative Upcoming event when no chance exists", () => {
    expect(
      recoveryContent({ currentRecommendationCount: 0, chance: null, upcomingEvents: [strong] }),
    ).toEqual({ kind: "upcoming", event: strong });
  });

  it("prefers an anticipation-worthy event over an earlier routine lunar phase", () => {
    const quarter = upcoming("moon-quarter", "quarter-phase", "routine");
    expect(anticipationWorthyRecoveryEvent([quarter, strong])).toBe(strong);
    expect(
      recoveryContent({
        currentRecommendationCount: 0,
        chance: null,
        upcomingEvents: [quarter, strong],
      }),
    ).toEqual({ kind: "upcoming", event: strong });
  });

  it("does not promote a weak routine event as the recovery hero", () => {
    const quarter = upcoming("moon-quarter", "quarter-phase", "routine");
    const widePair = upcoming("wide-pair", "conjunction", "good-example");
    expect(anticipationWorthyRecoveryEvent([quarter, widePair])).toBeNull();
    expect(
      recoveryContent({
        currentRecommendationCount: 0,
        chance: null,
        upcomingEvents: [quarter, widePair],
      }),
    ).toEqual({ kind: "none" });
  });

  it("does not appear while current recommendations exist", () => {
    expect(
      recoveryContent({ currentRecommendationCount: 2, chance: null, upcomingEvents: [strong] }),
    ).toBeNull();
  });

  it("anchors a future selection to that date instead of real-world tomorrow", () => {
    expect(chanceDateLabel("2026-10-05", "2026-10-04", "2026-09-01")).toMatch(/Oct 5/);
    expect(chanceDateLabel("2026-10-05", "2026-10-04", "2026-09-01")).not.toBe("Tomorrow");
  });
});
