import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrbitStudioHome } from "./OrbitStudioHome";
import { orbitStudioSponsorUrl } from "../../lib/projectLinks";

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

  it("links support to the configured provider without promotional framing", () => {
    const html = renderHome();

    expect(html).toContain('href="https://example.com/donate"');
    expect(html).toContain("Support Orbit Studio");
    expect(html).not.toContain("Contribute on GitHub");
    // Support is an ordinary project link, never a solicitation.
    expect(html).not.toContain("Donate");
    expect(html).not.toContain("orbit-home-primary-link");
    expect(html).not.toContain("orbit-home-support");
  });

  it("keeps support beside the other project resources rather than in its own section", () => {
    const html = renderHome();
    const resourceList = html.slice(html.indexOf('class="orbit-home-resource-list"'));

    expect(resourceList.indexOf("Support Orbit Studio")).toBeGreaterThan(-1);
    expect(resourceList.indexOf("Report an issue")).toBeLessThan(
      resourceList.indexOf("Support Orbit Studio"),
    );
  });

  it("describes source access without implying shared control of the official repository", () => {
    const html = renderHome();

    expect(html).toContain("use as a foundation for your own work");
    expect(html).toContain("View source");
    expect(html).toContain(`${"https://github.com/hendrikv-dev/orbit-studio"}/blob/main/README.md`);
    expect(html).not.toContain("or contribute");
  });
  it("falls back to the project's GitHub Sponsors page when no override is configured", () => {
    const html = renderToStaticMarkup(
      <OrbitStudioHome
        onOpenExplorer={() => undefined}
        onOpenPlayground={() => undefined}
      />,
    );

    expect(html).toContain(`href="${orbitStudioSponsorUrl}"`);
    expect(html).not.toContain("Donate");
    expect(html).not.toContain('href="#support"');
  });

  it("opens the support link safely in a new tab", () => {
    const html = renderHome();
    const anchor = html.slice(html.indexOf('href="https://example.com/donate"'));

    expect(anchor.slice(0, 120)).toContain('target="_blank"');
    expect(anchor.slice(0, 120)).toContain('rel="noreferrer"');
  });

});
