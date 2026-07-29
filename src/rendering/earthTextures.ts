import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from "three";
import naturalEarthLand from "../data/natural-earth/ne_110m_land.geojson.json";
import { latLonToThreeVector } from "./coordinates";

type GeoPosition = [number, number, ...number[]];
type LonLatPoint = [number, number];
type PolygonCoordinates = GeoPosition[][];
type MultiPolygonCoordinates = PolygonCoordinates[];

interface NaturalEarthLandFeature {
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: PolygonCoordinates | MultiPolygonCoordinates;
  } | null;
}

interface NaturalEarthLandCollection {
  features: NaturalEarthLandFeature[];
}

export const VECTOR_EARTH_OCEAN_COLOR = "#101b24";
export const VECTOR_EARTH_LAND_COLOR = "#223845";
export const VECTOR_EARTH_COASTLINE_COLOR = "#7f9eab";

const MAX_COASTLINE_SEGMENT_SPAN_RAD = 0.032;
const LAND_TRIANGLE_SUBDIVISION_DEPTH = 3;
const DEGREES_TO_RADIANS = Math.PI / 180;

function unwrappedLongitude(longitudeDeg: number, previousLongitudeDeg: number): number {
  let nextLongitudeDeg = longitudeDeg;

  while (nextLongitudeDeg - previousLongitudeDeg > 180) {
    nextLongitudeDeg -= 360;
  }

  while (nextLongitudeDeg - previousLongitudeDeg < -180) {
    nextLongitudeDeg += 360;
  }

  return nextLongitudeDeg;
}

function wrappedLongitudeDelta(leftLongitudeDeg: number, rightLongitudeDeg: number): number {
  let delta = leftLongitudeDeg - rightLongitudeDeg;

  while (delta > 180) {
    delta -= 360;
  }

  while (delta < -180) {
    delta += 360;
  }

  return delta;
}

function unwrapRing(ring: GeoPosition[]): LonLatPoint[] {
  const unwrapped: LonLatPoint[] = [];
  let previousLongitudeDeg = ring[0]?.[0] ?? 0;

  ring.forEach(([longitudeDeg, latitudeDeg], index) => {
    const nextLongitudeDeg =
      index === 0 ? longitudeDeg : unwrappedLongitude(longitudeDeg, previousLongitudeDeg);
    previousLongitudeDeg = nextLongitudeDeg;
    unwrapped.push([nextLongitudeDeg, latitudeDeg]);
  });

  return unwrapped;
}

function meanLongitude(ring: LonLatPoint[]): number {
  return ring.reduce((sum, point) => sum + point[0], 0) / Math.max(1, ring.length);
}

function alignRingLongitude(ring: LonLatPoint[], targetLongitudeDeg: number): LonLatPoint[] {
  if (ring.length === 0) return ring;

  const center = meanLongitude(ring);
  let offset = 0;

  while (center + offset - targetLongitudeDeg > 180) {
    offset -= 360;
  }

  while (center + offset - targetLongitudeDeg < -180) {
    offset += 360;
  }

  return offset === 0 ? ring : ring.map(([longitudeDeg, latitudeDeg]) => [
    longitudeDeg + offset,
    latitudeDeg,
  ]);
}

function withoutDuplicateClosure(ring: LonLatPoint[]): LonLatPoint[] {
  if (ring.length < 2) return ring;

  const first = ring[0];
  const last = ring[ring.length - 1];

  if (
    Math.abs(wrappedLongitudeDelta(first[0], last[0])) < 1e-7 &&
    Math.abs(first[1] - last[1]) < 1e-7
  ) {
    return ring.slice(0, -1);
  }

  return ring;
}

function vectorFor(point: LonLatPoint, radiusKm: number): Vector3 {
  return latLonToThreeVector(
    { longitudeDeg: point[0], latitudeDeg: point[1] },
    radiusKm,
  );
}

function surfaceSpanRad(left: LonLatPoint, right: LonLatPoint): number {
  const leftLatitudeRad = left[1] * DEGREES_TO_RADIANS;
  const rightLatitudeRad = right[1] * DEGREES_TO_RADIANS;
  const deltaLatitudeRad = Math.abs(rightLatitudeRad - leftLatitudeRad);
  const deltaLongitudeRad = Math.abs(right[0] - left[0]) * DEGREES_TO_RADIANS;
  const latitudeScale = Math.max(
    0.08,
    Math.cos((leftLatitudeRad + rightLatitudeRad) / 2),
  );

  return Math.hypot(deltaLatitudeRad, deltaLongitudeRad * latitudeScale);
}

function midpoint(left: LonLatPoint, right: LonLatPoint): LonLatPoint {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

function pushTriangle(
  positions: number[],
  a: LonLatPoint,
  b: LonLatPoint,
  c: LonLatPoint,
  radiusKm: number,
): void {
  const aPoint = vectorFor(a, radiusKm);
  const bPoint = vectorFor(b, radiusKm);
  const cPoint = vectorFor(c, radiusKm);

  positions.push(
    aPoint.x,
    aPoint.y,
    aPoint.z,
    bPoint.x,
    bPoint.y,
    bPoint.z,
    cPoint.x,
    cPoint.y,
    cPoint.z,
  );
}

function pushSubdividedTriangle(
  positions: number[],
  a: LonLatPoint,
  b: LonLatPoint,
  c: LonLatPoint,
  radiusKm: number,
  depth = 0,
): void {
  if (depth >= LAND_TRIANGLE_SUBDIVISION_DEPTH) {
    pushTriangle(positions, a, b, c, radiusKm);
    return;
  }

  const ab = midpoint(a, b);
  const bc = midpoint(b, c);
  const ca = midpoint(c, a);

  pushSubdividedTriangle(positions, a, ab, ca, radiusKm, depth + 1);
  pushSubdividedTriangle(positions, ab, b, bc, radiusKm, depth + 1);
  pushSubdividedTriangle(positions, ca, bc, c, radiusKm, depth + 1);
  pushSubdividedTriangle(positions, ab, bc, ca, radiusKm, depth + 1);
}

function polygonRings(polygon: PolygonCoordinates): Vector2[][] {
  const rings = polygon
    .map((ring) => withoutDuplicateClosure(unwrapRing(ring)))
    .filter((ring) => ring.length >= 3);
  const contour = rings[0];

  if (!contour) return [];

  const contourCenter = meanLongitude(contour);

  return [
    contour,
    ...rings.slice(1).map((ring) => alignRingLongitude(ring, contourCenter)),
  ].map((ring) =>
    ring.map(([longitudeDeg, latitudeDeg]) => new Vector2(longitudeDeg, latitudeDeg)),
  );
}

function lonLatFor(vertex: Vector2): LonLatPoint {
  return [vertex.x, vertex.y];
}

function triangleArea(a: Vector2, b: Vector2, c: Vector2): number {
  return Math.abs(
    (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2,
  );
}

function pushPolygonSurface(
  positions: number[],
  polygon: PolygonCoordinates,
  radiusKm: number,
): void {
  const rings = polygonRings(polygon);
  const contour = rings[0];

  if (!contour) return;

  const holes = rings.slice(1);
  const vertices = [...contour, ...holes.flat()];
  const triangles = ShapeUtils.triangulateShape(contour, holes);

  triangles.forEach(([aIndex, bIndex, cIndex]) => {
    const a = vertices[aIndex];
    const b = vertices[bIndex];
    const c = vertices[cIndex];

    if (!a || !b || !c) return;
    if (triangleArea(a, b, c) < 1e-10) return;

    pushSubdividedTriangle(
      positions,
      lonLatFor(a),
      lonLatFor(b),
      lonLatFor(c),
      radiusKm,
    );
  });
}

function pushSubdividedCoastlineSegment(
  positions: number[],
  start: LonLatPoint,
  end: LonLatPoint,
  radiusKm: number,
): void {
  const segmentCount = Math.max(
    1,
    Math.ceil(surfaceSpanRad(start, end) / MAX_COASTLINE_SEGMENT_SPAN_RAD),
  );
  let previous = vectorFor(start, radiusKm);

  for (let index = 1; index <= segmentCount; index += 1) {
    const ratio = index / segmentCount;
    const current = vectorFor(
      [
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ],
      radiusKm,
    );

    positions.push(
      previous.x,
      previous.y,
      previous.z,
      current.x,
      current.y,
      current.z,
    );
    previous = current;
  }
}

function pushPolygonCoastline(
  positions: number[],
  polygon: PolygonCoordinates,
  radiusKm: number,
): void {
  polygon.forEach((rawRing) => {
    const ring = withoutDuplicateClosure(unwrapRing(rawRing));
    if (ring.length < 2) return;

    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const rawNext = ring[(index + 1) % ring.length];
      const next: LonLatPoint =
        index + 1 < ring.length
          ? rawNext
          : [unwrappedLongitude(rawNext[0], current[0]), rawNext[1]];

      pushSubdividedCoastlineSegment(positions, current, next, radiusKm);
    }
  });
}

function forEachPolygon(callback: (polygon: PolygonCoordinates) => void): void {
  const land = naturalEarthLand as unknown as NaturalEarthLandCollection;

  land.features.forEach((feature) => {
    if (!feature.geometry) return;

    if (feature.geometry.type === "Polygon") {
      callback(feature.geometry.coordinates as PolygonCoordinates);
      return;
    }

    (feature.geometry.coordinates as MultiPolygonCoordinates).forEach(callback);
  });
}

export function createVectorEarthLandGeometry(radiusKm: number): BufferGeometry {
  const positions: number[] = [];

  forEachPolygon((polygon) => pushPolygonSurface(positions, polygon, radiusKm));

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();

  return geometry;
}

export function createVectorEarthCoastlineGeometry(radiusKm: number): BufferGeometry {
  const positions: number[] = [];

  forEachPolygon((polygon) => pushPolygonCoastline(positions, polygon, radiusKm));

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();

  return geometry;
}
