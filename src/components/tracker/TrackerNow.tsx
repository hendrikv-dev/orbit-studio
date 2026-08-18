import { useMemo } from "react";
import type { BestWindow } from "../../data/tracker/conditions";
import type { SkyAdjustedOpportunity } from "../../data/tracker/opportunity";
import { formatClockTime, type PlaceClock } from "../../lib/localTime";

/**
 * What is worth stepping outside for in the next couple of hours.
 *
 * Tonight answers "what is this whole night worth"; this answers "should I put
 * shoes on". They are different questions and were, until now, the same screen
 * — the tab existed and rendered Tonight unchanged, which is the worst kind of
 * navigation, one that asserts a product and ships a duplicate.
 *
 * The admission rule is imminence rather than strength. A magnificent target
 * that peaks at four in the morning does not belong here at eight in the
 * evening, and a modest one that is well placed right now does. Where nothing
 * qualifies, saying so plainly and naming the hour to come back is the answer
 * — not the best of a bad set, which is the failure mode this product exists
 * to avoid.
 */

/** How far ahead still counts as "now" — long enough to get outside and settle. */
const IMMINENT_MINUTES = 120;

interface Props {
  entries: SkyAdjustedOpportunity[];
  windows: Map<string, BestWindow>;
  clock: PlaceClock;
  onSelect: (id: string) => void;
}

export function TrackerNow({ entries, windows, clock, onSelect }: Props) {
  const now = Date.now();

  const { open, soon, next } = useMemo(() => {
    const open: { entry: SkyAdjustedOpportunity; window: BestWindow }[] = [];
    const soon: { entry: SkyAdjustedOpportunity; window: BestWindow; inMinutes: number }[] = [];
    let next: { entry: SkyAdjustedOpportunity; window: BestWindow } | null = null;

    for (const entry of entries) {
      const window = windows.get(entry.opportunity.id);
      if (!window) continue;
      const start = Date.parse(window.startUtc);
      const end = Date.parse(window.endUtc);
      if (now >= start && now <= end) {
        open.push({ entry, window });
      } else if (start > now) {
        const inMinutes = Math.round((start - now) / 60_000);
        if (inMinutes <= IMMINENT_MINUTES) soon.push({ entry, window, inMinutes });
        if (!next || start < Date.parse(next.window.startUtc)) next = { entry, window };
      }
    }
    open.sort((a, b) => b.entry.strength - a.entry.strength);
    soon.sort((a, b) => a.inMinutes - b.inMinutes);
    return { open, soon, next };
  }, [entries, windows, now]);

  const nothing = open.length === 0 && soon.length === 0;

  return (
    <section className="tk-view tk-now" aria-label="Right now">
      <div className="tk-view-head">
        <h1 className="tk-display">
          {open.length > 0
            ? "Worth going out for right now"
            : soon.length > 0
              ? "Nearly time"
              : "Not yet"}
        </h1>
        <p className="tk-view-lede">
          {open.length > 0
            ? "These are inside their best window as you read this."
            : soon.length > 0
              ? "Nothing is at its best yet, but it is close enough to get ready."
              : next
                ? `Nothing is worth the trip this minute. The first window opens at ${formatClockTime(next.window.startUtc, clock)}.`
                : "Nothing tonight clears the bar from here. Tomorrow may be different."}
        </p>
      </div>

      {open.length > 0 || soon.length > 0 ? (
        <ul className="tk-now-list">
          {open.map(({ entry, window }) => (
            <li key={entry.opportunity.id}>
              <button type="button" className="tk-now-row is-open" onClick={() => onSelect(entry.opportunity.id)}>
                <span className="tk-now-state">Now</span>
                <span className="tk-now-body">
                  <span className="tk-now-name">{entry.opportunity.title}</span>
                  <span className="tk-now-note">{entry.opportunity.summary}</span>
                </span>
                <span className="tk-now-until">
                  until {formatClockTime(window.endUtc, clock)}
                </span>
              </button>
            </li>
          ))}
          {soon.map(({ entry, window, inMinutes }) => (
            <li key={entry.opportunity.id}>
              <button type="button" className="tk-now-row" onClick={() => onSelect(entry.opportunity.id)}>
                <span className="tk-now-state">
                  {inMinutes < 60 ? `${inMinutes} min` : `${Math.round(inMinutes / 60)} hr`}
                </span>
                <span className="tk-now-body">
                  <span className="tk-now-name">{entry.opportunity.title}</span>
                  <span className="tk-now-note">{entry.opportunity.summary}</span>
                </span>
                <span className="tk-now-until">
                  from {formatClockTime(window.startUtc, clock)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {nothing && next ? (
        <button type="button" className="tk-now-next" onClick={() => onSelect(next!.entry.opportunity.id)}>
          <span className="tk-now-next-label">First up</span>
          <span className="tk-now-next-name">{next.entry.opportunity.title}</span>
          <span className="tk-now-next-time">{formatClockTime(next.window.startUtc, clock)}</span>
        </button>
      ) : null}
    </section>
  );
}
