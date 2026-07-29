import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from "three";

export type GeneratedEarthTextureKind = "surface" | "clouds" | "night";

function fallbackPixel(kind: GeneratedEarthTextureKind): Uint8Array<ArrayBuffer> {
  const pixel =
    kind === "clouds"
      ? [0, 0, 0, 0]
      : kind === "night"
        ? [0, 0, 0, 255]
        : [12, 25, 35, 255];

  return Uint8Array.from(pixel) as Uint8Array<ArrayBuffer>;
}

function configure(texture: Texture): Texture {
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createFallbackDataTexture(kind: GeneratedEarthTextureKind): Texture {
  const texture = new DataTexture(fallbackPixel(kind), 1, 1, RGBAFormat);
  return configure(texture);
}

export function createGeneratedEarthTexture(kind: GeneratedEarthTextureKind): Texture {
  if (typeof document === "undefined") {
    return createFallbackDataTexture(kind);
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");

  if (!context) {
    return createFallbackDataTexture(kind);
  }

  context.fillStyle = kind === "night" ? "#050b12" : "#07121c";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (kind === "surface") {
    context.fillStyle = "#1f3947";
    drawLandMasses(context);
  }

  const texture = new CanvasTexture(canvas);
  return configure(texture);
}

function drawLandMasses(context: CanvasRenderingContext2D): void {
  const paths = [
    "M118 168c39-45 104-55 155-31 30 14 59 9 88 22 30 14 37 49 12 69-29 24-67-2-94 21-27 22-5 54-31 76-25 21-65 1-80-26-21-39-87-42-92-86-2-16 18-25 42-45z",
    "M354 160c21-23 69-19 99-7 34 14 50 39 30 59-17 17-49 10-71 24-25 16-48 52-80 36-27-14-17-53 3-72 9-9 10-27 19-40z",
    "M475 230c48-27 105-16 142 23 25 26 70 28 88 61 23 42-14 80-61 68-39-10-71-52-113-42-29 7-57 2-73-21-20-29-14-71 17-89z",
    "M665 132c52-31 134-28 188 5 39 24 74 66 59 99-14 31-66 29-101 45-38 17-52 58-92 55-37-3-50-41-38-73 10-27-44-39-47-73-2-22 11-45 31-58z",
    "M790 340c31-10 83 3 103 30 16 22 4 52-25 59-42 9-104-24-96-62 2-11 8-22 18-27z",
  ];

  paths.forEach((path) => context.fill(new Path2D(path)));
}
