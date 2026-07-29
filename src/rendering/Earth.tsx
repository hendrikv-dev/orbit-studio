import { useEffect, useMemo, useRef, type MutableRefObject, type PropsWithChildren } from "react";
import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  Group,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";
import { useFrame } from "@react-three/fiber";
import { EARTH_RADIUS_KM } from "../physics/constants";
import { computeCelestialState } from "../astronomy/celestialFrames";
import type { RenderSettings } from "../lib/scenario";
import type { EarthLayerStatus } from "../data/earthLayers";
import {
  createVectorEarthCoastlineGeometry,
  VECTOR_EARTH_COASTLINE_COLOR,
} from "./earthTextures";
import { createPublicEarthTexture } from "./publicEarthTextures";
import { readSceneCelestialState, readScenePlaybackTimeMs } from "./sceneMotion";
import {
  EARTH_AMBIENT_NIGHT_SURFACE_SCALE,
  EARTH_DAY_SURFACE_MAX_SCALE,
  EARTH_DAY_SURFACE_MIN_SCALE,
  EARTH_TWILIGHT_WARMTH_SCALE,
  writeWorldDirectionInLocalFrame,
  writeEarthSurfaceSunDirectionThree,
} from "./earthFidelity";

interface EarthProps extends PropsWithChildren {
  renderSettings: RenderSettings;
  simulationTimeUtc: string;
  earthToSunWorldRef: MutableRefObject<Vector3>;
  visualPreset?: EarthVisualPreset;
  visualEmphasis?: number;
  onLiveLayerStatus?: (status: EarthLayerStatus, errorMessage?: string | null) => void;
}

export type EarthVisualPreset = "realistic" | "orbit-focus" | "catalog-focus";

function segmentsForQuality(quality: RenderSettings["quality"], visualPreset: EarthVisualPreset): number {
  if (visualPreset === "catalog-focus") return 128;
  if (quality === "low") return 96;
  if (quality === "medium") return 128;
  return 160;
}

const EARTH_SURFACE_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const EARTH_SURFACE_FRAGMENT_SHADER = `
  uniform sampler2D uSurfaceMap;
  uniform sampler2D uCloudMap;
  uniform sampler2D uNightMap;
  uniform vec3 uEarthToSunWorld;
  uniform float uCloudsEnabled;
  uniform float uCloudOpacity;
  uniform float uCloudIntensity;
  uniform float uNightLightsEnabled;
  uniform float uAtmosphereIntensity;
  uniform float uElapsedDays;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  float saturate(float value) {
    return clamp(value, 0.0, 1.0);
  }

  void main() {
    vec3 geometricNormal = normalize(vWorldNormal);
    vec3 lightingNormal = geometricNormal;
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 earthToSunWorld = normalize(uEarthToSunWorld);
    float solarDot = dot(lightingNormal, earthToSunWorld);
    float daylight = smoothstep(-0.065, 0.075, solarDot);
    float nightSide = 1.0 - smoothstep(-0.19, -0.035, solarDot);
    float twilight = smoothstep(-0.22, 0.02, solarDot) * (1.0 - daylight);

    vec2 earthMapUv = vUv;
    vec3 surfaceSample = texture2D(uSurfaceMap, earthMapUv).rgb;
    vec3 surface = max(surfaceSample, vec3(0.0));
    vec2 cloudUv = vec2(fract(earthMapUv.x + uElapsedDays * 0.16), clamp(earthMapUv.y, 0.0, 1.0));
    vec3 cloudSample = texture2D(uCloudMap, cloudUv).rgb;
    float cloudMask = smoothstep(0.34, 0.82, max(max(cloudSample.r, cloudSample.g), cloudSample.b));
    vec3 nightSample = texture2D(uNightMap, earthMapUv).rgb;
    float cityMask = smoothstep(0.44, 0.82, max(max(nightSample.r, nightSample.g), nightSample.b));

    float directDaylight = saturate(solarDot);
    float dayIllumination = daylight * mix(
      ${EARTH_DAY_SURFACE_MIN_SCALE.toFixed(3)},
      ${EARTH_DAY_SURFACE_MAX_SCALE.toFixed(3)},
      directDaylight
    );
    vec3 twilightWarmth = surface * vec3(1.0, 0.58, 0.32) * twilight * ${EARTH_TWILIGHT_WARMTH_SCALE.toFixed(3)};
    vec3 color = surface * (${EARTH_AMBIENT_NIGHT_SURFACE_SCALE.toFixed(3)} + dayIllumination) + twilightWarmth;

    float cloudsOn = step(0.5, uCloudsEnabled);
    float cloudLight = max(daylight, twilight * 0.65);
    vec3 cloudColor = mix(vec3(0.62, 0.7, 0.76), vec3(1.0), cloudLight);
    color = mix(
      color,
      color + cloudColor * cloudMask * uCloudIntensity * (0.24 + cloudLight * 0.76),
      cloudsOn * uCloudOpacity
    );

    float nightLightsOn = step(0.5, uNightLightsEnabled);
    vec3 cityColor = vec3(1.0, 0.68, 0.34) * cityMask * nightSide * nightLightsOn * 0.68;
    color += cityColor;

    float limb = pow(1.0 - saturate(dot(geometricNormal, viewDirection)), 3.4);
    color += vec3(0.28, 0.58, 0.78) * limb * uAtmosphereIntensity * (0.1 + daylight * 0.24);

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const EARTH_ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vEarthNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vEarthNormal = normalize(normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const EARTH_ATMOSPHERE_FRAGMENT_SHADER = `
  uniform vec3 uSunDirectionEarth;
  uniform float uAtmosphereIntensity;
  uniform vec3 uAtmosphereColor;
  varying vec3 vEarthNormal;
  varying vec3 vWorldPosition;

  float saturate(float value) {
    return clamp(value, 0.0, 1.0);
  }

  void main() {
    vec3 normal = normalize(vEarthNormal);
    vec3 lightingNormal = normal;
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 sunDirection = normalize(uSunDirectionEarth);
    float solarDot = dot(lightingNormal, sunDirection);
    float daylight = smoothstep(-0.2, 0.18, solarDot);
    float rim = pow(1.0 - saturate(dot(normal, viewDirection)), 2.45);
    float alpha = rim * uAtmosphereIntensity * mix(0.08, 0.34, daylight);

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uAtmosphereColor * mix(0.64, 1.0, daylight), alpha);
  }
`;

function colorUniformFromHex(hex: string): Vector3 {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "78c9ff";
  const value = Number.parseInt(normalized, 16);

  return new Vector3(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  );
}

export function Earth({
  renderSettings,
  simulationTimeUtc,
  earthToSunWorldRef,
  visualPreset = "realistic",
  visualEmphasis = 1,
  children,
  onLiveLayerStatus,
}: EarthProps) {
  const groupRef = useRef<Group>(null);
  const surfaceMeshRef = useRef<Mesh>(null);
  const surfaceMaterialRef = useRef<ShaderMaterial | null>(null);
  const atmosphereMaterialRef = useRef<ShaderMaterial | null>(null);
  const frameSunDirectionRef = useRef(new Vector3());
  const worldRotationRef = useRef(new Quaternion());
  const segments = segmentsForQuality(renderSettings.quality, visualPreset);
  const radius = visualPreset === "catalog-focus"
    ? EARTH_RADIUS_KM * 0.998
    : EARTH_RADIUS_KM;
  const coastlineGeometry = useMemo(
    () => createVectorEarthCoastlineGeometry(radius + 42),
    [radius],
  );
  const surfaceTexture = useMemo(() => createPublicEarthTexture("surface"), []);
  const cloudTexture = useMemo(() => createPublicEarthTexture("clouds"), []);
  const nightTexture = useMemo(() => createPublicEarthTexture("night"), []);
  const initialSunDirection = useMemo(
    () => writeEarthSurfaceSunDirectionThree(
      new Vector3(),
      simulationTimeUtc,
    ),
    [simulationTimeUtc],
  );
  const surfaceUniforms = useMemo(
    () => ({
      uSurfaceMap: { value: surfaceTexture },
      uCloudMap: { value: cloudTexture },
      uNightMap: { value: nightTexture },
      uEarthToSunWorld: { value: earthToSunWorldRef.current.clone().normalize() },
      uCloudsEnabled: { value: renderSettings.showClouds ? 1 : 0 },
      uCloudOpacity: { value: renderSettings.earthCloudOpacity },
      uCloudIntensity: { value: renderSettings.earthCloudIntensity },
      uNightLightsEnabled: { value: renderSettings.showNightLights ? 1 : 0 },
      uAtmosphereIntensity: {
        value: renderSettings.showAtmosphere ? renderSettings.atmosphereIntensity : 0,
      },
      uElapsedDays: { value: 0 },
    }),
    [cloudTexture, initialSunDirection, nightTexture, renderSettings, surfaceTexture],
  );
  const atmosphereUniforms = useMemo(
    () => ({
      uSunDirectionEarth: { value: initialSunDirection.clone() },
      uAtmosphereIntensity: {
        value: renderSettings.showAtmosphere ? renderSettings.atmosphereIntensity : 0,
      },
      uAtmosphereColor: { value: colorUniformFromHex(renderSettings.atmosphereColor) },
    }),
    [initialSunDirection, renderSettings],
  );

  useEffect(
    () => () => {
      coastlineGeometry.dispose();
      surfaceTexture.dispose();
      cloudTexture.dispose();
      nightTexture.dispose();
    },
    [cloudTexture, coastlineGeometry, nightTexture, surfaceTexture],
  );

  useEffect(() => {
    onLiveLayerStatus?.("idle", null);
  }, [onLiveLayerStatus]);

  useEffect(() => {
    const atmosphereIntensity =
      renderSettings.showAtmosphere
        ? renderSettings.atmosphereIntensity *
          visualEmphasis *
          (visualPreset === "catalog-focus" ? 0.62 : 1)
        : 0;

    surfaceUniforms.uCloudsEnabled.value = renderSettings.showClouds ? 1 : 0;
    surfaceUniforms.uCloudOpacity.value = Math.max(0, renderSettings.earthCloudOpacity);
    surfaceUniforms.uCloudIntensity.value = Math.max(0, renderSettings.earthCloudIntensity);
    surfaceUniforms.uNightLightsEnabled.value = renderSettings.showNightLights ? 1 : 0;
    surfaceUniforms.uAtmosphereIntensity.value = atmosphereIntensity * 0.55;
    atmosphereUniforms.uAtmosphereIntensity.value = atmosphereIntensity;
    atmosphereUniforms.uAtmosphereColor.value.copy(colorUniformFromHex(renderSettings.atmosphereColor));
  }, [atmosphereUniforms, renderSettings, surfaceUniforms, visualEmphasis, visualPreset]);

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.quaternion.copy(
        computeCelestialState(simulationTimeUtc).earthFixedToSceneQuaternion,
      );
    }
  }, [simulationTimeUtc]);

  useFrame(() => {
    if (!groupRef.current || !surfaceMeshRef.current) return;

    const timeMs = readScenePlaybackTimeMs();
    const celestialState = readSceneCelestialState();
    groupRef.current.quaternion.copy(celestialState.earthFixedToSceneQuaternion);
    groupRef.current.updateWorldMatrix(true, true);
    frameSunDirectionRef.current.copy(earthToSunWorldRef.current);
    surfaceMeshRef.current.getWorldQuaternion(worldRotationRef.current);
    const frameSunDirection = writeWorldDirectionInLocalFrame(
      frameSunDirectionRef.current,
      frameSunDirectionRef.current,
      worldRotationRef.current,
    );
    surfaceUniforms.uEarthToSunWorld.value.copy(earthToSunWorldRef.current).normalize();
    surfaceUniforms.uElapsedDays.value = timeMs / 86_400_000;
    atmosphereUniforms.uSunDirectionEarth.value.copy(frameSunDirection);
  });

  return (
    <group ref={groupRef} name="OrbitStudioEarthGroup">
      <mesh ref={surfaceMeshRef} name="OrbitStudioEarthBase" frustumCulled={false}>
        <sphereGeometry args={[radius, segments, Math.floor(segments / 2)]} />
        <shaderMaterial
          ref={surfaceMaterialRef}
          uniforms={surfaceUniforms}
          vertexShader={EARTH_SURFACE_VERTEX_SHADER}
          fragmentShader={EARTH_SURFACE_FRAGMENT_SHADER}
          depthTest
          depthWrite
          toneMapped={false}
        />
      </mesh>
      {renderSettings.showAtmosphere && atmosphereUniforms.uAtmosphereIntensity.value > 0 && (
        <mesh name="OrbitStudioEarthAtmosphere" frustumCulled={false} renderOrder={3}>
          <sphereGeometry
            args={[
              radius * Math.max(1.006, renderSettings.atmosphereScale),
              segments,
              Math.floor(segments / 2),
            ]}
          />
          <shaderMaterial
            ref={atmosphereMaterialRef}
            uniforms={atmosphereUniforms}
            vertexShader={EARTH_ATMOSPHERE_VERTEX_SHADER}
            fragmentShader={EARTH_ATMOSPHERE_FRAGMENT_SHADER}
            blending={AdditiveBlending}
            depthTest
            depthWrite={false}
            side={BackSide}
            transparent
            toneMapped={false}
          />
        </mesh>
      )}
      <lineSegments
        name="OrbitStudioEarthCoastlines"
        geometry={coastlineGeometry}
        frustumCulled={false}
        renderOrder={2}
      >
        <lineBasicMaterial
          color={VECTOR_EARTH_COASTLINE_COLOR}
          depthTest
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-3}
          transparent
          opacity={0.42}
          toneMapped={false}
        />
      </lineSegments>
      {children}
    </group>
  );
}
