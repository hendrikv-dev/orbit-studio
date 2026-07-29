import type { Texture } from "three";
import { createPublicEarthTexture } from "../../rendering/publicEarthTextures";

export const createEarthTexture = (): Texture =>
  createPublicEarthTexture("surface");

export const createCloudTexture = (): Texture =>
  createPublicEarthTexture("clouds");

export const createNightLightsTexture = (): Texture =>
  createPublicEarthTexture("night");
