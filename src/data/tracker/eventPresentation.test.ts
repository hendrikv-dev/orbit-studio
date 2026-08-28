import { describe, expect, it } from "vitest";
import { planNight } from "./schedule";
import { bestViewingWindow, type ConditionSnapshot } from "./conditions";
import {
  presentAuroraEvent,
  presentSolarEclipseEvent,
  presentTonightEvent,
  type EventPresentation,
} from "./eventPresentation";
import { assessAurora, parseAuroraGrid, type AuroraConditions } from "./aurora";
import { localSolarCircumstances, nextSolarEclipses } from "./solarEclipse";
import type { SkyAdjustedOpportunity } from "./opportunity";
import { EVENT_CATEGORIES } from "./eventCategories";
import { deviceClock } from "../../lib/localTime";

/**
 * The universal layout, asserted as a contract rather than checked by eye.
 *
 * The specification's central requirement is that every phenomenon uses the same
 * hero: a name, one or two pills, a recommendation, an optional line, exactly
 * three metrics, two actions. "Aurora has not drifted from the meteor page" is
 * therefore a property of `EventPresentation`, and these tests are what make it
 * one — a phenomenon that grows a fourth metric fails here rather than being
 * noticed in a screenshot three releases later.
 *
 * The second group is the honesty rule the review harness also enforces: an
 * unknown sky may never produce a confident recommendation.
 */

const NOW = new Date("2026-08-21T08:00:00Z");
const CLOCK = deviceClock();

function tonightPresentations(): EventPresentation[] {
  // Fairbanks: far enough north that the plan is guaranteed to contain several
  // kinds of opportunity, and it is the location aurora is testable from.
  const night = planNight(64.8378, -147.7164, NOW, "America/Anchorage");
  expect(night).not.toBeNull();
  const context = {
    clock: CLOCK,
    now: NOW,
    meteors: night!.meteors,
    evidenceStatus: "unavailable" as const,
  };
  return night!.ranking.ranked.map((ranked) => {
    const entry: SkyAdjustedOpportunity = {
      ...ranked,
      skyAccess: null,
      rankBeforeConditions: ranked.rank,
    };
    const window = bestViewingWindow(
      entry.opportunity.profile,
      [] as ConditionSnapshot[],
      entry.opportunity.transparency,
      entry.strength,
      NOW,
    );
    return presentTonightEvent(entry, window, false, context);
  });
}

function auroraPresentation(): EventPresentation {
  const conditions: AuroraConditions = {
    grid: parseAuroraGrid({
      "Observation Time": "2026-08-21T07:59:00Z",
      "Forecast Time": "2026-08-21T08:55:00Z",
      coordinates: [[212, 65, 34]],
    }),
    currentKp: 4.3,
    kpForecast: [],
    fetchedAtUtc: NOW.toISOString(),
    source: {
      id: "noaa-swpc",
      name: "n",
      attribution: "a",
      cost: "public-no-fee",
      coverage: "global",
    },
    failures: [],
  };
  const assessment = assessAurora(conditions, 65, -148, "2026-08-21T08:20:00Z", NOW);
  return presentAuroraEvent(
    assessment,
    "2026-08-21T08:20:00Z",
    CLOCK,
    { startUtc: "2026-08-21T05:51:00Z", endUtc: "2026-08-21T13:57:00Z" },
    { label: "Visibility", value: "Good", tone: "good" },
  );
}

function solarEclipsePresentation(): EventPresentation {
  const event = nextSolarEclipses(new Date("2027-01-01T00:00:00Z"), 2)[1];
  const local = localSolarCircumstances(event, 25.69, 32.64);
  return presentSolarEclipseEvent(event, local, CLOCK, "Luxor, Egypt");
}

describe("every phenomenon fills the same hero", () => {
  const everything = [
    ...tonightPresentations(),
    auroraPresentation(),
    solarEclipsePresentation(),
  ];

  it("produces at least one presentation of each kind under test", () => {
    expect(everything.length).toBeGreaterThan(3);
  });

  it("gives exactly three metrics, each with a label and a value", () => {
    for (const presentation of everything) {
      expect(presentation.metrics).toHaveLength(3);
      for (const metric of presentation.metrics) {
        expect(metric.label.length).toBeGreaterThan(0);
        expect(metric.value.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives one or two pills, never more", () => {
    for (const presentation of everything) {
      expect(presentation.pills.length).toBeGreaterThanOrEqual(1);
      expect(presentation.pills.length).toBeLessThanOrEqual(2);
    }
  });

  it("gives two actions, one of which is the reminder", () => {
    for (const presentation of everything) {
      expect(presentation.secondaryAction.kind).toBe("reminder");
      expect(presentation.primaryAction.kind).not.toBe("reminder");
    }
  });

  it("names a category that has a real page definition behind it", () => {
    for (const presentation of everything) {
      expect(EVENT_CATEGORIES[presentation.categoryId]).toBeDefined();
    }
  });

  it("carries everything the ranked row needs, from the same source as the hero", () => {
    for (const presentation of everything) {
      expect(presentation.row.state.length).toBeGreaterThan(0);
      expect(presentation.row.window.length).toBeGreaterThan(0);
      /**
       * The row's quality used to be asserted equal to the hero's third metric,
       * because both were "Worth it" read off the same band. They are now two
       * different questions on purpose: the hero's third slot says which way to
       * face, and the row's column says how good the view will be, because a
       * comparison between events is what a reader scanning the list is making
       * and a direction is what a reader who has already chosen one needs.
       *
       * What still has to hold is that the row's quality comes from the same
       * band the ranking used rather than being decided again — the drift this
       * assertion originally existed to catch.
       */
      // Whatever the row's quality column is called, it names what it measures.
      // "Worth it" — the vague verdict this replaced — is forbidden outright.
      expect(["Visibility", "Your view"]).toContain(presentation.row.quality.label);
      expect(presentation.row.quality.label).not.toMatch(/worth/i);
      expect(presentation.metrics[2].label).toBe("Where to look");
    }
  });

  it("tells the reader where to look on the card itself, not only in a drill-in", () => {
    // The real-use failure: a reader had the event and the time and still had
    // to work out which part of the sky to search. The third metric is now that
    // answer, and it is never empty — an event with no direction says so.
    for (const presentation of everything) {
      expect(presentation.metrics[2].value.length).toBeGreaterThan(0);
    }
  });

  it("carries a reminder with a real start and duration", () => {
    for (const presentation of everything) {
      expect(Number.isNaN(Date.parse(presentation.reminder.startUtc))).toBe(false);
      expect(presentation.reminder.durationMinutes).toBeGreaterThan(0);
      expect(presentation.reminder.title).toMatch(/Orbit Studio Tracker/);
    }
  });
});

describe("an unknown sky never reads as a confident recommendation", () => {
  /**
   * The level vocabulary changed with the removal of the "worth it" verdicts —
   * it now names what governs the view rather than judging the reader's
   * evening. `conditions-unknown` is a distinct value rather than a wording
   * variant, which is what lets this assert the invariant on the value instead
   * of by matching English.
   */
  it("holds for every tonight opportunity with no forecast behind it", () => {
    for (const presentation of tonightPresentations()) {
      expect(presentation.recommendationLevel).toBe("conditions-unknown");
      /**
       * Asserted on the support line rather than the recommendation, because
       * that is where the statement now lives — and it lives there for a
       * measured reason. The recommendation is clamped to two lines to hold the
       * one-screen contract, and when this sentence was appended to it the
       * browser hid sixty-five pixels of it. A caveat that CSS can truncate is
       * not a caveat, so it has an element of its own.
       */
      expect(presentation.support).toMatch(/no forecast reached here/i);
    }
  });

  it("holds for aurora, whose best case is still a half-hour nowcast", () => {
    const presentation = auroraPresentation();
    expect(presentation.recommendationLevel).not.toBe("well-placed");
  });

  it("holds for an eclipse, whose geometry is certain and whose weather is not", () => {
    const presentation = solarEclipsePresentation();
    expect(presentation.recommendationLevel).toBe("conditions-unknown");
    // The support line carries the partial-phase times where the eclipse is
    // visible from here, and the weather caveat where it is not. Either is a
    // statement of what is and is not known, which is what this asserts.
    expect(presentation.support).toMatch(/partial phase runs|weather over it this far ahead is not/i);
  });
});

describe("what the eclipse card claims", () => {
  const presentation = solarEclipsePresentation();

  it("reports the observer's own view, not the event's headline", () => {
    // Luxor is inside the path, so both agree here — but the metric must be
    // labelled as the local view rather than as the eclipse's global kind, and
    // it must carry the duration: "Totality" is the same word for six minutes
    // and for forty seconds, and the difference is what somebody travels on.
    // The local result moved to the middle slot when "where to look" took the
    // third, which every phenomenon now shares. The claim under test is
    // unchanged: this is the observer's own view, with the duration on it.
    expect(presentation.metrics[1].label).toBe("Your view");
    expect(presentation.metrics[1].value).toMatch(/^Totality · \d+m \d+s$/);
    const seconds = /(\d+)m (\d+)s/.exec(presentation.metrics[1].value);
    const total = Number(seconds![1]) * 60 + Number(seconds![2]);
    // Published: about 6m 23s at Luxor.
    expect(total).toBeGreaterThan(370);
    expect(total).toBeLessThan(400);
  });

  it("names the eclipse by kind rather than calling everything an eclipse", () => {
    expect(presentation.title).toBe("Total Solar Eclipse");
  });
});

describe("what the aurora card claims", () => {
  it("labels the probability as NOAA's rather than as Tracker's", () => {
    const presentation = auroraPresentation();
    expect(presentation.metrics[1].label).toMatch(/NOAA/);
    expect(presentation.metrics[1].value).toBe("34%");
  });
});
