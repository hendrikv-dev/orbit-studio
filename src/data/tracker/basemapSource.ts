/**
 * Where the basemap's tiles come from, and how that changes.
 *
 * ## The decision this file records
 *
 * Tracker renders with MapLibre GL. That is settled and is not what this file
 * is about. What tiles MapLibre reads is a *separate* decision, and this module
 * exists so it is exactly one line rather than an assumption spread through the
 * map component.
 *
 * The end state is a vector basemap we control: a single Protomaps PMTiles
 * archive on our own static storage, read over HTTP range requests, with no
 * third-party tile request at runtime. `docs/tracker-spatial-reuse-matrix.md`
 * selected that path in August, for the reason that still holds — it is
 * self-hostable, needs no vendor account, and no mandatory third-party API.
 *
 * The current state is the public OpenFreeMap instance, and it is temporary.
 * It is here to validate the interface — camera, palette, interaction, the
 * failure state — while the archive is generated and a bucket is chosen, both
 * of which are infrastructure rather than code.
 *
 * ## What it costs to finish the migration
 *
 * Measured against the live Protomaps planet build, an extract of the whole
 * world is 14 MB to z5 and 179 MB to z7; the chosen z10 ceiling lands near
 * 2.2 GB. z10 is the zoom at which you can see villages, lanes and terrain
 * shape — enough to choose between two observing sites an hour apart, which is
 * the question the map exists to answer. Street-level detail is not Tracker's
 * problem and is what makes the archive expensive.
 *
 *     pmtiles extract https://build.protomaps.com/<date>.pmtiles \
 *       world-z10.pmtiles --maxzoom=10
 *
 * Then upload it, register the protocol, and change `BASEMAP` below to
 * `SELF_HOSTED`. Nothing else in the map component refers to the tile source,
 * which is the point of the indirection.
 *
 * `MAP_MAX_ZOOM` is deliberately pinned to the same ceiling the archive will
 * carry, so the interface never learns to ask for tiles we will not serve. The
 * cutover is then invisible: the same map, from our own storage.
 */

export interface BasemapSource {
  /** A MapLibre style URL, or a style object's URL. */
  readonly styleUrl: string;
  /** Shown in the corner. Required by the data licences, not optional. */
  readonly attribution: string;
  /** True while tiles come from somewhere we do not run. */
  readonly thirdParty: boolean;
}

/**
 * The public OpenFreeMap instance. Temporary.
 *
 * MIT-licensed stack, OpenStreetMap data under ODbL, no API key and no account.
 * The operator asks for no registration and rate-limits nothing, which is
 * exactly why it is unwise to depend on it permanently: there is no agreement
 * to rely on and no availability anybody owes us.
 */
const PUBLIC_OPENFREEMAP: BasemapSource = {
  styleUrl: "https://tiles.openfreemap.org/styles/dark",
  attribution: "© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles",
  thirdParty: true,
};

/**
 * The archive we serve ourselves. Not live yet — see the note above.
 *
 * Kept in the file rather than in a document so the finished shape is legible
 * from the code, and so switching is a one-word edit under review rather than a
 * small project somebody has to reconstruct.
 */
export const SELF_HOSTED: BasemapSource = {
  styleUrl: "/basemap/tracker-dark.json",
  attribution: "© OpenStreetMap contributors · Protomaps",
  thirdParty: false,
};

export const BASEMAP: BasemapSource = PUBLIC_OPENFREEMAP;
