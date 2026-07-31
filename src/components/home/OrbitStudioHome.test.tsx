import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrbitStudioHome } from "./OrbitStudioHome";

const renderHome = () => renderToStaticMarkup(
  <OrbitStudioHome
    onOpenExplorer={() => undefined}
    onOpenPlayground={() => undefined}
    supportUrl="https://example.com/donate"
  />,
);

describe("OrbitStudioHome", () => {
  it("positions Orbit Studio as a platform and describes each current environment once", () => {
    const html = renderHome();

    expect(html).toContain("Welcome to Orbit Studio");
    expect(html).toContain("A free, open-source platform for exploring orbital data and building space simulations.");
    expect(html).toContain("Explore the public orbital catalog over time.");
    expect(html).toContain("See how orbital elements shape an orbit.");
    expect(html).not.toContain("built to grow");
  });

  it("uses the approved logos and the user-selected centered Earth images", () => {
    const html = renderHome();

    expect(html).toContain('/brand/orbit-studio-logo.png');
    expect(html).toContain('/brand/orbit-studio-explorer-logo.png');
    expect(html).toContain('/brand/orbit-studio-playground-logo.png');
    expect(html).toContain('/home/explorer-home.webp');
    expect(html).toContain('/home/playground-home.webp');
  });

  it("links the donation CTA directly to the configured provider", () => {
    const html = renderHome();

    expect(html).toContain('href="https://example.com/donate"');
    expect(html).toContain("Donate");
    expect(html).not.toContain("Contribute on GitHub");
  });

  it("describes source access without implying shared control of the official repository", () => {
    const html = renderHome();

    expect(html).toContain("use as a foundation for your own work");
    expect(html).toContain("View source");
    expect(html).toContain(`${"https://github.com/hendrikv-dev/orbit-studio"}/blob/main/README.md`);
    expect(html).not.toContain("or contribute");
  });
  it("does not render a dead donation action when no provider URL is configured", () => {
    const html = renderToStaticMarkup(
      <OrbitStudioHome
        onOpenExplorer={() => undefined}
        onOpenPlayground={() => undefined}
      />,
    );

    expect(html).not.toContain("Donate");
    expect(html).not.toContain('href="#support"');
  });

});
