import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicEarthTexture } from "./publicEarthTextures";

class FakeImage {
  decoding = "";
  naturalWidth = 5400;
  naturalHeight = 2700;
  width = 5400;
  height = 2700;
  onload: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe("public Earth textures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces the generated surface fallback with decoded NASA imagery", async () => {
    vi.stubGlobal("Image", FakeImage);

    const texture = createPublicEarthTexture("surface");
    const initialTextureVersion = texture.version;
    const initialSourceVersion = texture.source.version;
    expect(texture.source.data.width).toBe(1);
    expect(texture.source.data.height).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(texture.source.data).toBeInstanceOf(FakeImage);
    expect(texture.image).toBeInstanceOf(FakeImage);
    expect(texture.source.data.naturalWidth).toBe(5400);
    expect(texture.source.data.naturalHeight).toBe(2700);
    expect(texture.version).toBeGreaterThan(initialTextureVersion);
    expect(texture.source.version).toBeGreaterThan(initialSourceVersion);

    texture.dispose();
  });
});
