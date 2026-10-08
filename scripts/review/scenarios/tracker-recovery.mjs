import {
  PORTLAND,
  seedPlace,
  stubCloudForecast,
  stubTracker,
} from "../../verify/tracker-fixtures.mjs";
import {
  readTrackerMapState,
  stubEnvironment,
  trackerRecoveryValidation,
  trackerReviewFixtures,
} from "./tracker.mjs";

const REVIEW_NIGHT = trackerReviewFixtures.night;
const NEXT_NIGHT = trackerReviewFixtures.nextNight;
const FOLLOWING_NIGHT = "2026-09-04";
const RECOVERY_PIN = trackerReviewFixtures.pin;
const SECOND_SITE = {
  latitude: 45.638,
  longitude: -122.661,
};

/**
 * The provider fixture is mutable only at this network boundary. Every update
 * is consumed by Tracker through its normal adapter, cache, evidence model,
 * recovery selector and rendered Tonight briefing.
 */
let forecastCase = "following-night";

const FORECAST_START = Date.parse("2026-09-03T00:00:00.000Z");
const FORECAST_HOURS = 9 * 24;

function clearsAt(caseId, latitudeDeg) {
  if (caseId === "later-tonight") return Date.parse("2026-09-03T06:00:00.000Z");
  if (caseId === "tomorrow") return Date.parse("2026-09-04T03:00:00.000Z");
  if (caseId === "following-night") return Date.parse("2026-09-05T03:00:00.000Z");
  if (caseId === "location") {
    return Math.abs(latitudeDeg - SECOND_SITE.latitude) < 0.01
      ? Date.parse("2026-09-03T07:00:00.000Z")
      : Date.parse("2026-09-04T03:00:00.000Z");
  }
  return Number.POSITIVE_INFINITY;
}

/** A real MET-shaped forecast with an explicit, inspectable clearing edge. */
export function recoveryWeatherForecast(caseId, latitudeDeg = PORTLAND.latitude) {
  const opening = clearsAt(caseId, latitudeDeg);
  return {
    properties: {
      meta: { updated_at: "2026-09-03T04:45:00.000Z" },
      timeseries: Array.from({ length: FORECAST_HOURS }, (_, index) => {
        const at = FORECAST_START + index * 3_600_000;
        const cloud = at >= opening ? 4 : 96;
        return {
          time: new Date(at).toISOString(),
          data: {
            instant: {
              details: {
                air_temperature: 12,
                cloud_area_fraction: cloud,
                cloud_area_fraction_low: cloud,
                cloud_area_fraction_medium: 0,
                cloud_area_fraction_high: 0,
                relative_humidity: cloud > 90 ? 88 : 52,
              },
            },
            next_1_hours: { details: { precipitation_amount: 0 } },
          },
        };
      }),
    },
  };
}

function assertPass(result, message) {
  if (!result.pass) throw new Error(`${message}: ${result.failures.join(", ")}`);
  return result;
}

async function waitForRecovery(page, expected, timeout = 30_000) {
  try {
    await page.waitForFunction(
      ({ kind, observer }) => {
      const shell = document.querySelector(".tracker-shell");
      const card = document.querySelector("[data-recovery-kind]");
      return (
        shell?.getAttribute("data-observer") === observer &&
        card?.getAttribute("data-recovery-kind") === kind
      );
      },
      { kind: expected.kind, observer: expected.observer },
      { timeout },
    );
  } catch (error) {
    const state = await readTrackerMapState(page);
    throw new Error(
      `Timed out waiting for recovery ${JSON.stringify(expected)}; ` +
        `last state=${JSON.stringify(state)}; ${error instanceof Error ? error.message : error}`,
    );
  }
  await page.waitForTimeout(700);
  return readTrackerMapState(page);
}

export const trackerRecoveryReviewScenario = {
  id: "tracker-recovery",
  title: "Tracker empty-night recovery",
  reviewUrl:
    `http://127.0.0.1:4179/?app=tracker&review=1&mode=tonight` +
    `&tracker-recovery-review=target-obscured` +
    `&at=${encodeURIComponent(RECOVERY_PIN)}&z=8&pin=${encodeURIComponent(RECOVERY_PIN)}`,
  requiresReviewBridge: false,
  catalogAuthority: "none",
  readySelector: ".tracker-shell",
  notes: {
    featuresImplemented: [
      "Deterministic empty-night recovery evidence: full-window cloud plus exact target-direction obstruction removes every ordinary card through the production cloud-advice path",
      "Recovery leads with later-tonight and tomorrow forecast windows, skips routine lunar phases, and promotes the authoritative pipeline's stronger Moon–Jupiter conjunction",
    ],
    knownLimitations: [
      "The obstructed sky and forecast transitions are provider-shaped review fixtures, identified as such in every captured state; they do not claim to be observations of the review machine's real sky.",
    ],
    expectedReviewFocus: [
      "Verify every screenshot visibly contains the compact recovery briefing rather than ordinary recommendations.",
      "Compare the recovery date, target, observer, planning key and recommendation identities recorded beside each screenshot in review.json.",
      "Verify the moved observer first shows a withdrawn/loading result and then a newly computed result for the new observer.",
      "Verify the forecast update replaces the prior chance with the anticipation-worthy Upcoming event without lowering Tracker's threshold.",
    ],
  },

  async prepare({ context, page }) {
    forecastCase = "following-night";
    await page.clock.setFixedTime(trackerReviewFixtures.at);
    await context.addInitScript(() => {
      window.__ORBIT_TRACKER_RECOVERY_FIXTURE__ = "target-obscured";
    });
    await stubTracker(context, {
      basemap: "empty",
      satellites: "unavailable",
      unavailable: "empty",
    });
    await stubEnvironment(context);
    await seedPlace(context, PORTLAND);

    // The coarse feed remains closed for the whole selected observing night.
    // The opt-in review adapter supplies separate exact-direction evidence for
    // every candidate; neither source is allowed to impersonate the other.
    await stubCloudForecast(context, 100);

    // Registered last so it wins over the general unavailable-data route.
    await context.route(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact**",
      (route) => {
        const request = new URL(route.request().url());
        const latitude = Number(request.searchParams.get("lat"));
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(recoveryWeatherForecast(forecastCase, latitude)),
        });
      },
    );
  },

  async run({ captureSurface, page }) {
    // Recovery is primarily a mobile hierarchy. Capture it at a supported
    // phone viewport so the first-card claim is proved in visible output,
    // rather than inferred from the wider desktop briefing.
    await page.setViewportSize({ width: 390, height: 844 });
    const observer = RECOVERY_PIN;

    const captureRecovery = async (id, expected, fixture) => {
      const state = assertPass(
        trackerRecoveryValidation(await waitForRecovery(page, expected), expected),
        `${id} did not produce the required recovery state`,
      );
      await captureSurface(id, {
        ...state,
        fixture: {
          ...fixture,
          coarseCloudPercent: 100,
          coarseCloudScope: "whole selected-night forecast window",
          localEvidence: "fresh high-confidence target-direction heavy-cloud for each candidate",
          visualVerification: false,
        },
      });
      return state;
    };

    const refreshForecast = async (nextCase) => {
      forecastCase = nextCase;
      await page.evaluate(async () => {
        const bridge = window.__ORBIT_TRACKER_RECOVERY_REVIEW__;
        if (!bridge) throw new Error("Tracker recovery review bridge is unavailable.");
        await bridge.refreshForecast();
      });
    };

    // 1. A truly empty current night: every ordinary card is rejected, and the
    // nearest forecast-backed opportunity is two nights ahead.
    await captureRecovery(
      "tracker-recovery-fully-clouded-current-night",
      { kind: "chance", date: FOLLOWING_NIGHT, observer },
      { forecastCase: "following-night" },
    );

    // 2. The same selected night, now with a good forecast interval before its
    // observing period ends. The recovery must call it Later tonight.
    await refreshForecast("later-tonight");
    const later = await captureRecovery(
      "tracker-recovery-next-opportunity-later-tonight",
      { kind: "chance", date: REVIEW_NIGHT, observer },
      { forecastCase: "later-tonight" },
    );
    if (!/Later tonight/i.test(later.recoveryText ?? "")) {
      throw new Error(`Later-tonight recovery copy was not visible: ${later.recoveryText}`);
    }

    // 3. With the selected night closed and the following evening open, the
    // card must name tomorrow and expose a useful target and local time.
    await refreshForecast("tomorrow");
    const tomorrow = await captureRecovery(
      "tracker-recovery-next-opportunity-tomorrow",
      { kind: "chance", date: NEXT_NIGHT, observer },
      { forecastCase: "tomorrow" },
    );
    if (!/Tomorrow/i.test(tomorrow.recoveryText ?? "") || !tomorrow.recoveryTarget) {
      throw new Error(`Tomorrow recovery lacks its date or target: ${tomorrow.recoveryText}`);
    }

    // 4. A forecast that never reaches Good inside the bounded horizon must
    // consult the already-built Upcoming event list. Its routine quarter phase
    // is skipped in favour of the stronger Moon–Jupiter conjunction.
    await refreshForecast("no-near-term-window");
    const upcomingFallback = await captureRecovery(
      "tracker-recovery-strong-upcoming-fallback",
      { kind: "upcoming", observer },
      { forecastCase: "no-near-term-window", horizonNights: 7 },
    );
    if (
      !/conjunction/i.test(upcomingFallback.recoveryTarget ?? "") ||
      /quarter/i.test(upcomingFallback.recoveryText ?? "")
    ) {
      throw new Error(
        `Recovery did not prefer the strong conjunction: ${upcomingFallback.recoveryText}`,
      );
    }

    // 5. Restore a concrete Portland chance, then move the authoritative pin.
    // Capture both the immediate withdrawal and the completed new answer.
    await refreshForecast("tomorrow");
    const beforeMove = await captureRecovery(
      "tracker-recovery-location-before-change",
      { kind: "chance", date: NEXT_NIGHT, observer },
      { forecastCase: "tomorrow", leg: "before location change" },
    );

    forecastCase = "location";
    await page.evaluate((site) => {
      const url = new URL(window.location.href);
      url.searchParams.set("pin", `${site.latitude.toFixed(3)},${site.longitude.toFixed(3)}`);
      window.history.pushState(null, "", url.toString());
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, SECOND_SITE);

    const movedObserver = `${SECOND_SITE.latitude},${SECOND_SITE.longitude}`;
    const withdrawn = assertPass(
      trackerRecoveryValidation(
        await waitForRecovery(page, { kind: "loading", observer: movedObserver }),
        { kind: "loading", observer: movedObserver },
      ),
      "The old recovery result was not withdrawn for the new observer",
    );
    if (
      withdrawn.recoveryDate !== null ||
      withdrawn.recoveryTarget !== null ||
      withdrawn.recoveryPlanningKey === beforeMove.recoveryPlanningKey
    ) {
      throw new Error("The location-loading state retained Portland's recovery answer.");
    }
    await captureSurface("tracker-recovery-location-old-result-withdrawn", {
      ...withdrawn,
      fixture: {
        forecastCase: "location",
        leg: "new observer loading",
        previousObserver: beforeMove.observer,
        previousRecoveryTarget: beforeMove.recoveryTarget,
        previousRecoveryDate: beforeMove.recoveryDate,
      },
    });

    const moved = await captureRecovery(
      "tracker-recovery-location-new-result",
      { kind: "chance", date: REVIEW_NIGHT, observer: movedObserver },
      { forecastCase: "location", leg: "new observer ready" },
    );
    if (moved.recoveryPlanningKey === beforeMove.recoveryPlanningKey) {
      throw new Error("The moved observer reused Portland's recovery planning key.");
    }

    // 6. Keep the observer fixed and publish a changed forecast. The old
    // chance must disappear and the anticipation-worthy Upcoming fallback take over.
    const beforeForecastTarget = moved.recoveryTarget;
    await refreshForecast("no-near-term-window");
    const updated = await captureRecovery(
      "tracker-recovery-forecast-update-strong-upcoming",
      { kind: "upcoming", observer: movedObserver },
      {
        forecastCase: "no-near-term-window",
        previousRecoveryKind: moved.recoveryKind,
        previousRecoveryTarget: beforeForecastTarget,
      },
    );
    if (updated.recoveryTarget === beforeForecastTarget) {
      throw new Error("The forecast update retained the prior next-best target.");
    }
  },
};
