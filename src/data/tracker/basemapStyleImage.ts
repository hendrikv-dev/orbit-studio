export interface TrackerStyleImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const CITY_CIRCLE_ID = "circle-11";
const CITY_CIRCLE_SIZE = 11;

/**
 * Resolve the one image the current OpenFreeMap dark style references but its
 * published sprite manifest does not contain.
 *
 * Unknown ids deliberately return null. MapLibre must continue to report
 * those as missing rather than Tracker hiding a changed or broken style
 * contract behind transparent placeholders.
 */
export function trackerBasemapFallbackImage(id: string): TrackerStyleImage | null {
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
