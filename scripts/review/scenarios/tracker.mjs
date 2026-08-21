export function trackerStateValidation(state) {
  const failures = [];
  if (state.locationAuthority !== "confirmed") failures.push("location-not-confirmed");
  if (!state.planIdentity) failures.push("plan-identity-missing");
  if (!state.category) failures.push("phenomenon-category-missing");
  // Four regions, in one order, for every phenomenon. A page that has lost one
  // of them has stopped being the universal layout, whatever it looks like.
  for (const region of ["heading", "hero", "visualization", "conditions", "list"]) {
    if (!state.regions?.[region]) failures.push(`region-missing:${region}`);
  }
  if (state.metricCount !== 3) failures.push(`metrics-not-three:${state.metricCount}`);
  if (state.conditionCardCount !== 4) {
    failures.push(`condition-cards-not-four:${state.conditionCardCount}`);
  }
  if (
    state.environmentStatus !== "available" &&
    /^(Exceptional|Worth going out for)$/i.test(state.recommendationLevel ?? "")
  ) {
    failures.push("unknown-environment-presented-as-confident");
  }
  if (
    state.environmentStatus !== "available" &&
    !/conditions unknown|check before going/i.test(state.recommendationLevel ?? "")
  ) {
    failures.push("unknown-environment-disclosure-missing");
  }
  // Absent weather must read as absent, never as a number.
  if (state.environmentStatus !== "available" && /\d+\s*%/.test(state.cloudValue ?? "")) {
    failures.push("cloud-cover-fabricated-without-evidence");
  }
  return { ...state, pass: failures.length === 0, failures };
}

async function readTrackerState(page) {
  return page.evaluate(() => ({
    title: document.title,
    locationAuthority:
      document.querySelector(".tracker-place-current")?.getAttribute("data-location-authority") ?? null,
    planIdentity: document.querySelector(".tk-tonight")?.getAttribute("data-plan-identity") ?? null,
    category: document.querySelector(".tk-page")?.getAttribute("data-category") ?? null,
    environmentStatus:
      document.querySelector(".tk-conditions")?.getAttribute("data-evidence-status") ?? null,
    // The judgement, read as a value rather than parsed out of English. The
    // sentence is generated from it and is free to change wording.
    recommendationLevel:
      document.querySelector(".tk-hero")?.getAttribute("data-recommendation") ?? null,
    recommendation: document.querySelector(".tk-hero-recommendation")?.textContent?.trim() ?? null,
    metricCount: document.querySelectorAll(".tk-hero-metrics .tk-metric").length,
    conditionCardCount: document.querySelectorAll(".tk-condition-card").length,
    cloudValue:
      document.querySelector(".tk-condition-card .tk-condition-value")?.textContent?.trim() ?? null,
    regions: {
      heading: Boolean(document.querySelector(".tk-page-heading h1")),
      hero: Boolean(document.querySelector(".tk-hero .tk-hero-name")),
      visualization: Boolean(document.querySelector(".tk-viz-slot")?.firstElementChild),
      conditions: Boolean(document.querySelector(".tk-conditions-row")),
      list: Boolean(document.querySelector(".tk-relevant-list")),
    },
  }));
}

export const trackerReviewScenario = {
  id: "tracker",
  title: "Tracker Phase 1",
  reviewUrl: "http://127.0.0.1:4179/?app=tracker",
  requiresReviewBridge: false,
  readySelector: ".tracker-shell",
  notes: {
    featuresImplemented: [
      "One universal event page: heading, hero, visualization slot, four condition cards, ranked rows",
      "Real solar-eclipse track and coverage geometry, and NOAA OVATION aurora nowcast",
      "Unit-bearing Moon, eclipse, opposition, and conjunction semantics",
      "Categorical available, stale, unavailable, failed, and unsupported environmental evidence",
      "Query-versioned location search with confirmed-location authority",
      "Versioned local persistence of rounded confirmed-place data only",
    ],
    knownLimitations: [
      "Phase 1 does not claim the known mobile layout, planning performance, or broad accessibility blockers are fixed.",
      "Weather is deliberately failed in this deterministic scenario to prove honest degradation.",
    ],
    expectedReviewFocus: [
      "Verify the eclipse and aurora pages have not drifted from the meteor page's geometry.",
      "Verify a replaced/no-result location query cannot retain a stale selectable option.",
      "Verify failed weather never produces a confident go recommendation.",
      "Verify changing or restoring a confirmed location yields a distinct plan identity.",
    ],
  },

  async run({ captureSurface, page }) {
    await page.route("https://api.weather.gov/**", (route) =>
      route.fulfill({ status: 503, contentType: "text/plain", body: "review-controlled failure" }),
    );
    await page.route("https://api.met.no/**", (route) =>
      route.fulfill({ status: 503, contentType: "text/plain", body: "review-controlled failure" }),
    );
    await page.route("https://photon.komoot.io/api/**", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q") ?? "";
      const features = /350 5th Avenue/i.test(query)
        ? [{
            properties: {
              osm_type: "W",
              osm_id: 350,
              name: "Empire State Building",
              housenumber: "350",
              street: "5th Avenue",
              postcode: "10118",
              city: "New York",
              state: "New York",
              country: "United States",
              osm_value: "attraction",
            },
            geometry: { coordinates: [-73.9857, 40.7484] },
          }]
        : /Sydney, Australia/i.test(query)
          ? [{
              properties: {
                osm_type: "R",
                osm_id: 151,
                name: "Sydney",
                city: "Sydney",
                state: "New South Wales",
                country: "Australia",
                osm_value: "city",
              },
              geometry: { coordinates: [151.2093, -33.8688] },
            }]
        : /Union Square/i.test(query)
        ? [{
            properties: {
              osm_type: "W",
              osm_id: 1,
              name: "Union Square",
              city: "New York",
              state: "New York",
              country: "United States",
              osm_value: "park",
            },
            geometry: { coordinates: [-73.9903, 40.7359] },
          }]
        : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ features }) });
    });

    await captureSurface("tracker-entry", { state: "entry" });
    const search = page.getByRole("combobox", { name: "Search for a place to observe from" });
    await search.fill("350 5th Avenue, New York, NY 10118");
    const exactAddress = page.getByRole("option", { name: /Empire State Building/i });
    await exactAddress.waitFor({ timeout: 10_000 });
    if (!/Exact address/i.test(await exactAddress.innerText())) {
      throw new Error("A structured full-address match was not labelled exact.");
    }
    await captureSurface("tracker-location-exact-address", {
      state: "exact-address",
      input: "350 5th Avenue, New York, NY 10118",
      result: "Empire State Building",
      precision: "exact-address",
    });
    await exactAddress.click();
    await page.getByRole("button", { name: "Choose another" }).click();
    await search.fill("Union Square, New York");
    await page.getByRole("option", { name: /Union Square/i }).waitFor({ timeout: 10_000 });
    await search.fill("zzqxv nonexistent nebula 99999");
    if ((await page.getByRole("option").count()) !== 0) {
      throw new Error("A stale place remained selectable after the query identity changed.");
    }
    await page.getByText(/No match for that/i).waitFor({ timeout: 10_000 });
    await captureSurface("tracker-location-no-result", {
      state: "no-result",
      selectableOptions: await page.getByRole("option").count(),
    });

    await search.fill("45.5152, -122.6784");
    await page.getByRole("option").click();
    await page.getByRole("button", { name: "Yes, use this" }).click();
    await page.locator(".tk-tonight").waitFor({ timeout: 20_000 });
    await page.locator('[data-evidence-status="request-failed"]').first().waitFor({ timeout: 20_000 });
    const first = trackerStateValidation(await readTrackerState(page));
    if (!first.pass) throw new Error(`Tracker review state failed: ${first.failures.join(", ")}`);
    await captureSurface("tracker-tonight-weather-failed", first);

    await page.getByRole("button", { name: "Upcoming", exact: true }).click();
    await page.getByRole("heading", { name: "Upcoming" }).waitFor({ timeout: 20_000 });
    await page.locator(".tk-highlights").waitFor({ timeout: 30_000 });
    await captureSurface("tracker-upcoming-list", { state: "upcoming-list" });
    await page.getByRole("tab", { name: "Calendar" }).click();
    await page.locator(".tk-month").waitFor({ timeout: 20_000 });
    if (/Venus\s+Opposition/i.test(await page.locator("body").innerText())) {
      throw new Error("Calendar presented impossible Venus opposition semantics.");
    }
    await captureSurface("tracker-calendar-classification", { state: "calendar" });

    await page.getByRole("button", { name: "Tonight", exact: true }).click();
    await page.locator(".tk-tonight").waitFor();
    const originalIdentity = await page.locator(".tk-tonight").getAttribute("data-plan-identity");
    // Replace the versioned confirmed-place record, then exercise the actual
    // production restore path. The UI search race is covered above; this step
    // isolates persisted authority and plan invalidation without a live service.
    await page.evaluate(() => {
      localStorage.setItem(
        "orbit-studio:tracker:confirmed-place:v1",
        JSON.stringify({
          version: 1,
          place: {
            name: "Sydney",
            context: "New South Wales, Australia",
            latitude: -33.8688,
            longitude: 151.2093,
            fromDevice: false,
          },
        }),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Restored", { exact: true }).waitFor({ timeout: 20_000 });
    await page.locator(".tk-tonight").waitFor({ timeout: 20_000 });
    const changedIdentity = await page.locator(".tk-tonight").getAttribute("data-plan-identity");
    if (changedIdentity === originalIdentity) {
      throw new Error("Changing persisted confirmed location did not invalidate the plan identity.");
    }
    await captureSurface("tracker-location-changed", {
      state: "location-changed",
      originalIdentity,
      changedIdentity,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Restored", { exact: true }).waitFor({ timeout: 20_000 });
    await page.locator(".tk-tonight").waitFor({ timeout: 20_000 });
    const restoredIdentity = await page.locator(".tk-tonight").getAttribute("data-plan-identity");
    if (restoredIdentity !== changedIdentity) {
      throw new Error("Restored confirmed location did not reproduce the authoritative plan identity.");
    }
    await captureSurface("tracker-location-restored", {
      state: "restored",
      restoredIdentity,
    });
  },
};
