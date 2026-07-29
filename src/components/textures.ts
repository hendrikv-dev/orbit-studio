import type * as THREE from "three";
import { createPublicEarthTexture } from "../rendering/publicEarthTextures";

export function createEarthTexture(): THREE.Texture {
  return createPublicEarthTexture("surface");
}

export function createCloudTexture(): THREE.Texture {
  return createPublicEarthTexture("clouds");
}

export function createNightLightsTexture(): THREE.Texture {
  return createPublicEarthTexture("night");
}
