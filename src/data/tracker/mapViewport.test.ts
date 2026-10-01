import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  baseViewport,
  centreViewportOn,
  clampViewport,
  elementPointToMap,
  ornamentScale,
  panViewport,
  viewBoxOf,
  zoomLevel,
  zoomViewport,
} from "./mapViewport";

const BASE = { width: 640, height: 400 };

describe("the map viewport", () => {
  it("starts as the whole map", () => {
    const viewport = baseViewport(BASE);
    expect(viewport).toEqual({ x: 0, y: 0, width: 640, height: 400 });
    expect(zoomLevel(viewport, BASE)).toBe(1);
    expect(viewBoxOf(viewport)).toBe("0 0 640 400");
  });

  describe("zooming", () => {
    it("keeps the focus point under the cursor", () => {
      // The small mistake that makes a map feel broken is zooming about the
      // centre: the reader points at what they want to see and it slides away.
      const focus = { x: 160, y: 100 };
      const zoomed = zoomViewport(baseViewport(BASE), 2, focus, BASE);
      const before = (focus.x - 0) / 640;
      const after = (focus.x - zoomed.x) / zoomed.width;
      expect(after).toBeCloseTo(before, 6);
      const beforeY = (focus.y - 0) / 400;
      const afterY = (focus.y - zoomed.y) / zoomed.height;
      expect(afterY).toBeCloseTo(beforeY, 6);
    });

    it("refuses to go further in than the data is sampled", () => {
      let viewport = baseViewport(BASE);
      for (let step = 0; step < 12; step += 1) {
        viewport = zoomViewport(viewport, 2, { x: 320, y: 200 }, BASE);
      }
      expect(zoomLevel(viewport, BASE)).toBeCloseTo(MAX_ZOOM, 6);
    });

    it("refuses to go further out than the whole map", () => {
      let viewport = baseViewport(BASE);
      for (let step = 0; step < 12; step += 1) {
        viewport = zoomViewport(viewport, 0.5, { x: 320, y: 200 }, BASE);
      }
      expect(zoomLevel(viewport, BASE)).toBeCloseTo(MIN_ZOOM, 6);
      expect(viewport).toEqual(baseViewport(BASE));
    });

    it("holds its aspect ratio through a sequence of clamped zooms", () => {
      // Multiplying width and height through repeatedly lets rounding drift
      // them apart, and a viewport whose aspect no longer matches the map
      // stretches every layer drawn in it.
      let viewport = baseViewport(BASE);
      for (const factor of [2, 2, 2, 0.5, 3, 0.25, 5]) {
        viewport = zoomViewport(viewport, factor, { x: 400, y: 120 }, BASE);
        expect(viewport.width / viewport.height).toBeCloseTo(BASE.width / BASE.height, 9);
      }
    });
  });

  describe("panning", () => {
    it("moves the viewport", () => {
      const zoomed = zoomViewport(baseViewport(BASE), 2, { x: 320, y: 200 }, BASE);
      const panned = panViewport(zoomed, 40, 20, BASE);
      expect(panned.x).toBe(zoomed.x + 40);
      expect(panned.y).toBe(zoomed.y + 20);
    });

    it("stops at the edge rather than losing the world", () => {
      const zoomed = zoomViewport(baseViewport(BASE), 2, { x: 320, y: 200 }, BASE);
      const panned = panViewport(zoomed, 10_000, 10_000, BASE);
      expect(panned.x).toBe(BASE.width - panned.width);
      expect(panned.y).toBe(BASE.height - panned.height);
      const back = panViewport(zoomed, -10_000, -10_000, BASE);
      expect(back.x).toBe(0);
      expect(back.y).toBe(0);
    });

    it("cannot pan at all when the whole map is showing", () => {
      const viewport = baseViewport(BASE);
      expect(panViewport(viewport, 200, 200, BASE)).toEqual(viewport);
    });
  });

  describe("recentring", () => {
    it("puts the point in the middle without changing the zoom", () => {
      const zoomed = zoomViewport(baseViewport(BASE), 2, { x: 320, y: 200 }, BASE);
      const centred = centreViewportOn(zoomed, { x: 200, y: 150 }, BASE);
      expect(zoomLevel(centred, BASE)).toBeCloseTo(zoomLevel(zoomed, BASE), 9);
      expect(centred.x + centred.width / 2).toBeCloseTo(200, 6);
      expect(centred.y + centred.height / 2).toBeCloseTo(150, 6);
    });

    it("still clamps, so recentring near a corner stays on the map", () => {
      const zoomed = zoomViewport(baseViewport(BASE), 2, { x: 320, y: 200 }, BASE);
      const centred = centreViewportOn(zoomed, { x: 0, y: 0 }, BASE);
      expect(centred.x).toBe(0);
      expect(centred.y).toBe(0);
    });
  });

  describe("turning a click into a place", () => {
    it("accounts for the letterbox when the element and viewport differ in aspect", () => {
      // preserveAspectRatio="xMidYMid meet" letterboxes the drawing. Assuming
      // the offset is zero is what makes clicks land degrees from where the
      // reader pressed, worse towards the edges.
      const viewport = baseViewport(BASE); // 640x400, aspect 1.6
      const element = { width: 800, height: 800 }; // square: bars top and bottom
      // The centre of a square element is the centre of the map either way.
      expect(elementPointToMap({ x: 400, y: 400 }, element, viewport)).toEqual({
        x: 320,
        y: 200,
      });
      // Scale is 800/640 = 1.25; drawn height 500; offset (800-500)/2 = 150.
      const topLeft = elementPointToMap({ x: 0, y: 150 }, element, viewport);
      expect(topLeft.x).toBeCloseTo(0, 6);
      expect(topLeft.y).toBeCloseTo(0, 6);
    });

    it("round-trips a point through a zoomed viewport", () => {
      const viewport = zoomViewport(baseViewport(BASE), 2, { x: 500, y: 300 }, BASE);
      const element = { width: 640, height: 400 };
      const scale = Math.min(element.width / viewport.width, element.height / viewport.height);
      // Pick a map point, project it into the element, and read it back.
      const mapPoint = { x: viewport.x + 30, y: viewport.y + 40 };
      const elementPoint = {
        x: (mapPoint.x - viewport.x) * scale + (element.width - viewport.width * scale) / 2,
        y: (mapPoint.y - viewport.y) * scale + (element.height - viewport.height * scale) / 2,
      };
      const round = elementPointToMap(elementPoint, element, viewport);
      expect(round.x).toBeCloseTo(mapPoint.x, 6);
      expect(round.y).toBeCloseTo(mapPoint.y, 6);
    });
  });

  describe("ornaments", () => {
    it("shrink exactly as fast as the viewBox magnifies, so a pin stays a pin", () => {
      expect(ornamentScale(baseViewport(BASE), BASE)).toBe(1);
      const zoomed = zoomViewport(baseViewport(BASE), 2, { x: 320, y: 200 }, BASE);
      expect(ornamentScale(zoomed, BASE)).toBeCloseTo(0.5, 6);
    });
  });

  describe("clamping directly", () => {
    it("never returns a viewport larger than the map", () => {
      const clamped = clampViewport({ x: -50, y: -50, width: 10_000, height: 10_000 }, BASE);
      expect(clamped).toEqual({ x: 0, y: 0, width: 640, height: 400 });
    });
  });
});
