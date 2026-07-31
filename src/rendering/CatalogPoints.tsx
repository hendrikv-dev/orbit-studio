import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, Group, Points } from "three";
import type { CatalogLayerModel, CatalogObjectModel } from "../lib/scenario";
import { keplerianToCartesian, propagateTwoBody } from "../physics/kepler";
import { tleToCartesian } from "../physics/tle";
import { readScenePlaybackTimeMs } from "./sceneMotion";
import { eciToThreeVector } from "./coordinates";

interface CatalogPointsProps {
  layers: CatalogLayerModel[];
  selectedObjectId: string | null;
  selectedOnly: boolean;
  simulationTime: string;
  onSelect: (objectId: string) => void;
}

const UPDATE_INTERVAL_MS = 120;

function stateForCatalogObject(object: CatalogObjectModel, date: Date) {
  if (object.tle) {
    return tleToCartesian(object.tle, date);
  }

  if (object.keplerian) {
    return propagateTwoBody(object.keplerian, date);
  }

  return null;
}

function positionForCatalogObject(object: CatalogObjectModel, date: Date) {
  const state = stateForCatalogObject(object, date);

  if (!state && object.keplerian) {
    return eciToThreeVector(keplerianToCartesian(object.keplerian).positionKm);
  }

  return state ? eciToThreeVector(state.positionKm) : null;
}

function writePosition(
  target: Float32Array,
  index: number,
  object: CatalogObjectModel,
  date: Date,
): boolean {
  try {
    const position = positionForCatalogObject(object, date);
    if (!position) return false;
    target[index * 3] = position.x;
    target[index * 3 + 1] = position.y;
    target[index * 3 + 2] = position.z;
    return true;
  } catch {
    return false;
  }
}

function CatalogSelectedObjectMarker({
  object,
  onSelect,
}: {
  object: CatalogObjectModel;
  onSelect: (objectId: string) => void;
}) {
  const groupRef = useRef<Group | null>(null);
  const initialPosition = useMemo(
    () => positionForCatalogObject(object, new Date(readScenePlaybackTimeMs())),
    [object],
  );

  useFrame(() => {
    if (!groupRef.current) return;

    try {
      const position = positionForCatalogObject(object, new Date(readScenePlaybackTimeMs()));
      if (position) groupRef.current.position.copy(position);
    } catch {
      // Preserve the last valid rendered position.
    }
  });

  if (!initialPosition) return null;

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(object.id);
  };

  return (
    <group ref={groupRef} position={initialPosition}>
      <mesh onClick={handleClick}>
        <sphereGeometry args={[98, 16, 10]} />
        <meshStandardMaterial color="#fde68a" emissive="#fbbf24" emissiveIntensity={1.6} />
      </mesh>
      <mesh>
        <sphereGeometry args={[260, 20, 12]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.24}
          wireframe
          depthWrite={false}
        />
      </mesh>
      <mesh onClick={handleClick}>
        <sphereGeometry args={[300, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function CatalogPoints({
  layers,
  selectedObjectId,
  selectedOnly,
  onSelect,
}: CatalogPointsProps) {
  const pointsRef = useRef<Points | null>(null);
  const lastUpdateRef = useRef(0);
  const objects = useMemo(() => {
    return layers
      .filter((layer) => layer.visible && layer.loaded)
      .flatMap((layer) => layer.objects)
      .filter((object) => object.visible && (!selectedOnly || object.id === selectedObjectId));
  }, [layers, selectedObjectId, selectedOnly]);
  const pointData = useMemo(() => {
    const date = new Date(readScenePlaybackTimeMs());
    const renderableObjects: CatalogObjectModel[] = [];
    const positions: number[] = [];
    const colors: number[] = [];

    objects.forEach((object) => {
      const position = positionForCatalogObject(object, date);
      if (!position) return;

      renderableObjects.push(object);
      positions.push(position.x, position.y, position.z);
      const color = new Color(object.id === selectedObjectId ? "#fde68a" : "#94a3b8");
      colors.push(color.r, color.g, color.b);
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    geometry.computeBoundingSphere();

    return { geometry, objects: renderableObjects };
  }, [objects, selectedObjectId]);
  const selectedObject = useMemo(
    () => objects.find((object) => object.id === selectedObjectId) ?? null,
    [objects, selectedObjectId],
  );

  useEffect(() => () => pointData.geometry.dispose(), [pointData.geometry]);

  useFrame(() => {
    if (!pointsRef.current) return;
    const now = performance.now();
    if (now - lastUpdateRef.current < UPDATE_INTERVAL_MS) return;
    lastUpdateRef.current = now;

    const attribute = pointData.geometry.getAttribute("position") as BufferAttribute | undefined;
    if (!attribute) return;
    const positions = attribute.array as Float32Array;
    const date = new Date(readScenePlaybackTimeMs());
    pointData.objects.forEach((object, index) => writePosition(positions, index, object, date));
    attribute.needsUpdate = true;
  });

  const objectForEvent = (event: ThreeEvent<PointerEvent | MouseEvent>) =>
    typeof event.index === "number" ? pointData.objects[event.index] : undefined;

  return (
    <>
      <points
        ref={pointsRef}
        geometry={pointData.geometry}
        frustumCulled={false}
        onClick={(event) => {
          event.stopPropagation();
          const object = objectForEvent(event);
          if (object) onSelect(object.id);
        }}
      >
        <pointsMaterial
          vertexColors
          size={76}
          sizeAttenuation
          transparent
          opacity={selectedObjectId ? 0.34 : 0.58}
          depthWrite={false}
        />
      </points>
      {selectedObject && (
        <CatalogSelectedObjectMarker object={selectedObject} onSelect={onSelect} />
      )}
    </>
  );
}
