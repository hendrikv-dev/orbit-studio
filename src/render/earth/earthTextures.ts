import type { Texture } from "three";
import type { QualityLevel } from "../../state/types";
import { createPublicEarthTexture } from "../../rendering/publicEarthTextures";

interface EarthTextures {
  day: Texture;
  night: Texture;
  clouds: Texture;
}

export function createEarthTextures(_quality: QualityLevel): EarthTextures {
  return {
    day: createPublicEarthTexture("surface"),
    night: createPublicEarthTexture("night"),
    clouds: createPublicEarthTexture("clouds"),
  };
}
