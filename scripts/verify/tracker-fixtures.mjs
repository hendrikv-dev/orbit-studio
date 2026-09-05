/**
 * The fixtures a Tracker state is built from, shared by the gate and the
 * review package.
 *
 * They live here because both need the *same* night. The refinement gate
 * asserts that a station pass is offered on a particular evening; the review
 * package photographs that offer as evidence. If each carried its own copy of
 * the elements and its own clock, the picture and the assertion would drift
 * apart at the first edit, and the evidence would quietly stop being evidence
 * of the thing that was checked.
 */

export const PORTLAND = {
  name: "Portland",
  context: "Oregon, United States",
  latitude: 45.5152,
  longitude: -122.6784,
};

/** A style with nothing in it, so a run does not depend on a tile server. */
export const EMPTY_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#0e1219" } }],
};

/**
 * Pinned orbits, so a pass is the same pass every time this runs.
 *
 * Constructed here rather than acquired. They are the *shape* of the real
 * things — a station four hundred kilometres up at 51.64°, a deployment stack
 * at 265 km and seventy degrees — chosen so both cross Portland high and sunlit
 * in the pinned window. CelesTrak's usage policy covers retrieving their data
 * and this repository's own provenance review found no grant for committing it,
 * so the fixtures are Orbit Studio's own elements rather than a copy of theirs.
 *
 * The clock is pinned alongside them: a prediction is a function of both, and
 * either one drifting makes every assertion about tonight meaningless.
 */
export const ISS_TLE = `STATION
1 99001U 26900A   26245.50000000  .00000000  00000+0  00000+0 0  9998
2 99001  51.6400   6.0000 0005000  90.0000 298.0000 15.49000000000016
`;

export const STACK_TLE = `STARLINK-G15-23 STACK
1 99002U 26901A   26245.40000000  .00000000  00000+0  00000+0 0  9999
2 99002  70.0000  28.0000 0010000 275.0000 156.0000 16.06000000000010
STARLINK-G15-23 SINGLE
1 99003U 26901B   26245.40000000  .00000000  00000+0  00000+0 0  9995
2 99003  70.0000  28.0000 0010000 275.0000 156.5000 16.06000000000019
`;

export const SUPPLEMENTAL_INDEX = `<html><body>
  <a href="sup-gp.php?FILE=iss&FORMAT=tle">ISS</a>
  <a href="sup-gp.php?FILE=starlink&FORMAT=tle">Starlink</a>
  <a href="sup-gp.php?FILE=starlink-g15-23&FORMAT=tle">Starlink G15-23 Post-Deployment</a>
</body></html>`;

/**
 * The one instant every deterministic Tracker check is written against.
 *
 * Tracker's answers are a function of the time, so a check that reads the wall
 * clock is testing the hour it ran as much as the code. Holding only the *hour*
 * still is not enough either: the accessibility gate did that, pinning the page
 * to 05:30 on whatever date it happened to run while generating its own weather
 * fixtures from the real clock, and the two drifted apart by however far the
 * time of day was from 05:30. When the gap grew wide enough that the forecast
 * no longer covered the pinned night, the clear-sky fixture stopped applying,
 * a cloudy fallback took its place, and every opportunity was withheld.
 *
 * One exported instant, shared by every gate and by the review package, is what
 * keeps that from happening again — and keeps the picture in the package a
 * picture of the state the gate actually asserted.
 */
export const TRACKER_FIXTURE_AT = new Date("2026-09-03T05:00:00Z");

/**
 * The night the pinned element sets describe, at 22:00 in Portland.
 *
 * The same instant under the name the satellite fixtures reach for it by.
 */
export const SATELLITE_CLOCK = TRACKER_FIXTURE_AT;

/**
 * Basemap tiles, satellites and the cloud mask, routed for one browser context.
 *
 * `basemap: "empty"` keeps a run off the tile server, which is what the gate
 * wants: a check about a rail's geometry should not fail because somebody
 * else's CDN was slow. `basemap: "live"` is for the review package, where the
 * point is to show the product as a reader sees it.
 */
export async function stubTracker(
  context,
  { basemap = "empty", satellites = "unavailable" } = {},
) {
  if (basemap === "empty") {
    await context.route("**/tiles.openfreemap.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(EMPTY_STYLE),
      }),
    );
  }
  /**
   * Orbits are stubbed everywhere, and unavailable unless a caller asks for
   * them.
   *
   * Not to make anything pass: with the live feed a rail's contents would
   * depend on whether the station happened to go over the test location on the
   * morning this ran, and every assertion about tonight would become a
   * different assertion every day. Unavailable is also the state most readers
   * are in on most nights, so it is the right default to hold the rest steady
   * against.
   */
  await context.route("**/celestrak.org/**", (route) => {
    const url = route.request().url();
    if (satellites === "unavailable") {
      return route.fulfill({ status: 503, contentType: "text/plain", body: "" });
    }
    const text = (body) => route.fulfill({ status: 200, contentType: "text/plain", body });
    if (url.includes("FILE=iss")) return text(ISS_TLE);
    if (url.includes("FILE=starlink-g15-23")) {
      return satellites === "iss-only"
        ? route.fulfill({ status: 404, contentType: "text/plain", body: "" })
        : text(STACK_TLE);
    }
    if (url.includes("/supplemental/") && !url.includes("sup-gp.php")) {
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: satellites === "iss-only" ? "<html><body></body></html>" : SUPPLEMENTAL_INDEX,
      });
    }
    return route.fulfill({ status: 404, contentType: "text/plain", body: "" });
  });
}

/**
 * The GOES-West CONUS fixed grid, as a granule publishes it.
 *
 * Real numbers, because the client's own geolocation runs against them: a made
 * up projection would make the field land somewhere the map is not.
 */
export const FIXTURE_GRID = {
  originLongitudeDeg: -137,
  perspectiveHeightM: 35786023,
  semiMajorM: 6378137,
  semiMinorM: 6356752.31414,
  xOffsetRad: -0.101332,
  xScaleRad: 0.000056,
  yOffsetRad: 0.128212,
  yScaleRad: -0.000056,
  columns: 2500,
  rows: 1500,
};

/** The inverse from the Product User Guide, for a fixture's own use. */
export function cellForFixture(latitudeDeg, longitudeDeg) {
  const DEG = Math.PI / 180;
  const g = FIXTURE_GRID;
  const H = g.perspectiveHeightM + g.semiMajorM;
  const req = g.semiMajorM;
  const rpol = g.semiMinorM;
  const e2 = (req * req - rpol * rpol) / (req * req);
  const latitude = latitudeDeg * DEG;
  const difference = (longitudeDeg - g.originLongitudeDeg) * DEG;
  const geocentric = Math.atan(((rpol * rpol) / (req * req)) * Math.tan(latitude));
  const rc = rpol / Math.sqrt(1 - e2 * Math.cos(geocentric) * Math.cos(geocentric));
  const sx = H - rc * Math.cos(geocentric) * Math.cos(difference);
  const sy = -rc * Math.cos(geocentric) * Math.sin(difference);
  const sz = rc * Math.sin(geocentric);
  if (H * (H - sx) < sy * sy + ((req * req) / (rpol * rpol)) * sz * sz) return null;
  const y = Math.atan(sz / sx);
  const x = Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz));
  const column = Math.round((x - g.xOffsetRad) / g.xScaleRad);
  const row = Math.round((y - g.yOffsetRad) / g.yScaleRad);
  if (column < 0 || column >= g.columns || row < 0 || row >= g.rows) return null;
  return { column, row };
}

/**
 * A cloud mask that answers every shape the layer asks for.
 *
 * Three modes are in use — a point reading, a strided field over the view, and
 * a series of recent scans for the warning system — and stubbing only the first
 * is how a run ends up proving that a feature which never executed is fine.
 */
export function stubCloudMask(
  context,
  { acm = 2, series = null, status = 200, nowUtc = null, pattern = "uniform" } = {},
) {
  /**
   * When the scans in this fixture happened.
   *
   * Dated against the caller's clock rather than this process's, and resolved
   * per request rather than when the route is registered. A run that pins the
   * page clock to a chosen night would otherwise get scans stamped with the
   * wall-clock time here — which, if the machine happens to be in daylight,
   * fall outside that night's observing window and produce an observed layer
   * with nothing observed in it.
   */
  const when = () => (nowUtc ? Date.parse(nowUtc) : Date.now());
  return context.route("**/api/goes-cloud-mask*", (route) => {
    if (status !== 200) {
      return route.fulfill({ status, contentType: "application/json", body: "{}" });
    }
    const url = new URL(route.request().url());
    const head = {
      satellite: "GOES-West",
      platform: "G18",
      scene: "CONUS",
      product: "ABI-L2-ACMC (Clear Sky Mask)",
      resolution: "2.0km at nadir",
      observedUtc: new Date(when()).toISOString(),
      probabilityScale: 1.5261e-5,
    };
    if (url.searchParams.get("series") === "1") {
      const at = when();
      const levels = series ?? [acm, acm, acm, acm];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...head,
          frames: levels.map((level, index) => ({
            observedUtc: new Date(at - (levels.length - 1 - index) * 600_000).toISOString(),
            covered: true,
            acm: level,
            cloudProbabilityRaw: 51154,
            dqf: 0,
            probabilityScale: head.probabilityScale,
          })),
        }),
      });
    }
    if (url.searchParams.get("bbox")) {
      const [south, west, north, east] = (url.searchParams.get("bbox") ?? "")
        .split(",")
        .map(Number);
      const corners = [
        cellForFixture(south, west),
        cellForFixture(south, east),
        cellForFixture(north, west),
        cellForFixture(north, east),
      ].filter(Boolean);
      if (corners.length < 4) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...head, covered: false }),
        });
      }
      const rows = corners.map((c) => c.row);
      const columns = corners.map((c) => c.column);
      const row0 = Math.min(...rows);
      const row1 = Math.max(...rows);
      const column0 = Math.min(...columns);
      const column1 = Math.max(...columns);
      const cells = Number(url.searchParams.get("cells")) || 64;
      let stride = 1;
      while (
        Math.ceil((row1 - row0 + 1) / stride) * Math.ceil((column1 - column0 + 1) / stride) >
        cells * cells
      ) {
        stride += 1;
      }
      const width = Math.ceil((column1 - column0 + 1) / stride);
      const height = Math.ceil((row1 - row0 + 1) / stride);
      const count = width * height;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...head,
          covered: true,
          grid: FIXTURE_GRID,
          window: { row0, row1, column0, column1, stride },
          width,
          height,
          /**
           * Uniform by default, because a check that compares one
           * classification against another needs the rest of the field held
           * still. `"banded"` lays diagonal bands of all four levels across the
           * window instead, which is what a picture of the layer wants: a wash
           * of one value over the whole screen shows that the layer draws, and
           * nothing at all about whether it discriminates.
           */
          acm:
            pattern === "banded"
              ? Array.from({ length: count }, (_, index) => {
                  const column = index % width;
                  const row = Math.floor(index / width);
                  const band = Math.floor((column * 0.7 + row * 1.3) / 9) % 6;
                  return [0, 0, 1, 2, 3, 3][band];
                })
              : Array.from({ length: count }, () => acm),
          dqf: Array.from({ length: count }, () => 0),
          cloudProbabilityRaw: Array.from({ length: count }, () => 51154),
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...head,
        covered: true,
        cell: { column: 1768, row: 162 },
        acm,
        cloudProbabilityRaw: 51154,
        dqf: 0,
      }),
    });
  });
}

/** An hourly forecast of one repeated percentage, for both request shapes. */
export function stubCloudForecast(context, percent) {
  return context.route("**/api.open-meteo.com/v1/forecast**", (route) => {
    const url = new URL(route.request().url());
    const latitudes = (url.searchParams.get("latitude") ?? "").split(",");
    const start = url.searchParams.get("start_hour") ?? "2026-09-03T04:00";
    const end = url.searchParams.get("end_hour") ?? start;
    const hours = [];
    for (let at = Date.parse(`${start}:00Z`); at <= Date.parse(`${end}:00Z`); at += 3_600_000) {
      hours.push(new Date(at).toISOString().slice(0, 16));
    }
    const body =
      latitudes.length > 1
        ? Array.from({ length: latitudes.length }, () => ({
            hourly: { time: [start], cloud_cover: [percent] },
          }))
        : { hourly: { time: hours, cloud_cover: hours.map(() => percent) } };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

/** Put a confirmed place in storage, so a run opens where it means to. */
export async function seedPlace(context, place = PORTLAND) {
  await context.addInitScript((value) => {
    localStorage.setItem(
      "orbit-studio:tracker:confirmed-place:v1",
      JSON.stringify({ version: 1, place: { ...value, fromDevice: false } }),
    );
  }, place);
}
