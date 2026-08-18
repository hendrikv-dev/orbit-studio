import { TrackerPlace, type SelectedPlace } from "./TrackerPlace";
import { TrackerSkyPanel, EXAMPLE_ARC } from "./TrackerSkyPanel";

/**
 * The opening state of an observing application.
 *
 * The previous entry screen was a full-bleed observatory photograph with a
 * headline over the dark half of it, and it was wrong twice over. It read as a
 * marketing page rather than a product, and its subject was a professional
 * observatory in Chile — the opposite of what Tracker is about, which is what
 * you can see from where you are standing.
 *
 * So this shows the product instead of advertising it. Above the fold: what the
 * question is, one control to answer it, the drawing every recommendation will
 * use, and the shape of the ranked list that is coming. Somebody who never
 * scrolls should still be able to say what Tracker does.
 *
 * The location control appears exactly once. It used to be in the bar *and* in
 * the hero, two instances of the same component competing for the same job.
 * Here it is the entry's own control, and the bar carries it only once a place
 * is chosen and this screen is gone.
 */

/**
 * The preview list.
 *
 * These are the phenomena Tracker actually ranks, shown so the concept is legible
 * before onboarding finishes — but no local condition is invented for them. The
 * rank column is a skeleton and the section is marked as an example, because a
 * plausible-looking "Excellent tonight" against a location Tracker does not yet
 * know would be a fabrication, and this product's whole argument is that it does
 * not do that.
 */
const PREVIEW = [
  { name: "Meteor shower", note: "rate, radiant and the darkest hours", tone: "meteor" },
  { name: "Saturn", note: "naked eye, and the rings through a telescope", tone: "planet" },
  { name: "ISS pass", note: "a few bright minutes, once the feed is live", tone: "satellite" },
  { name: "The Moon", note: "tonight's phase, and what it washes out", tone: "moon" },
];

export function TrackerEntry({ onSelect }: { onSelect: (place: SelectedPlace) => void }) {
  return (
    <section className="tk-entry" aria-label="Choose where you are observing from">
      <div className="tk-entry-grid">
        <div className="tk-entry-lede">
          <p className="tk-eyebrow">What&rsquo;s above you</p>
          <h1 className="tk-display">What&rsquo;s worth seeing tonight?</h1>
          <p className="tk-lede">The night sky, ranked for your location and your time.</p>

          <div className="tk-entry-locate">
            <TrackerPlace place={null} onSelect={onSelect} variant="inline" />
          </div>

          <p className="tk-entry-privacy">
            Your location is used to compute the sky and fetch a forecast. Nothing is stored.
          </p>
        </div>

        <div className="tk-entry-instrument">
          <TrackerSkyPanel arc={EXAMPLE_ARC} example />
        </div>
      </div>

      <div className="tk-entry-preview" aria-label="What Tracker produces">
        <div className="tk-section-head">
          <h2>Tonight</h2>
          <span className="tk-tag">Your list appears once you pick a place</span>
        </div>
        <ol className="tk-preview-list">
          {PREVIEW.map((entry) => (
            <li key={entry.name} className="tk-preview-card" data-tone={entry.tone}>
              <span className="tk-preview-rank" aria-hidden />
              <span className="tk-preview-body">
                <span className="tk-preview-name">{entry.name}</span>
                <span className="tk-preview-note">{entry.note}</span>
              </span>
              <span className="tk-preview-meta" aria-hidden>
                <span className="tk-skeleton-bar" />
                <span className="tk-skeleton-bar is-short" />
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
