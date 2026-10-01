import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrbitStudioHome, OrbitStudioProductList, type HomeProduct } from "./OrbitStudioHome";
import { orbitStudioSponsorUrl } from "../../lib/projectLinks";

const renderHome = (supportUrl?: string) =>
  renderToStaticMarkup(
    <OrbitStudioHome
      onOpenExplorer={() => undefined}
      onOpenPlayground={() => undefined}
      onOpenTracker={() => undefined}
      supportUrl={supportUrl}
    />,
  );

/** Every `<li class="orbit-home-product">` in document order. */
function productRows(html: string): string[] {
  return html
    .split('<li class="orbit-home-product">')
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("</li>")));
}

describe("OrbitStudioHome", () => {
  /**
   * No suite-wide licence claim reaches the page.
   *
   * The hero said "Open-source tools for exploring orbital data…", which is one
   * sentence making a licence claim about every product in the suite. It was
   * true when there were two of them and became wrong the day Tracker shipped
   * under different terms — and nothing breaks when a sentence like that comes
   * back. It renders perfectly and grants a licence nobody meant to grant.
   */
  it("makes no open-source claim about Orbit Studio as a whole", () => {
    const html = renderHome();
    expect(html).not.toMatch(/Open-source tools/i);
    expect(html).not.toMatch(/Orbit Studio is an[^.]*open-source/i);
  });

  it("says which products are open source, and labels Tracker as neither", () => {
    const html = renderHome();
    // Explorer and Playground are, and saying so is the point of the exercise.
    expect(html).toMatch(/Explorer[\s\S]{0,80}Playground are open source/i);
    // Tracker gets no badge in either direction.
    expect(html).not.toMatch(/proprietary/i);
    const tracker = productRows(html)[0];
    expect(tracker).toContain("Orbit Studio Tracker");
    expect(tracker).not.toMatch(/open source|proprietary|all rights reserved/i);
  });

  it("presents the three products as peer rows in a list, Tracker first", () => {
    const html = renderHome();
    const rows = productRows(html);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Orbit Studio Tracker");
    expect(rows[1]).toContain("Orbit Studio Explorer");
    expect(rows[2]).toContain("Orbit Studio Playground");
    // A list, so a fourth product is a fourth row rather than a redesign.
    expect(html).toContain('<ul class="orbit-home-products">');
  });

  it("gives every product the same parts, so none can ship half-finished", () => {
    for (const row of productRows(renderHome())) {
      expect(row).toContain("orbit-home-product-logo");
      expect(row).toContain("orbit-home-product-job");
      expect(row).toContain("orbit-home-product-note");
      expect(row).toContain("orbit-home-product-visual");
      // Real alt text, not an empty attribute.
      expect(/alt="[^"]{20,}"/.test(row)).toBe(true);
    }
  });

  it("uses the approved logos and each product's own imagery", () => {
    const html = renderHome();

    expect(html).toContain("/brand/orbit-studio-logo.png");
    expect(html).toContain("/brand/orbit-studio-explorer-logo.png");
    expect(html).toContain("/brand/orbit-studio-playground-logo.png");
    // The horizontal Tracker lockup, matching its siblings' shape.
    expect(html).toContain("/brand/orbit-studio-tracker-logo-dark.png");
    expect(html).toContain("/home/explorer-home.webp");
    expect(html).toContain("/home/playground-home.webp");
    expect(html).toContain("/home/tracker-home.webp");
  });

  it("names the Tracker visual as the map it is", () => {
    const tracker = productRows(renderHome())[0];

    expect(tracker).toContain("Big Sur");
    expect(tracker.toLowerCase()).toContain("terrain");
    expect(tracker.toLowerCase()).toContain("observing location");
  });

  it("carries one interactive element per row, so the row is one tab stop", () => {
    for (const row of productRows(renderHome())) {
      expect(row.match(/<button/g) ?? []).toHaveLength(1);
      expect(row).not.toContain("<a ");
      // The heading owns the control, so the product is in the heading outline.
      expect(row).toMatch(/<h2 class="orbit-home-product-job"><button/);
    }
  });

  it("describes the platform in terms that include observing from the ground", () => {
    const html = renderHome();

    expect(html).toContain("Orbit Studio</h1>");
    expect(html).not.toContain("Welcome to Orbit Studio");
    expect(html).toContain("planning what to observe from Earth");
    expect(html).not.toContain("building space simulations");
  });

  it("does not repeat the header's destinations as cards", () => {
    const html = renderHome();

    // The resource-card grid is gone: it duplicated the header and left a
    // fifth card hanging alone on its own row.
    expect(html).not.toContain("orbit-home-resource-list");
    expect(html).not.toContain("orbit-home-card");
    expect(html).not.toContain("View source");
    expect(html).not.toContain("Documentation</strong>");
  });

  it("keeps only the links the header does not already offer in the footer", () => {
    const footer = renderHome().slice(renderHome().indexOf('class="orbit-home-footer"'));

    expect(footer).toContain("License");
    expect(footer).toContain("Report an issue");
    expect(footer).toContain("Support");
    expect(footer).not.toContain(">Docs<");
    expect(footer).not.toContain("Data &amp; methods");
  });

  it("links support to the configured provider without promotional framing", () => {
    const html = renderHome("https://example.invalid/donate");

    expect(html).toContain('href="https://example.invalid/donate"');
    expect(html).not.toContain("Donate");
    expect(html).not.toContain("Contribute on GitHub");
    expect(html).not.toContain("orbit-home-support");
  });

  it("falls back to the project's GitHub Sponsors page when no override is configured", () => {
    const html = renderHome();

    expect(html).toContain(`href="${orbitStudioSponsorUrl}"`);
    expect(html).not.toContain('href="#support"');
  });

  it("opens outbound links safely in a new tab", () => {
    const html = renderHome("https://example.invalid/donate");
    const anchor = html.slice(html.indexOf('href="https://example.invalid/donate"'));

    expect(anchor.slice(0, 120)).toContain('target="_blank"');
    expect(anchor.slice(0, 120)).toContain('rel="noreferrer"');
  });

  it("stays factual: no metrics, testimonials or signup", () => {
    const html = renderHome().toLowerCase();

    for (const word of ["testimonial", "trusted by", "sign up", "pricing", "free trial", "users"]) {
      expect(html).not.toContain(word);
    }
  });
});

describe("OrbitStudioProductList", () => {
  /**
   * The list's whole claim is that adding a product is adding a row.
   *
   * Proving it needs a fourth product, and a fourth product must not exist in
   * the real interface — so the list is mounted directly with a synthetic one.
   * A grid would have failed this: four items in three columns leaves one
   * hanging, which is the defect the list replaced.
   */
  const product = (id: string): HomeProduct => ({
    id,
    name: `Orbit Studio ${id}`,
    job: `Do the ${id} job.`,
    note: `A sentence about ${id}.`,
    logoSrc: `/brand/orbit-studio-${id}-logo.png`,
    logoHeight: 64,
    imageSrc: `/home/${id}-home.webp`,
    imageAlt: `A representative image of Orbit Studio ${id} in use`,
    onOpen: () => undefined,
  });

  it("renders one row per product at any count, with no orphan", () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const products = Array.from({ length: count }, (_, i) => product(`p${i}`));
      const html = renderToStaticMarkup(<OrbitStudioProductList products={products} />);
      expect(productRows(html)).toHaveLength(count);
      // One flat list, never a column count that a product count can break.
      expect(html.match(/<ul class="orbit-home-products">/g) ?? []).toHaveLength(1);
    }
  });

  it("keeps the order it is given", () => {
    const html = renderToStaticMarkup(
      <OrbitStudioProductList products={[product("a"), product("b"), product("c")]} />,
    );
    const rows = productRows(html);
    expect(rows[0]).toContain("Do the a job.");
    expect(rows[1]).toContain("Do the b job.");
    expect(rows[2]).toContain("Do the c job.");
  });
});
