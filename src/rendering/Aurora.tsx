import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  ShaderMaterial,
  Vector3,
} from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { readSceneCelestialState } from "./sceneMotion";
import {
  REPRESENTATIVE_AURORA_INPUTS,
  auroraOvalParametersForKp,
  earthFixedUnitVectorFromLatLon,
  sampleAuroraOvalDirection,
  type AuroraHemisphere,
  type AuroraModelInputs,
  type AuroraOvalParameters,
} from "./auroraModel";

interface AuroraRendererProps {
  enabled: boolean;
  geomagneticIndex?: number;
  intensity?: number;
  modelInputs?: Partial<AuroraModelInputs>;
}

export interface AuroraControllerSnapshot {
  enabled: boolean;
  geomagneticIndex: number;
  intensity: number;
  elapsedTime: number;
}

export class AuroraRenderController {
  private snapshotState: AuroraControllerSnapshot;

  constructor(inputs: Partial<AuroraControllerSnapshot> = {}) {
    this.snapshotState = {
      enabled: inputs.enabled ?? false,
      geomagneticIndex: inputs.geomagneticIndex ?? REPRESENTATIVE_AURORA_INPUTS.kpIndex,
      intensity: inputs.intensity ?? REPRESENTATIVE_AURORA_INPUTS.intensity ?? 1,
      elapsedTime: inputs.elapsedTime ?? 0,
    };
  }

  enableAurora(enabled: boolean) {
    this.snapshotState.enabled = enabled;
  }

  setAuroraIntensity(intensity: number) {
    this.snapshotState.intensity = Math.max(0, Math.min(2, intensity));
  }

  setGeomagneticIndex(kpIndex: number) {
    this.snapshotState.geomagneticIndex = Math.max(0, Math.min(9, kpIndex));
  }

  update(deltaTime: number) {
    this.snapshotState.elapsedTime += Math.max(0, deltaTime);
  }

  snapshot(): AuroraControllerSnapshot {
    return { ...this.snapshotState };
  }
}

const AURORA_SEGMENTS = 192;
const AURORA_WIDTH_BANDS = 5;
const AURORA_HEIGHT_BANDS = 9;
const TMP_SUN = new Vector3();

const auroraVertexShader = `
  attribute float aBand;
  attribute float aHeight;
  attribute float aAzimuth;
  attribute float aHemisphere;
  varying vec3 vLocalDirection;
  varying float vBand;
  varying float vHeight;
  varying float vAzimuth;
  varying float vHemisphere;

  void main() {
    vLocalDirection = normalize(position);
    vBand = aBand;
    vHeight = aHeight;
    vAzimuth = aAzimuth;
    vHemisphere = aHemisphere;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const auroraFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uCurtainSpeed;
  uniform vec3 uSunDirectionLocal;
  varying vec3 vLocalDirection;
  varying float vBand;
  varying float vHeight;
  varying float vAzimuth;
  varying float vHemisphere;

  void main() {
    float localDay = dot(normalize(vLocalDirection), normalize(uSunDirectionLocal));
    float nightside = smoothstep(0.34, -0.24, localDay);
    float bandCore = exp(-pow((vBand - 0.5) / 0.34, 2.0));
    float heightEnvelope = smoothstep(0.0, 0.09, vHeight) * (1.0 - smoothstep(0.92, 1.0, vHeight));
    heightEnvelope *= mix(0.92, 0.34, vHeight);
    float azimuth = vAzimuth * 6.28318530718;
    float drift = uTime * uCurtainSpeed;
    float curtain =
      0.56 +
      0.24 * sin(azimuth * 13.0 + drift * 1.45 + vHeight * 4.4 + vHemisphere * 0.8) +
      0.16 * sin(azimuth * 29.0 - drift * 1.92 + vHeight * 7.0) +
      0.08 * sin(azimuth * 7.0 + drift * 0.62);
    float filament = smoothstep(0.28, 0.86, curtain);
    float pulse = 0.78 + 0.22 * sin(uTime * 1.7 + azimuth * 2.0 + vHemisphere);
    float verticalTint = smoothstep(0.28, 1.0, vHeight);
    vec3 oxygenGreen = vec3(0.32, 1.0, 0.58);
    vec3 oxygenRed = vec3(1.0, 0.33, 0.2);
    vec3 nitrogenViolet = vec3(0.34, 0.52, 1.0);
    vec3 color = oxygenGreen;
    color = mix(color, oxygenRed, verticalTint * 0.18);
    color += nitrogenViolet * (1.0 - nightside) * 0.05;

    float alpha =
      uIntensity *
      bandCore *
      heightEnvelope *
      pulse *
      (0.22 + 0.78 * filament) *
      mix(0.22, 1.0, nightside) *
      0.48;

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color * (0.7 + alpha * 1.7), alpha);
  }
`;

const atmosphereVertexShader = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const atmosphereFragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float rim = pow(1.0 - clamp(dot(normalize(vWorldNormal), viewDirection), 0.0, 1.0), 2.8);
    float breathing = 0.86 + 0.14 * sin(uTime * 0.8);
    vec3 color = mix(vec3(0.18, 0.58, 0.76), vec3(0.26, 1.0, 0.62), 0.36);
    float alpha = rim * breathing * uIntensity * 0.075;

    if (alpha < 0.003) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

function buildAuroraGeometry(parameters: AuroraOvalParameters): BufferGeometry {
  const positions: number[] = [];
  const bands: number[] = [];
  const heights: number[] = [];
  const azimuths: number[] = [];
  const hemispheres: number[] = [];
  const indices: number[] = [];

  (["north", "south"] as const).forEach((hemisphere: AuroraHemisphere) => {
    const hemisphereSign = hemisphere === "north" ? 1 : -1;

    for (let bandIndex = 0; bandIndex < AURORA_WIDTH_BANDS; bandIndex += 1) {
      const stripStartIndex = positions.length / 3;
      const bandFraction = bandIndex / (AURORA_WIDTH_BANDS - 1);

      for (let segment = 0; segment <= AURORA_SEGMENTS; segment += 1) {
        const azimuthFraction = segment / AURORA_SEGMENTS;
        const azimuthRad = azimuthFraction * Math.PI * 2;
        const ovalLobe = Math.sin(azimuthRad - 0.55 * hemisphereSign);
        const dawnDuskRipple = Math.sin(azimuthRad * 2.0 + hemisphereSign * 1.4);
        const localCenterLatitude =
          parameters.centerMagneticLatitudeDeg + ovalLobe * 0.65 + dawnDuskRipple * 0.32;
        const localWidth =
          parameters.widthDeg *
          (1 + 0.12 * Math.sin(azimuthRad * 3.0 - hemisphereSign * 0.75));
        const bandOffset = (bandFraction - 0.5) * localWidth;
        const upperAltitude =
          parameters.curtainTopAltitudeKm *
          (0.88 + 0.1 * Math.sin(azimuthRad * 3.0 + bandFraction * 5.0));

        for (let heightIndex = 0; heightIndex < AURORA_HEIGHT_BANDS; heightIndex += 1) {
          const heightFraction = heightIndex / (AURORA_HEIGHT_BANDS - 1);
          const latitudeWave =
            Math.sin(azimuthRad * 11.0 + heightFraction * 4.0 + hemisphereSign) *
            0.2 *
            heightFraction;
          const magneticLatitudeDeg =
            localCenterLatitude + bandOffset + latitudeWave;
          const direction = sampleAuroraOvalDirection(
            hemisphere,
            azimuthRad,
            magneticLatitudeDeg,
          );
          const lowerAltitude =
            parameters.altitudeKm + 10 * Math.sin(azimuthRad * 5.0 + bandFraction * 2.0);
          const altitude =
            lowerAltitude +
            (upperAltitude - lowerAltitude) * Math.pow(heightFraction, 0.82);
          const radius = EARTH_RADIUS_KM + altitude;

          positions.push(direction[0] * radius, direction[1] * radius, direction[2] * radius);
          bands.push(bandFraction);
          heights.push(heightFraction);
          azimuths.push(azimuthFraction);
          hemispheres.push(hemisphereSign);
        }
      }

      for (let segment = 0; segment < AURORA_SEGMENTS; segment += 1) {
        for (let heightIndex = 0; heightIndex < AURORA_HEIGHT_BANDS - 1; heightIndex += 1) {
          const current =
            stripStartIndex + segment * AURORA_HEIGHT_BANDS + heightIndex;
          const next =
            stripStartIndex + (segment + 1) * AURORA_HEIGHT_BANDS + heightIndex;

          indices.push(current, next, current + 1);
          indices.push(next, next + 1, current + 1);
        }
      }
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("aBand", new BufferAttribute(new Float32Array(bands), 1));
  geometry.setAttribute("aHeight", new BufferAttribute(new Float32Array(heights), 1));
  geometry.setAttribute("aAzimuth", new BufferAttribute(new Float32Array(azimuths), 1));
  geometry.setAttribute("aHemisphere", new BufferAttribute(new Float32Array(hemispheres), 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return geometry;
}

function sunDirectionInEarthFrame(): Vector3 {
  const state = readSceneCelestialState();
  const sun = earthFixedUnitVectorFromLatLon(
    state.subsolarLatitudeDeg,
    state.subsolarLongitudeDeg,
  );

  return TMP_SUN.set(sun[0], sun[1], sun[2]);
}

export function AuroraRenderer({
  enabled,
  geomagneticIndex = REPRESENTATIVE_AURORA_INPUTS.kpIndex,
  intensity = REPRESENTATIVE_AURORA_INPUTS.intensity ?? 1,
  modelInputs,
}: AuroraRendererProps) {
  const auroraMaterialRef = useRef<ShaderMaterial | null>(null);
  const atmosphereMaterialRef = useRef<ShaderMaterial | null>(null);
  const controllerRef = useRef(new AuroraRenderController());
  const parameters = useMemo(
    () =>
      auroraOvalParametersForKp({
        ...REPRESENTATIVE_AURORA_INPUTS,
        ...modelInputs,
        kpIndex: geomagneticIndex,
        intensity,
      }),
    [geomagneticIndex, intensity, modelInputs],
  );
  const geometry = useMemo(() => buildAuroraGeometry(parameters), [parameters]);
  const auroraUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: parameters.intensity },
      uCurtainSpeed: { value: parameters.curtainSpeed },
      uSunDirectionLocal: { value: new Vector3(1, 0, 0) },
    }),
    [parameters.curtainSpeed, parameters.intensity],
  );
  const atmosphereUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: Math.min(parameters.intensity, 1.15) },
    }),
    [parameters.intensity],
  );

  useFrame((_, deltaTime) => {
    controllerRef.current.enableAurora(enabled);
    controllerRef.current.setGeomagneticIndex(geomagneticIndex);
    controllerRef.current.setAuroraIntensity(intensity);
    controllerRef.current.update(deltaTime);

    const snapshot = controllerRef.current.snapshot();
    const sunDirection = sunDirectionInEarthFrame();

    if (auroraMaterialRef.current) {
      auroraMaterialRef.current.uniforms.uTime.value = snapshot.elapsedTime;
      auroraMaterialRef.current.uniforms.uIntensity.value = enabled ? parameters.intensity : 0;
      auroraMaterialRef.current.uniforms.uCurtainSpeed.value = parameters.curtainSpeed;
      auroraMaterialRef.current.uniforms.uSunDirectionLocal.value.copy(sunDirection);
    }

    if (atmosphereMaterialRef.current) {
      atmosphereMaterialRef.current.uniforms.uTime.value = snapshot.elapsedTime;
      atmosphereMaterialRef.current.uniforms.uIntensity.value = enabled
        ? Math.min(parameters.intensity, 1.15)
        : 0;
    }
  });

  if (!enabled) return null;

  return (
    <group name="OrbitStudioAuroraMode" renderOrder={5}>
      <mesh geometry={geometry} frustumCulled={false} renderOrder={5}>
        <shaderMaterial
          ref={auroraMaterialRef}
          blending={AdditiveBlending}
          depthTest
          depthWrite={false}
          fragmentShader={auroraFragmentShader}
          side={DoubleSide}
          toneMapped={false}
          transparent
          uniforms={auroraUniforms}
          vertexShader={auroraVertexShader}
        />
      </mesh>
      <mesh frustumCulled={false} renderOrder={4}>
        <sphereGeometry args={[EARTH_RADIUS_KM * 1.018, 128, 64]} />
        <shaderMaterial
          ref={atmosphereMaterialRef}
          blending={AdditiveBlending}
          depthTest
          depthWrite={false}
          fragmentShader={atmosphereFragmentShader}
          side={BackSide}
          toneMapped={false}
          transparent
          uniforms={atmosphereUniforms}
          vertexShader={atmosphereVertexShader}
        />
      </mesh>
    </group>
  );
}
