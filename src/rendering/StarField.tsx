import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import HYG_BRIGHT_STARS from "../data/stars/hygBrightStars.v41.json";
import type { QualityLevel } from "../lib/scenario";
import { readSceneCelestialState } from "./sceneMotion";

interface HygBrightStarRecord {
  id: number;
  hip: number | null;
  name: string | null;
  raHours: number;
  decDeg: number;
  magnitude: number;
  colorIndexBv: number | null;
  xParsec: number;
  yParsec: number;
  zParsec: number;
  vxParsecPerYear: number;
  vyParsecPerYear: number;
  vzParsecPerYear: number;
  constellation: string | null;
}

const HYG_STARS = HYG_BRIGHT_STARS as HygBrightStarRecord[];

interface StarFieldProps {
  quality: QualityLevel;
  emphasis?: number;
}

const STAR_VERTEX_SHADER = `
  attribute float size;
  attribute vec3 starColor;
  varying vec3 vColor;

  void main() {
    vColor = starColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size;
  }
`;

const STAR_FRAGMENT_SHADER = `
  varying vec3 vColor;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float distanceFromCenter = length(centered);
    float alpha = (1.0 - smoothstep(0.1, 0.5, distanceFromCenter)) * 0.9;

    if (alpha <= 0.01) {
      discard;
    }

    gl_FragColor = vec4(vColor, alpha);
  }
`;

export interface StarRenderPoint {
  id: number;
  hip: number | null;
  name: string | null;
  direction: Vector3;
  magnitude: number;
  constellation: string | null;
}

export const STAR_SKY_MIN_RADIUS_KM = EARTH_RADIUS_KM * 24;
const STAR_SKY_FAR_RATIO = 0.72;

export function magnitudeLimitForQuality(quality: QualityLevel): number {
  if (quality === "low") {
    return 4.4;
  }

  if (quality === "medium") {
    return 4.8;
  }

  return 5.1;
}

export function starSkyRadiusForCameraFar(cameraFarKm: number): number {
  if (!Number.isFinite(cameraFarKm) || cameraFarKm <= 0) {
    return STAR_SKY_MIN_RADIUS_KM;
  }

  return Math.max(STAR_SKY_MIN_RADIUS_KM, cameraFarKm * STAR_SKY_FAR_RATIO);
}

export function starSkyRadiusForCamera(camera: { far?: number }): number {
  return starSkyRadiusForCameraFar(camera.far ?? STAR_SKY_MIN_RADIUS_KM);
}

export function createStarFieldMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

export function starDirectionAtJulianDate(
  star: HygBrightStarRecord,
  julianDateUtc: number,
  target = new Vector3(),
): Vector3 {
  const yearsSinceJ2000 = (julianDateUtc - 2_451_545) / 365.25;
  const x = star.xParsec + star.vxParsecPerYear * yearsSinceJ2000;
  const y = star.yParsec + star.vyParsecPerYear * yearsSinceJ2000;
  const z = star.zParsec + star.vzParsecPerYear * yearsSinceJ2000;
  return target.set(x, z, -y).normalize();
}

export function starCatalogPointsForQuality(
  quality: QualityLevel,
  julianDateUtc = 2_451_545,
): StarRenderPoint[] {
  const magnitudeLimit = magnitudeLimitForQuality(quality);

  return HYG_STARS.filter((star) => star.magnitude <= magnitudeLimit).map((star) => ({
    id: star.id,
    hip: star.hip,
    name: star.name,
    direction: starDirectionAtJulianDate(star, julianDateUtc),
    magnitude: star.magnitude,
    constellation: star.constellation,
  }));
}

function colorFromBv(colorIndexBv: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (colorIndexBv + 0.3) / 1.9));
  const blue: [number, number, number] = [0.68, 0.78, 1];
  const white: [number, number, number] = [1, 0.98, 0.9];
  const amber: [number, number, number] = [1, 0.67, 0.42];

  if (t < 0.5) {
    const amount = t / 0.5;
    return [
      blue[0] + (white[0] - blue[0]) * amount,
      blue[1] + (white[1] - blue[1]) * amount,
      blue[2] + (white[2] - blue[2]) * amount,
    ];
  }

  const amount = (t - 0.5) / 0.5;
  return [
    white[0] + (amber[0] - white[0]) * amount,
    white[1] + (amber[1] - white[1]) * amount,
    white[2] + (amber[2] - white[2]) * amount,
  ];
}

export function StarField({ quality, emphasis = 1 }: StarFieldProps) {
  const pointsRef = useRef<Points | null>(null);
  const frameDirectionRef = useRef(new Vector3());
  const { camera } = useThree();
  const stars = useMemo(
    () => HYG_STARS.filter((star) => star.magnitude <= magnitudeLimitForQuality(quality)),
    [quality],
  );
  const [geometry, material] = useMemo(() => {
    const positions = new Float32Array(stars.length * 3);
    const colors = new Float32Array(stars.length * 3);
    const sizes = new Float32Array(stars.length);

    stars.forEach((star, index) => {
      const magnitude = star.magnitude;
      const visualIntensity = Math.pow(2.512, -magnitude);
      const normalizedIntensity = Math.max(0.28, Math.min(1.45, visualIntensity * 2.2 * emphasis));
      const color = colorFromBv(star.colorIndexBv ?? 0.65);
      const direction = starDirectionAtJulianDate(star, 2_451_545);

      positions[index * 3] = direction.x;
      positions[index * 3 + 1] = direction.y;
      positions[index * 3 + 2] = direction.z;

      colors[index * 3] = color[0] * normalizedIntensity;
      colors[index * 3 + 1] = color[1] * normalizedIntensity;
      colors[index * 3 + 2] = color[2] * normalizedIntensity;
      sizes[index] = Math.max(1.45, Math.min(4.4, (3.1 - magnitude * 0.18) * emphasis));
    });

    const nextGeometry = new BufferGeometry();
    nextGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    nextGeometry.setAttribute("starColor", new BufferAttribute(colors, 3));
    nextGeometry.setAttribute("size", new BufferAttribute(sizes, 1));

    const nextMaterial = createStarFieldMaterial();

    return [nextGeometry, nextMaterial];
  }, [emphasis, stars]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    if (!pointsRef.current) {
      return;
    }

    const skyRadiusKm = starSkyRadiusForCamera(camera);
    const julianDateUtc = readSceneCelestialState().time.julianDateUtc;
    const positions = geometry.getAttribute("position") as BufferAttribute;
    const direction = frameDirectionRef.current;
    stars.forEach((star, index) => {
      starDirectionAtJulianDate(star, julianDateUtc, direction);
      positions.setXYZ(index, direction.x, direction.y, direction.z);
    });
    positions.needsUpdate = true;
    pointsRef.current.position.set(0, 0, 0);
    pointsRef.current.scale.setScalar(skyRadiusKm);
  });

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-1000}
      raycast={() => undefined}
      userData={{ layer: "sky", catalog: "HYG Database v4.1", epoch: "J2000.0" }}
    />
  );
}
