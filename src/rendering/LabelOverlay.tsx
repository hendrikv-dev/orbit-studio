import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3 } from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";

export type LabelKind = "satellite" | "station" | "region" | "validation";

export interface LabelSource {
  id: string;
  kind: LabelKind;
  text: string;
  detail?: string;
  position: Vector3;
  getPosition?: () => Vector3;
  priority: number;
  selected?: boolean;
  hovered?: boolean;
}

export interface ScreenLabel {
  id: string;
  kind: LabelKind;
  text: string;
  detail?: string;
  x: number;
  y: number;
  priority: number;
  selected: boolean;
  hovered: boolean;
}

interface LabelProjectorProps {
  sources: LabelSource[];
  onLabelsChange: (labels: ScreenLabel[]) => void;
}

interface LabelOverlayProps {
  labels: ScreenLabel[];
  coverageLegendVisible: boolean;
}

function isOccludedByEarth(cameraPosition: Vector3, targetPosition: Vector3): boolean {
  const toTarget = targetPosition.clone().sub(cameraPosition);
  const targetDistance = toTarget.length();

  if (targetDistance <= 0) {
    return true;
  }

  const direction = toTarget.clone().normalize();
  const radius = EARTH_RADIUS_KM * 1.012;
  const b = 2 * cameraPosition.dot(direction);
  const c = cameraPosition.lengthSq() - radius * radius;
  const discriminant = b * b - 4 * c;

  if (discriminant < 0) {
    return false;
  }

  const t = (-b - Math.sqrt(discriminant)) / 2;
  return t > 0 && t < targetDistance - 96;
}

function approximateBox(label: ScreenLabel): { left: number; right: number; top: number; bottom: number } {
  const width =
    label.kind === "region" || label.kind === "validation"
      ? Math.max(112, label.text.length * 7.2)
      : Math.max(104, label.text.length * 6.6);
  const height = label.detail ? 38 : 28;

  return {
    left: label.x - width / 2,
    right: label.x + width / 2,
    top: label.y - height - 10,
    bottom: label.y + 4,
  };
}

function overlaps(
  first: { left: number; right: number; top: number; bottom: number },
  second: { left: number; right: number; top: number; bottom: number },
): boolean {
  return !(
    first.right < second.left ||
    first.left > second.right ||
    first.bottom < second.top ||
    first.top > second.bottom
  );
}

function pruneOverlaps(labels: ScreenLabel[]): ScreenLabel[] {
  const accepted: ScreenLabel[] = [];
  const boxes: ReturnType<typeof approximateBox>[] = [];

  labels
    .sort((a, b) => b.priority - a.priority)
    .forEach((label) => {
      const box = approximateBox(label);
      const collides = boxes.some((candidate) => overlaps(box, candidate));

      if (!collides || label.priority >= 90) {
        accepted.push(label);
        boxes.push(box);
      }
    });

  return accepted.sort((a, b) => a.priority - b.priority);
}

function labelsSignature(labels: ScreenLabel[]): string {
  return labels
    .map((label) =>
      [
        label.id,
        Math.round(label.x),
        Math.round(label.y),
        label.priority,
        label.selected ? 1 : 0,
        label.hovered ? 1 : 0,
      ].join(":"),
    )
    .join("|");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function LabelProjector({ sources, onLabelsChange }: LabelProjectorProps) {
  const { camera, size } = useThree();
  const previousSignatureRef = useRef("");

  useFrame(() => {
    const cameraPosition = new Vector3();
    camera.getWorldPosition(cameraPosition);

    const projected = sources
      .map((source): ScreenLabel | null => {
        const sourcePosition = source.getPosition?.() ?? source.position;

        if (isOccludedByEarth(cameraPosition, sourcePosition)) {
          return null;
        }

        const ndc = sourcePosition.clone().project(camera);

        if (
          ndc.z < -1 ||
          ndc.z > 1 ||
          ndc.x < -1 ||
          ndc.x > 1 ||
          ndc.y < -1 ||
          ndc.y > 1
        ) {
          return null;
        }

        return {
          id: source.id,
          kind: source.kind,
          text: source.text,
          detail: source.detail,
          x: clamp((ndc.x * 0.5 + 0.5) * size.width, 72, size.width - 72),
          y: clamp((-ndc.y * 0.5 + 0.5) * size.height, 42, size.height - 18),
          priority: source.priority,
          selected: Boolean(source.selected),
          hovered: Boolean(source.hovered),
        };
      })
      .filter((label): label is ScreenLabel => Boolean(label));
    const visibleLabels = pruneOverlaps(projected);
    const signature = labelsSignature(visibleLabels);

    if (signature !== previousSignatureRef.current) {
      previousSignatureRef.current = signature;
      onLabelsChange(visibleLabels);
    }
  });

  return null;
}

export function LabelOverlay({ labels, coverageLegendVisible }: LabelOverlayProps) {
  return (
    <div className="label-overlay" aria-hidden>
      {coverageLegendVisible && (
        <div className="coverage-legend-badge">
          <strong>Coverage layer</strong>
          <span>Analysis overlay</span>
        </div>
      )}
      {labels.map((label) => (
        <div
          className={`screen-label ${label.kind}-label ${label.selected ? "priority" : ""} ${
            label.hovered ? "hovered" : ""
          }`}
          key={label.id}
          style={{
            left: `${label.x}px`,
            top: `${label.y}px`,
          }}
        >
          <strong>{label.text}</strong>
          {label.detail && <span>{label.detail}</span>}
        </div>
      ))}
    </div>
  );
}
