import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ExplorerHeroMedia } from "../../data/explorerEducation";
import { ExplorerHeroMediaFrame } from "./ExplorerView";

const hero: ExplorerHeroMedia = {
  kind: "earth-orbit",
  imageUrl: "/images/hubble.jpg",
  imageAlt: "Hubble Space Telescope in orbit.",
  credit: "NASA",
  sourceUrl: "https://science.nasa.gov/mission/hubble/",
};

describe("Explorer details media", () => {
  it("renders a deliberate fixed media frame while the image is loading", () => {
    const markup = renderToStaticMarkup(
      <ExplorerHeroMediaFrame
        hero={hero}
        imageStatus="loading"
        imageUrl={hero.imageUrl!}
        onError={vi.fn()}
        onLoad={vi.fn()}
      />,
    );

    expect(markup).toContain("explorer-hero-media has-image is-loading");
    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toContain("explorer-hero-media-placeholder");
    expect(markup).toContain("Hubble Space Telescope in orbit.");
    expect(markup).toContain("NASA");
  });

  it("retains attribution and an explicit failure state when loading fails", () => {
    const markup = renderToStaticMarkup(
      <ExplorerHeroMediaFrame
        hero={hero}
        imageStatus="failed"
        imageUrl={hero.imageUrl!}
        onError={vi.fn()}
        onLoad={vi.fn()}
      />,
    );

    expect(markup).toContain("explorer-hero-media has-image is-failed");
    expect(markup).toContain("Image unavailable");
    expect(markup).toContain("NASA");
    expect(markup).toContain(hero.sourceUrl!);
  });
});
