import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import type { QualityLevel } from "../lib/scenario";
import {
  starCatalogPointsForQuality,
  starSkyRadiusForCamera,
} from "./StarField";

interface StarOcclusionDiagnosticsProjectorProps {
  enabled: boolean;
  quality: QualityLevel;
  onDiagnosticsChange: (diagnostics: StarOcclusionDiagnosticsState | null) => void;
}

interface ProjectedMarker {
  x: number;
  y: number;
  radius: number;
}

export interface StarOcclusionDiagnosticsState {
  earthDepthCircle: {
    cx: number;
    cy: number;
    radius: number;
  };
  visibleStarCount: number;
  occludedStarCount: number;
  occludedMarkers: ProjectedMarker[];
}

interface StarOcclusionDiagnosticsOverlayProps {
  diagnostics: StarOcclusionDiagnosticsState | null;
}

function isStarDirectionOccludedByEarth(cameraPosition: Vector3, direction: Vector3): boolean {
  const radius = EARTH_RADIUS_KM * 1.002;
  const b = 2 * cameraPosition.dot(direction);
  const c = cameraPosition.lengthSq() - radius * radius;
  const discriminant = b * b - 4 * c;

  if (discriminant < 0) {
    return false;
  }

  const root = Math.sqrt(discriminant);
  const nearIntersection = (-b - root) / 2;
  const farIntersection = (-b + root) / 2;
  return nearIntersection > 0 || farIntersection > 0;
}

function projectToScreen(position: Vector3, camera: any, width: number, height: number) {
  const ndc = position.clone().project(camera);

  if (ndc.z < -1 || ndc.z > 1 || ndc.x < -1.1 || ndc.x > 1.1 || ndc.y < -1.1 || ndc.y > 1.1) {
    return null;
  }

  return {
    x: (ndc.x * 0.5 + 0.5) * width,
    y: (-ndc.y * 0.5 + 0.5) * height,
  };
}

function diagnosticsSignature(diagnostics: StarOcclusionDiagnosticsState): string {
  return [
    Math.round(diagnostics.earthDepthCircle.cx),
    Math.round(diagnostics.earthDepthCircle.cy),
    Math.round(diagnostics.earthDepthCircle.radius),
    diagnostics.visibleStarCount,
    diagnostics.occludedStarCount,
    diagnostics.occludedMarkers.length,
  ].join(":");
}

export function StarOcclusionDiagnosticsProjector({
  enabled,
  quality,
  onDiagnosticsChange,
}: StarOcclusionDiagnosticsProjectorProps) {
  const { camera, size } = useThree();
  const stars = useMemo(() => starCatalogPointsForQuality(quality), [quality]);
  const previousSignatureRef = useRef("");

  useEffect(() => {
    if (!enabled) {
      previousSignatureRef.current = "";
      onDiagnosticsChange(null);
    }
  }, [enabled, onDiagnosticsChange]);

  useFrame(() => {
    if (!enabled) {
      return;
    }

    const cameraPosition = new Vector3();
    camera.getWorldPosition(cameraPosition);
    const skyRadiusKm = starSkyRadiusForCamera(camera);

    const center = projectToScreen(new Vector3(0, 0, 0), camera, size.width, size.height);

    if (!center) {
      return;
    }

    const cameraRight = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const cameraUp = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const rightEdge = projectToScreen(
      cameraRight.clone().multiplyScalar(EARTH_RADIUS_KM).add(new Vector3(0, 0, 0)),
      camera,
      size.width,
      size.height,
    );
    const upEdge = projectToScreen(
      cameraUp.clone().multiplyScalar(EARTH_RADIUS_KM).add(new Vector3(0, 0, 0)),
      camera,
      size.width,
      size.height,
    );
    const earthDepthRadius = Math.max(
      rightEdge ? Math.abs(rightEdge.x - center.x) : 0,
      upEdge ? Math.abs(upEdge.y - center.y) : 0,
      12,
    );
    let visibleStarCount = 0;
    let occludedStarCount = 0;
    const occludedMarkers: ProjectedMarker[] = [];

    stars.forEach((star) => {
      const starPosition = star.direction.clone().multiplyScalar(skyRadiusKm);
      const cameraToStarDirection = starPosition.clone().sub(cameraPosition).normalize();
      const screenPosition = projectToScreen(starPosition, camera, size.width, size.height);

      if (!screenPosition) {
        return;
      }

      if (isStarDirectionOccludedByEarth(cameraPosition, cameraToStarDirection)) {
        occludedStarCount += 1;

        if (occludedMarkers.length < 120) {
          occludedMarkers.push({
            ...screenPosition,
            radius: Math.max(1, Math.min(2.8, 2.8 - star.magnitude * 0.22)),
          });
        }

        return;
      }

      visibleStarCount += 1;
    });

    const diagnostics: StarOcclusionDiagnosticsState = {
      earthDepthCircle: {
        cx: center.x,
        cy: center.y,
        radius: earthDepthRadius,
      },
      visibleStarCount,
      occludedStarCount,
      occludedMarkers,
    };
    const signature = diagnosticsSignature(diagnostics);

    if (signature !== previousSignatureRef.current) {
      previousSignatureRef.current = signature;
      onDiagnosticsChange(diagnostics);
    }
  });

  return null;
}

export function StarOcclusionDiagnosticsOverlay({
  diagnostics,
}: StarOcclusionDiagnosticsOverlayProps) {
  if (!diagnostics) {
    return null;
  }

  return (
    <div className="star-occlusion-diagnostics" aria-hidden>
      <svg className="star-occlusion-diagnostics-svg">
        <circle
          className="diagnostic-earth-depth"
          cx={diagnostics.earthDepthCircle.cx}
          cy={diagnostics.earthDepthCircle.cy}
          r={diagnostics.earthDepthCircle.radius}
        />
        {diagnostics.occludedMarkers.map((marker, index) => (
          <circle
            className="diagnostic-occluded-star"
            cx={marker.x}
            cy={marker.y}
            key={`${Math.round(marker.x)}-${Math.round(marker.y)}-${index}`}
            r={marker.radius}
          />
        ))}
      </svg>
      <div className="star-occlusion-diagnostics-panel">
        <strong>Star Occlusion Diagnostics</strong>
        <span>Earth depth buffer: active</span>
        <span>Star pass: origin-centered EQJ inertial layer</span>
        <span>Occluded stars: {diagnostics.occludedStarCount}</span>
        <span>Visible star pass: {diagnostics.visibleStarCount}</span>
      </div>
    </div>
  );
}
