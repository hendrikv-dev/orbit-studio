/**
 * Pan and zoom for Tracker's geographic maps.
 *
 * ## Why this is arithmetic rather than a mapping library
 *
 * Tracker's maps are equirectangular, and that projection is *linear* in
 * longitude and latitude. A degree of longitude is the same number of pixels
 * everywhere on the drawing, and so is a degree of latitude. Panning is
 * therefore a translation and zooming is a scale — there is no reprojection to
 * do, no tile pyramid to fetch, and no basemap server to depend on.
 *
 * That is the whole reason a dependency is not warranted here. Leaflet or
 * MapLibre would each add hundreds of kilobytes to a bundle that exists
 * specifically so an observer's page does not pay for data it never shows, and
 * would bring a tile source Tracker would then have to license, attribute and
 * survive the outage of. What they would buy is a projection engine for a
 * projection that is one multiply and one add.
 *
 * So the viewport is a rectangle in the map's own coordinate space, applied as
 * an SVG `viewBox`. Every layer already drawn — coastlines, graticule, the
 * phenomenon field, the markers — moves and scales with it for free, because
 * that is what a viewBox does. The alternative, re-rendering each layer per
 * frame, would be slower and would need every layer to know about zoom.
 *
 * Keeping the arithmetic in this file rather than in the component is what
 * makes it testable: none of the functions below touch React or the DOM.
 */

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportBase {
  width: number;
  height: number;
}

/**
 * How far in the reader may go.
 *
 * Four is not a rendering limit — the SVG would happily scale further — but a
 * usefulness one. The phenomenon fields underneath are sampled at one to two
 * degrees, so past about four times the cells become visible as cells and the
 * map would be showing the reader its own sampling lattice rather than the
 * world.
 */
export const MAX_ZOOM = 4;
export const MIN_ZOOM = 1;

export function baseViewport(base: ViewportBase): Viewport {
  return { x: 0, y: 0, width: base.width, height: base.height };
}

/** How far in the viewport currently is, as a multiple of the whole map. */
export function zoomLevel(viewport: Viewport, base: ViewportBase): number {
  return base.width / viewport.width;
}

/**
 * Keeps the viewport inside the map.
 *
 * Without this, panning at the edge walks the drawing off into empty space and
 * the reader loses the world with no obvious way back. Clamping means a drag
 * that runs past the edge simply stops, which is what every map does.
 */
export function clampViewport(viewport: Viewport, base: ViewportBase): Viewport {
  const width = Math.min(base.width, Math.max(base.width / MAX_ZOOM, viewport.width));
  const height = Math.min(base.height, Math.max(base.height / MAX_ZOOM, viewport.height));
  return {
    width,
    height,
    x: Math.min(Math.max(0, viewport.x), base.width - width),
    y: Math.min(Math.max(0, viewport.y), base.height - height),
  };
}

/**
 * Zooms about a fixed point, so the thing under the cursor stays under it.
 *
 * Zooming about the centre instead is the small mistake that makes a map feel
 * broken: the reader points at what they want a closer look at, and it slides
 * away from them.
 */
export function zoomViewport(
  viewport: Viewport,
  factor: number,
  focus: { x: number; y: number },
  base: ViewportBase,
): Viewport {
  const current = zoomLevel(viewport, base);
  const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor));
  // Recomputed from the target level rather than multiplied through, so a
  // sequence of clamped zooms cannot drift the aspect ratio.
  const width = base.width / target;
  const height = base.height / target;
  // The focus point keeps its fractional position within the viewport.
  const fx = viewport.width === 0 ? 0.5 : (focus.x - viewport.x) / viewport.width;
  const fy = viewport.height === 0 ? 0.5 : (focus.y - viewport.y) / viewport.height;
  return clampViewport(
    { x: focus.x - fx * width, y: focus.y - fy * height, width, height },
    base,
  );
}

export function panViewport(
  viewport: Viewport,
  dx: number,
  dy: number,
  base: ViewportBase,
): Viewport {
  return clampViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy }, base);
}

/** Centres the viewport on a point without changing how far in it is. */
export function centreViewportOn(
  viewport: Viewport,
  point: { x: number; y: number },
  base: ViewportBase,
): Viewport {
  return clampViewport(
    { ...viewport, x: point.x - viewport.width / 2, y: point.y - viewport.height / 2 },
    base,
  );
}

/** The viewBox attribute for a viewport. */
export function viewBoxOf(viewport: Viewport): string {
  return `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`;
}

/**
 * Converts a point in the rendered element to the map's own coordinates.
 *
 * The SVG is laid out with `preserveAspectRatio="xMidYMid meet"`, so it is
 * letterboxed inside its box whenever the two aspects differ. Ignoring that is
 * the bug that makes clicks land a few degrees away from where the reader
 * pressed — increasingly so towards the edges — so the letterbox offset is
 * computed rather than assumed to be zero.
 */
export function elementPointToMap(
  point: { x: number; y: number },
  element: { width: number; height: number },
  viewport: Viewport,
): { x: number; y: number } {
  const scale = Math.min(element.width / viewport.width, element.height / viewport.height);
  const drawnWidth = viewport.width * scale;
  const drawnHeight = viewport.height * scale;
  const offsetX = (element.width - drawnWidth) / 2;
  const offsetY = (element.height - drawnHeight) / 2;
  return {
    x: viewport.x + (point.x - offsetX) / scale,
    y: viewport.y + (point.y - offsetY) / scale,
  };
}

/**
 * How much a fixed-size ornament must shrink to stay a fixed size on screen.
 *
 * Markers and labels are drawn in map coordinates, so a viewBox zoom magnifies
 * them along with everything else and a pin becomes a billboard. Dividing their
 * size by the zoom keeps them constant, which is what a marker is for.
 */
export function ornamentScale(viewport: Viewport, base: ViewportBase): number {
  return viewport.width / base.width;
}
