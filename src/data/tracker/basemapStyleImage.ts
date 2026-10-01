export interface TrackerStyleImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const CITY_CIRCLE_ID = "circle-11";
const CITY_CIRCLE_SIZE = 11;
const WOOD_PATTERN_ID = "wood-pattern";
const WOOD_PATTERN_SIZE = 8;

/**
 * Resolve the two images the current OpenFreeMap dark style references but its
 * published sprite manifest does not contain.
 *
 * Unknown ids deliberately return null. MapLibre must continue to report
 * those as missing rather than Tracker hiding a changed or broken style
 * contract behind transparent placeholders.
 */
export function trackerBasemapFallbackImage(id: string): TrackerStyleImage | null {
  if (id === WOOD_PATTERN_ID) {
    const data = new Uint8Array(WOOD_PATTERN_SIZE * WOOD_PATTERN_SIZE * 4);
    for (let y = 0; y < WOOD_PATTERN_SIZE; y += 1) {
      for (let x = 0; x < WOOD_PATTERN_SIZE; x += 1) {
        const offset = (y * WOOD_PATTERN_SIZE + x) * 4;
        const grain = (x + y * 3) % 7 === 0 || (x * 2 + y) % 11 === 0;
        data[offset] = grain ? 34 : 25;
        data[offset + 1] = grain ? 50 : 39;
        data[offset + 2] = grain ? 44 : 36;
        data[offset + 3] = 255;
      }
    }
    return { width: WOOD_PATTERN_SIZE, height: WOOD_PATTERN_SIZE, data };
  }

  if (id !== CITY_CIRCLE_ID) return null;

  const data = new Uint8Array(CITY_CIRCLE_SIZE * CITY_CIRCLE_SIZE * 4);
  const centre = (CITY_CIRCLE_SIZE - 1) / 2;
  for (let y = 0; y < CITY_CIRCLE_SIZE; y += 1) {
    for (let x = 0; x < CITY_CIRCLE_SIZE; x += 1) {
      const distance = Math.hypot(x - centre, y - centre);
      const alpha = Math.max(0, Math.min(1, centre - distance + 0.75));
      const offset = (y * CITY_CIRCLE_SIZE + x) * 4;
      data[offset] = 160;
      data[offset + 1] = 160;
      data[offset + 2] = 168;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }

  return { width: CITY_CIRCLE_SIZE, height: CITY_CIRCLE_SIZE, data };
}
