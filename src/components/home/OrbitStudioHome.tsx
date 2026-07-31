import React from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import "./orbit-studio-home.css";

interface OrbitStudioHomeProps {
  onOpenExplorer: () => void;
  onOpenPlayground: () => void;
  /** Direct URL to a hosted payment page such as Stripe, Ko-fi, or GitHub Sponsors. */
  supportUrl?: string;
}

const repositoryUrl = "https://github.com/hendrikv-dev/orbit-studio";
const docsUrl = `${repositoryUrl}/blob/main/README.md`;
const dataUrl = `${repositoryUrl}/blob/main/docs/sources.md`;
const issuesUrl = `${repositoryUrl}/issues`;
const licenseUrl = `${repositoryUrl}/blob/main/LICENSE`;

export function OrbitStudioHome({
  onOpenExplorer,
  onOpenPlayground,
  supportUrl,
}: OrbitStudioHomeProps) {
  const donationUrl = supportUrl?.trim();

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
          {donationUrl && (
            <a className="orbit-home-support-link" href="#support">Support</a>
          )}
        </nav>
      </header>

      <section className="orbit-home-hero" id="top" aria-labelledby="orbit-home-title">
        <h1 id="orbit-home-title">Welcome to Orbit Studio</h1>
        <p>A free, open-source platform for exploring orbital data and building space simulations.</p>
      </section>

      <section className="orbit-home-apps" aria-label="Available Orbit Studio environments">
        <article className="orbit-home-card orbit-home-card-explorer">
          <div className="orbit-home-card-copy">
            <img
              className="orbit-home-app-logo"
              src="/brand/orbit-studio-explorer-logo.png"
              alt="Orbit Studio Explorer"
            />
            <h2>Explore the public orbital catalog over time.</h2>
            <p>Search cataloged objects from the beginning of spaceflight to today.</p>
            <button type="button" onClick={onOpenExplorer}>
              Open Explorer <ArrowRight aria-hidden="true" size={18} />
            </button>
          </div>
          <button
            className="orbit-home-preview-button"
            type="button"
            aria-label="Open Orbit Studio Explorer"
            onClick={onOpenExplorer}
          >
            <img
              src="/home/explorer-home.webp"
              alt="Earth surrounded by cataloged orbital objects in Orbit Studio Explorer"
            />
          </button>
        </article>

        <article className="orbit-home-card orbit-home-card-playground">
          <div className="orbit-home-card-copy">
            <img
              className="orbit-home-app-logo"
              src="/brand/orbit-studio-playground-logo.png"
              alt="Orbit Studio Playground"
            />
            <h2>See how orbital elements shape an orbit.</h2>
            <p>Adjust the six classical orbital elements and watch the orbit respond.</p>
            <button type="button" onClick={onOpenPlayground}>
              Open Playground <ArrowRight aria-hidden="true" size={18} />
            </button>
          </div>
          <button
            className="orbit-home-preview-button"
            type="button"
            aria-label="Open Orbit Studio Playground"
            onClick={onOpenPlayground}
          >
            <img
              src="/home/playground-home.webp"
              alt="A satellite orbit displayed around Earth in Orbit Studio Playground"
            />
          </button>
        </article>
      </section>

      <section className="orbit-home-about" aria-labelledby="orbit-home-about-title">
        <div className="orbit-home-about-copy">
          <h2 id="orbit-home-about-title">About Orbit Studio</h2>
          <p>
            Orbit Studio is an independent project. The source is available to inspect, adapt,
            and use as a foundation for your own work.
          </p>
        </div>

        <div className="orbit-home-resource-list" aria-label="Project resources">
          <a href={docsUrl} target="_blank" rel="noreferrer">
            <strong>Documentation</strong>
            <span>Run the project and learn how the current environments work.</span>
          </a>
          <a href={dataUrl} target="_blank" rel="noreferrer">
            <strong>Data &amp; methods</strong>
            <span>Review sources, attribution, reconstruction methods, and known limits.</span>
          </a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            <strong>View source</strong>
            <span>Study the code or use it as a starting point for another project.</span>
          </a>
          <a href={issuesUrl} target="_blank" rel="noreferrer">
            <strong>Report an issue</strong>
            <span>Share a reproducible problem with the official repository.</span>
          </a>
        </div>
      </section>

      {donationUrl && (
        <section className="orbit-home-support" id="support" aria-labelledby="orbit-home-support-title">
          <div>
            <h2 id="orbit-home-support-title">Support Orbit Studio</h2>
            <p>Contributions help fund hosting, data processing, and continued development.</p>
          </div>
          <a className="orbit-home-primary-link" href={donationUrl} target="_blank" rel="noreferrer">
            Donate <ExternalLink aria-hidden="true" size={15} />
          </a>
        </section>
      )}

      <footer className="orbit-home-footer">
        <span>Orbit Studio</span>
        <a href={docsUrl} target="_blank" rel="noreferrer">Docs</a>
        <a href={dataUrl} target="_blank" rel="noreferrer">Data sources</a>
        <a href={repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
        <a href={licenseUrl} target="_blank" rel="noreferrer">License</a>
      </footer>
    </main>
  );
}
