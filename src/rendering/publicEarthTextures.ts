import {
  LinearFilter,
  SRGBColorSpace,
  type Texture,
} from "three";
import {
  createGeneratedEarthTexture,
  type GeneratedEarthTextureKind,
} from "./proceduralTextureFallbacks";

type PublicEarthTextureKind = "surface" | "clouds" | "night";

export const PUBLIC_EARTH_TEXTURE_ASSETS: Record<PublicEarthTextureKind, string | null> = {
  surface: "/earth/nasa-blue-marble-january-5400.jpg",
  clouds: null,
  night: null,
};

function loadImageIntoTexture(texture: Texture, url: string): void {
  if (typeof Image === "undefined") return;

  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    const canvas = texture.image;

    if (canvas && typeof canvas.getContext === "function") {
      const context = canvas.getContext("2d");
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
    } else {
      texture.image = image;
    }

    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
  };
  image.src = url;
}

export function createPublicEarthTexture(
  kind: PublicEarthTextureKind,
  fallbackKind: GeneratedEarthTextureKind = kind,
): Texture {
  const texture = createGeneratedEarthTexture(fallbackKind);
  const assetUrl = PUBLIC_EARTH_TEXTURE_ASSETS[kind];

  if (assetUrl) {
    loadImageIntoTexture(texture, assetUrl);
  }

  return texture;
}
