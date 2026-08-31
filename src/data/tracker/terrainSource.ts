/**
 * Where elevation comes from.
 *
 * ## The decision this file records
 *
 * Mapterhorn, as a MapLibre-compatible Terrarium `raster-dem` product. The
 * vendor evaluation happened outside this pass and is not reopened here.
 *
 * ## What Mapterhorn actually is
 *
 * A composite. It merges several open elevation datasets — USGS 3DEP over the
 * United States where available, Copernicus DEM globally, and other regional
 * open sources — so **the planet does not have one resolution**. Ten-metre
 * posts over Oregon and thirty-metre posts over the Sahara are both "Mapterhorn"
 * and Tracker must not describe either as the other. Everything downstream that
 * reports a terrain result carries that uncertainty rather than flattening it.
 *
 * ## Temporary, in the same sense the basemap is
 *
 * These tiles come from Mapterhorn's public service. That is acceptable for
 * review and is not the production posture: the intended end state is the same
 * as for the basemap — a PMTiles archive on storage we control. The interface
 * here is one constant and a TileJSON URL, so moving it is the same one-line
 * change the basemap has waiting.
 */

export interface TerrainSource {
  /** TileJSON, which carries the tile template, the encoding and the licence. */
  readonly tileJsonUrl: string;
  /** The tile template, so the analytical path can fetch without the TileJSON. */
  readonly tileUrl: string;
  /** Terrarium: elevation = (R * 256 + G + B / 256) - 32768, in metres. */
  readonly encoding: "terrarium";
  readonly tileSize: number;
  /** The deepest zoom the service serves. Beyond it, tiles are overzoomed. */
  readonly maxZoom: number;
  readonly attribution: string;
  /** True while the tiles come from somewhere we do not run. */
  readonly thirdParty: boolean;
}

const MAPTERHORN: TerrainSource = {
  tileJsonUrl: "https://tiles.mapterhorn.com/tilejson.json",
  tileUrl: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
  encoding: "terrarium",
  tileSize: 512,
  /**
   * Fifteen, which is where the service stops serving distinct data.
   *
   * Asking for more returns an overzoomed tile: the same posts, resampled. The
   * horizon algorithm reads at this zoom and no further, because sampling finer
   * than the data would manufacture precision the terrain does not have.
   */
  maxZoom: 15,
  /**
   * Linked, because the link is the attribution.
   *
   * The tiles are built from 148 separate elevation datasets, most of them CC
   * BY or an open government licence that names a producer. No map's corner can
   * carry 148 credits, and the mechanism the publisher provides — and that
   * every one of those licences accepts — is a link to the full list. Naming
   * two of the largest contributors is a courtesy to the reader; the link is
   * what discharges the obligation, so it must not be dropped for a tidier
   * string.
   */
  attribution:
    "Terrain <a href=\"https://mapterhorn.com/attribution\" target=\"_blank\" rel=\"noopener\">© Mapterhorn</a>, from USGS 3DEP, Copernicus DEM and other open elevation sources",
  thirdParty: true,
};

export const TERRAIN: TerrainSource = MAPTERHORN;

/**
 * Roughly how far apart the elevation posts are, at a given latitude and zoom.
 *
 * Used to decide when a terrain result is too close to call. It is the *tile*
 * resolution, not the source data's — Mapterhorn's underlying posts may be
 * coarser than the tile grid in places, which is why the uncertainty model
 * below is deliberately generous rather than derived from this alone.
 */
export function groundResolutionM(latitudeDeg: number, zoom: number): number {
  const earthCircumference = 40_075_016.686;
  return (
    (earthCircumference * Math.cos((latitudeDeg * Math.PI) / 180)) /
    (TERRAIN.tileSize * 2 ** zoom)
  );
}
