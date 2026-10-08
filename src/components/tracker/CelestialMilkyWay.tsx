import { useEffect, useMemo, useRef, useState } from "react";

import {
  catalogDirectionForObserver,
  projectEnuDirection,
  type CameraProjectionModel,
  type DevicePose,
  type EnuDirection,
} from "../../astronomy/topocentricSky";

export const MILKY_WAY_TEXTURE_URL = "/sky/nasa-svs-milkyway-2020-celestial.jpg";
const SAMPLE_COLUMNS = 72;
const SAMPLE_ROWS = 36;

export interface MilkyWayCelestialCoordinate {
  raHours: number;
  decDeg: number;
}

interface RasterSample extends MilkyWayCelestialCoordinate {
  corners: readonly MilkyWayCelestialCoordinate[];
  sourceCorners: readonly { x: number; y: number }[];
}

interface DirectionSample extends RasterSample {
  direction: EnuDirection;
  cornerDirections: readonly EnuDirection[];
}

function coordinateAtPlatePoint(x: number, y: number, width: number, height: number) {
  const rightAscensionDeg = ((180 - (x / width) * 360) % 360 + 360) % 360;
  return { raHours: rightAscensionDeg / 15, decDeg: 90 - (y / height) * 180 };
}

/** NASA's plate carrée is centred on 0h RA, with RA increasing to the left. */
export function milkyWayCelestialCoordinate(
  x: number,
  y: number,
  width: number,
  height: number,
): MilkyWayCelestialCoordinate {
  return coordinateAtPlatePoint(x + 0.5, y + 0.5, width, height);
}

function samplesFromImage(image: HTMLImageElement): RasterSample[] {
  const samples: RasterSample[] = [];
  for (let y = 0; y < SAMPLE_ROWS; y += 1) {
    for (let x = 0; x < SAMPLE_COLUMNS; x += 1) {
      samples.push({
        ...milkyWayCelestialCoordinate(x, y, SAMPLE_COLUMNS, SAMPLE_ROWS),
        corners: [
          coordinateAtPlatePoint(x, y, SAMPLE_COLUMNS, SAMPLE_ROWS),
          coordinateAtPlatePoint(x + 1, y, SAMPLE_COLUMNS, SAMPLE_ROWS),
          coordinateAtPlatePoint(x + 1, y + 1, SAMPLE_COLUMNS, SAMPLE_ROWS),
          coordinateAtPlatePoint(x, y + 1, SAMPLE_COLUMNS, SAMPLE_ROWS),
        ],
        sourceCorners: [
          { x: x * image.naturalWidth / SAMPLE_COLUMNS, y: y * image.naturalHeight / SAMPLE_ROWS },
          { x: (x + 1) * image.naturalWidth / SAMPLE_COLUMNS, y: y * image.naturalHeight / SAMPLE_ROWS },
          { x: (x + 1) * image.naturalWidth / SAMPLE_COLUMNS, y: (y + 1) * image.naturalHeight / SAMPLE_ROWS },
          { x: x * image.naturalWidth / SAMPLE_COLUMNS, y: (y + 1) * image.naturalHeight / SAMPLE_ROWS },
        ],
      });
    }
  }
  return samples;
}

function drawImageTriangle(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  source: readonly { x: number; y: number }[],
  destination: readonly { x: number; y: number }[],
) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 1e-8) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  context.save();
  context.beginPath();
  context.moveTo(d0.x, d0.y);
  context.lineTo(d1.x, d1.y);
  context.lineTo(d2.x, d2.y);
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, e, f);
  context.drawImage(image, 0, 0);
  context.restore();
}

interface Props {
  observer: { latitudeDeg: number; longitudeDeg: number };
  at: Date;
  pose: DevicePose;
  projection: CameraProjectionModel;
  visible: boolean;
}

/**
 * A projected surface-brightness layer, never a screen-space wallpaper.
 * The NASA raster intentionally excludes the bright foreground catalogue;
 * Tracker's BSC5P layer remains the sole authority for individual stars.
 */
export function CelestialMilkyWay({ observer, at, pose, projection, visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [samples, setSamples] = useState<RasterSample[]>([]);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setSamples(samplesFromImage(image));
    };
    image.src = MILKY_WAY_TEXTURE_URL;
    return () => { cancelled = true; };
  }, []);

  const directions = useMemo<DirectionSample[]>(() => samples.map((sample) => ({
    ...sample,
    direction: catalogDirectionForObserver(sample, observer, at).enu,
    cornerDirections: sample.corners.map((corner) => catalogDirectionForObserver(corner, observer, at).enu),
  })), [at, observer.latitudeDeg, observer.longitudeDeg, samples]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const image = imageRef.current;
    if (!context || !image) return;
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const density = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * density) || canvas.height !== Math.round(height * density)) {
      canvas.width = Math.round(width * density);
      canvas.height = Math.round(height * density);
    }
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!visible || directions.length === 0) {
      canvas.dataset.drawnCells = "0";
      canvas.dataset.renderMs = "0";
      return;
    }

    const startedAt = performance.now();
    let drawnCells = 0;
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.7;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    for (const sample of directions) {
      const corners = sample.cornerDirections.map((direction) => projectEnuDirection(direction, pose, projection));
      if (corners.some((corner) => !corner.inFront) || corners.every((corner) => corner.xPercent < -12 || corner.xPercent > 112 || corner.yPercent < -12 || corner.yPercent > 112)) continue;
      const destination = corners.map((corner) => ({ x: corner.xPercent * width / 100, y: corner.yPercent * height / 100 }));
      drawImageTriangle(context, image, [sample.sourceCorners[0], sample.sourceCorners[1], sample.sourceCorners[2]], [destination[0], destination[1], destination[2]]);
      drawImageTriangle(context, image, [sample.sourceCorners[0], sample.sourceCorners[2], sample.sourceCorners[3]], [destination[0], destination[2], destination[3]]);
      drawnCells += 1;
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    canvas.dataset.drawnCells = String(drawnCells);
    canvas.dataset.renderMs = (performance.now() - startedAt).toFixed(2);
  }, [directions, pose, projection, visible]);

  return (
    <canvas
      ref={canvasRef}
      className="tk-finder-milky-way-texture"
      data-celestial-source="nasa-svs-deep-star-maps-2020"
      data-sample-count={directions.length}
      aria-hidden
    />
  );
}
