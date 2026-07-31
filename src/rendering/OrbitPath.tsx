import { useEffect, useMemo, useRef } from "react";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { propagateKeplerian } from "../physics/kepler";
import type { SatelliteModel } from "../lib/scenario";
import type { SelectedOrbitFrame } from "./selectedOrbitFrame";
import { readScenePlaybackTimeMs } from "./sceneMotion";
import { samplePropagatedOrbitPath } from "./orbitPathSampling";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Line as ThreeLine,
  ShaderMaterial,
} from "three";

interface OrbitPathProps {
  satellite: SatelliteModel;
  simulationTime: string;
  quality: "low" | "medium" | "high";
  priority?: boolean;
  selected?: boolean;
  selectedOrbitFrame?: SelectedOrbitFrame | null;
  orbitAwareFraming?: boolean;
  representative?: "plane" | "shell" | "focus-plane" | "focus-shell";
  expressive?: boolean;
  visible?: boolean;
}

const FUTURE_PATH_COLOR = new Color("#e5fbff");
const EXPRESSIVE_PATH_REFRESH_SECONDS = 1 / 18;
const EXPRESSIVE_PATH_VERTEX_SHADER = `
  attribute vec3 pathColor;
  attribute float pathAlpha;
  varying vec3 vPathColor;
  varying float vPathAlpha;

  void main() {
    vPathColor = pathColor;
    vPathAlpha = pathAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const EXPRESSIVE_PATH_FRAGMENT_SHADER = `
  varying vec3 vPathColor;
  varying float vPathAlpha;

  void main() {
    gl_FragColor = vec4(vPathColor, vPathAlpha);
  }
`;

function sampleCountForOrbit(
  quality: OrbitPathProps["quality"],
  satellite: SatelliteModel,
  priority: boolean,
): number {
  const base =
    quality === "low"
      ? 220
      : quality === "medium"
        ? 380
        : 640;
  const eccentricityBoost = 1 + Math.min(2.8, satellite.keplerian.eccentricity * 3.4);
  const transferBoost =
    satellite.keplerian.semiMajorAxisKm > EARTH_RADIUS_KM * 12
      ? 1.7
      : satellite.keplerian.semiMajorAxisKm > EARTH_RADIUS_KM * 4
        ? 1.24
        : 1;
  const priorityBoost = priority ? 1.18 : 1;
  const cap = priority ? 2600 : 1600;

  return Math.min(cap, Math.round(base * eccentricityBoost * transferBoost * priorityBoost));
}

export function OrbitPath({
  satellite,
  simulationTime,
  quality,
  priority = false,
  selected = false,
  selectedOrbitFrame,
  orbitAwareFraming = false,
  representative,
  expressive = false,
  visible,
}: OrbitPathProps) {
  const points = useMemo(() => {
    if (
      !satellite.visualization.visible ||
      !(visible ?? satellite.visualization.showTrail)
    ) {
      return [];
    }

    const count = sampleCountForOrbit(quality, satellite, priority);

    try {
      return samplePropagatedOrbitPath(satellite, new Date(simulationTime), count);
    } catch {
      return [];
    }
  }, [priority, quality, satellite, simulationTime, visible]);

  const expressivePath = useMemo(() => {
    if (!expressive || points.length < 2) return null;

    const geometry = new BufferGeometry().setFromPoints(points);
    const colors = new Float32Array(points.length * 3);
    const alpha = new Float32Array(points.length);
    const colorAttribute = new Float32BufferAttribute(colors, 3);
    const alphaAttribute = new Float32BufferAttribute(alpha, 1);
    colorAttribute.setUsage(DynamicDrawUsage);
    alphaAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute("pathColor", colorAttribute);
    geometry.setAttribute("pathAlpha", alphaAttribute);

    const material = new ShaderMaterial({
      vertexShader: EXPRESSIVE_PATH_VERTEX_SHADER,
      fragmentShader: EXPRESSIVE_PATH_FRAGMENT_SHADER,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    const line = new ThreeLine(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 3;

    return { alpha, alphaAttribute, colors, colorAttribute, geometry, line, material };
  }, [expressive, points]);
  const pastPathColor = useMemo(
    () => new Color(satellite.visualization.color),
    [satellite.visualization.color],
  );
  const expressiveRefreshElapsedRef = useRef(0);
  useFrame((_, delta) => {
    if (!expressivePath) return;

    expressiveRefreshElapsedRef.current += delta;
    if (expressiveRefreshElapsedRef.current < EXPRESSIVE_PATH_REFRESH_SECONDS) {
      return;
    }
    expressiveRefreshElapsedRef.current = 0;

    let currentAnomalyDeg = satellite.keplerian.trueAnomalyDeg;
    const expressiveEmphasis = selected ? 1.08 : 0.42;

    try {
      currentAnomalyDeg = propagateKeplerian(
        satellite.keplerian,
        new Date(readScenePlaybackTimeMs()),
      ).trueAnomalyDeg;
    } catch {
      // Keep the last valid element-based position when current propagation is unavailable.
    }

    const lastPointIndex = points.length - 1;
    for (let index = 0; index <= lastPointIndex; index += 1) {
      const anomalyDeg =
        (satellite.keplerian.trueAnomalyDeg + (index / lastPointIndex) * 360) % 360;
      const forwardDistanceDeg =
        (anomalyDeg - currentAnomalyDeg + 360) % 360;
      const backwardDistanceDeg =
        (currentAnomalyDeg - anomalyDeg + 360) % 360;
      const future = forwardDistanceDeg > 0 && forwardDistanceDeg <= 180;
      const brightness = future
        ? 0.5 + Math.exp(-forwardDistanceDeg / 92) * 0.46
        : Math.exp(-backwardDistanceDeg / 48);
      const color = future ? FUTURE_PATH_COLOR : pastPathColor;
      expressivePath.colors[index * 3] = color.r;
      expressivePath.colors[index * 3 + 1] = color.g;
      expressivePath.colors[index * 3 + 2] = color.b;
      const futureDash = Math.floor(forwardDistanceDeg / 10) % 2 === 0 ? 1 : 0.08;
      expressivePath.alpha[index] = future
        ? Math.min(1, brightness * 1.18 * expressiveEmphasis) * futureDash
        : (0.04 + brightness * 0.92) * expressiveEmphasis;
    }
    expressivePath.colorAttribute.needsUpdate = true;
    expressivePath.alphaAttribute.needsUpdate = true;
  });

  useEffect(
    () => () => {
      expressivePath?.geometry.dispose();
      expressivePath?.material.dispose();
    },
    [expressivePath],
  );

  if (points.length < 2) {
    return null;
  }

  if (expressive) {
    return (
      <>
        <Line
          points={points}
          color={satellite.visualization.color}
          lineWidth={selected ? 3.8 : 2.2}
          transparent
          opacity={selected ? 0.08 : 0.035}
          depthTest
          depthWrite={false}
          toneMapped={false}
          renderOrder={2}
        />
        {expressivePath && <primitive object={expressivePath.line} />}
      </>
    );
  }

  const selectedLineWidth =
    orbitAwareFraming && selectedOrbitFrame
      ? selectedOrbitFrame.selectedOrbitLineWidth
      : 1.8;
  const lineWidth = representative === "focus-shell"
    ? 2.1
    : representative === "focus-plane"
      ? 0.62
      : representative === "shell"
    ? 1.7
    : representative === "plane"
      ? 0.46
    : orbitAwareFraming
      ? selected
      ? selectedLineWidth
      : 0.58
      : priority
        ? 1.8
        : 1.05;
  const opacity = representative === "focus-shell"
    ? 0.42
    : representative === "focus-plane"
      ? 0.3
      : representative === "shell"
    ? 0.2
    : representative === "plane"
      ? 0.16
    : orbitAwareFraming
      ? selected
        ? 0.92
        : 0.14
      : priority
        ? 0.92
        : 0.46;

  return (
    <>
      {orbitAwareFraming && selected && (
        <Line
          points={points}
          color={satellite.visualization.color}
          lineWidth={selectedLineWidth * 1.7}
          transparent
          opacity={0.09}
          depthTest
          depthWrite={false}
        />
      )}
      <Line
        points={points}
        color={satellite.visualization.color}
        lineWidth={lineWidth}
        transparent
        opacity={opacity}
        depthTest
        depthWrite={false}
      />
    </>
  );
}
