import React, { useEffect } from "react";
import { signalAppReady } from "../../lib/appReady";
import { ArrowRight, ExternalLink } from "lucide-react";
import { orbitStudioRepositoryUrl, orbitStudioSponsorUrl } from "../../lib/projectLinks";
import "./orbit-studio-home.css";

interface OrbitStudioHomeProps {
  onOpenExplorer: () => void;
  onOpenPlayground: () => void;
  onOpenTracker: () => void;
  /** Overrides the default GitHub Sponsors destination. */
  supportUrl?: string;
}

const repositoryUrl = orbitStudioRepositoryUrl;
const docsUrl = `${repositoryUrl}/blob/main/README.md`;
const dataUrl = `${repositoryUrl}/blob/main/docs/sources.md`;
const issuesUrl = `${repositoryUrl}/issues`;
const licenseUrl = `${repositoryUrl}/blob/main/LICENSE`;

/**
 * One product in the list.
 *
 * Every field is required, which is the point: a product with no image or no
 * stated job cannot be added half-finished and left looking broken next to the
 * others. Tracker spent a release in exactly that state — a card with no
 * preview, sitting alone on a second grid row.
 */
export interface HomeProduct {
  id: string;
  name: string;
  /** What the product does, in one concrete sentence. */
  job: string;
  /** One supporting sentence. */
  note: string;
  logoSrc: string;
  /**
   * Rendered logo height.
   *
   * All three are the same lockup — icon at the left, "ORBIT STUDIO" over the
   * product name at the right — so a shared height puts the three icons and the
   * three wordmarks at the same size, whatever each asset's overall width. The
   * per-product number only compensates for differing transparent padding.
   */
  logoHeight: number;
  imageSrc: string;
  imageAlt: string;
  onOpen: () => void;
}

/**
 * The product list, rendered as rows rather than as a grid.
 *
 * A grid of cards has to be told how many columns it has, and it looks wrong
 * the moment the product count stops being a multiple of that number: three
 * products in a two-column grid left Tracker hanging alone on its own row, and
 * a fourth product would do the same thing to a three-column one. A list has no
 * such arithmetic. Adding a product adds a row, at any count, at every width.
 *
 * Exported so a test can mount it with a fourth product and prove that claim
 * without a fourth product existing in the real interface.
 */
export function OrbitStudioProductList({ products }: { products: HomeProduct[] }) {
  return (
    <ul className="orbit-home-products">
      {products.map((product) => (
        <li key={product.id} className="orbit-home-product">
          <div className="orbit-home-product-copy">
            <img
              className="orbit-home-product-logo"
              src={product.logoSrc}
              alt={product.name}
              style={{ height: `${product.logoHeight}px` }}
            />
            {/*
              The heading carries the only interactive element in the row, and
              its ::after covers the whole row. That gives one focus stop per
              product and a fully clickable row without nesting a control inside
              a control — an image button beside a text button meant two tab
              stops that did the same thing.
            */}
            <h2 className="orbit-home-product-job">
              <button type="button" className="orbit-home-product-open" onClick={product.onOpen}>
                {product.job}
              </button>
            </h2>
            <p className="orbit-home-product-note">{product.note}</p>
            <span className="orbit-home-product-cta" aria-hidden="true">
              Open {product.name.replace("Orbit Studio ", "")}
              <ArrowRight size={16} />
            </span>
          </div>
          <div className="orbit-home-product-visual">
            <img src={product.imageSrc} alt={product.imageAlt} loading="lazy" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OrbitStudioHome({
  onOpenExplorer,
  onOpenPlayground,
  onOpenTracker,
  supportUrl,
}: OrbitStudioHomeProps) {
  // A static page: nothing renders asynchronously, so it is ready on mount.
  useEffect(() => { signalAppReady(); }, []);

  const sponsorUrl = supportUrl?.trim() || orbitStudioSponsorUrl;

  const products: HomeProduct[] = [
    {
      id: "tracker",
      name: "Orbit Studio Tracker",
      job: "See what is worth observing from where you are.",
      note: "Pick a place and a date, and get timing, direction and conditions for what is up.",
      // The horizontal lockup, matching Explorer's and Playground's. The other
      // Tracker asset stacks the mark above the wordmark, which made this row's
      // logo half again as tall as its siblings' and threw the list out of
      // alignment. Named "dark" for the background it is drawn on, not its ink.
      logoSrc: "/brand/orbit-studio-tracker-logo-dark.png",
      // About 7% transparent padding top and bottom, unlike its siblings.
      logoHeight: 69,
      imageSrc: "/home/tracker-home.webp",
      imageAlt:
        "Orbit Studio Tracker showing the Big Sur coast, with hillshaded terrain of the Santa Lucia range and a selected observing location marked",
      onOpen: onOpenTracker,
    },
    {
      id: "explorer",
      name: "Orbit Studio Explorer",
      job: "Explore the public orbital catalog over time.",
      note: "Search cataloged objects from the beginning of spaceflight to today.",
      logoSrc: "/brand/orbit-studio-explorer-logo.png",
      logoHeight: 64,
      imageSrc: "/home/explorer-home.webp",
      imageAlt: "Earth surrounded by cataloged orbital objects in Orbit Studio Explorer",
      onOpen: onOpenExplorer,
    },
    {
      id: "playground",
      name: "Orbit Studio Playground",
      job: "See how orbital elements shape an orbit.",
      note: "Adjust the six classical orbital elements and watch the orbit respond.",
      logoSrc: "/brand/orbit-studio-playground-logo.png",
      logoHeight: 64,
      imageSrc: "/home/playground-home.webp",
      imageAlt: "A satellite orbit displayed around Earth in Orbit Studio Playground",
      onOpen: onOpenPlayground,
    },
  ];

  return (
    <main className="orbit-home">
      <header className="orbit-home-header">
        <a className="orbit-home-brand" href="#top" aria-label="Orbit Studio home">
          <img src="/brand/orbit-studio-logo.png" alt="Orbit Studio" />
        </a>

        <nav aria-label="Orbit Studio resources">
          <a href={docsUrl} target="_blank" rel="noreferrer">Docs</a>
          <a href={dataUrl} target="_blank" rel="noreferrer">Data &amp; methods</a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            GitHub <ExternalLink aria-hidden="true" size={13} />
          </a>
        </nav>
      </header>

      <section className="orbit-home-intro" id="top" aria-labelledby="orbit-home-title">
        <h1 id="orbit-home-title">Orbit Studio</h1>
        <p>
          Open-source tools for exploring orbital data, understanding orbital mechanics, and
          planning what to observe from Earth.
        </p>
      </section>

      <section className="orbit-home-catalogue" aria-label="Orbit Studio tools">
        <OrbitStudioProductList products={products} />
      </section>

      <section className="orbit-home-about" aria-labelledby="orbit-home-about-title">
        <h2 id="orbit-home-about-title">About Orbit Studio</h2>
        <p>
          Orbit Studio is an independent, open-source project. Each tool states where its data
          comes from and what it cannot answer. The source is available to inspect, adapt, and
          use as a foundation for your own work.
        </p>
      </section>

      {/*
        The header already carries Docs, Data & methods and GitHub. Repeating
        them here as cards and again in the footer meant three routes to the
        same three pages, and left a fifth card hanging alone on a second row.
        What remains is only what the header does not offer.
      */}
      <footer className="orbit-home-footer">
        <span className="orbit-home-footer-name">Orbit Studio</span>
        <nav aria-label="Project links">
          <a href={licenseUrl} target="_blank" rel="noreferrer">License</a>
          <a href={issuesUrl} target="_blank" rel="noreferrer">Report an issue</a>
          <a href={sponsorUrl} target="_blank" rel="noreferrer">Support</a>
        </nav>
      </footer>
    </main>
  );
}
