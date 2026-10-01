import { Bell, CircleHelp, Settings } from "lucide-react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import type { WeatherSourceInfo } from "../../data/tracker/conditions";
import { TrackerDate } from "./TrackerDate";
import { TrackerPlace, type SelectedPlace } from "./TrackerPlace";

/**
 * The global shell's one bar.
 *
 * Identity, where you are, the two things Tracker can be asked, how fresh the
 * numbers are, and three utilities. No side navigation, no account, no avatar,
 * no search field, no product switcher.
 *
 * The freshness indicator is deliberately in the chrome rather than on a card.
 * It belongs to the whole page — one forecast fetch feeds every event on screen
 * — and it used to be repeated per item, where five copies of the same warning
 * read as five separate problems.
 *
 * The three utility controls each open something real. A bell that cannot
 * notify, or a gear over an empty settings screen, would be exactly the
 * dashboard furniture this interface is supposed to be free of; what they open
 * instead is what Tracker can honestly offer without an account.
 */

export type TrackerView = "tonight" | "upcoming";

interface Props {
  place: SelectedPlace | null;
  onSelectPlace: (place: SelectedPlace) => void;
  view: TrackerView;
  onSelectView: (view: TrackerView) => void;
  /** Minutes since the newest reading behind this page, or null with none. */
  freshnessMinutes: number | null;
  /** Which providers are actually behind the numbers on screen. */
  sources: WeatherSourceInfo[];
  /**
   * Which night is on screen, and how to change it.
   *
   * Beside the place, because date and place are the two things every answer
   * depends on and a reader changing one usually wants to see the other.
   */
  date?: {
    value: string;
    today: string;
    /** The observer's zone, for the calendar's event marks. */
    timeZone: string | null;
    onSelect: (date: string) => void;
  };
}

const VIEWS: { id: TrackerView; label: string }[] = [
  { id: "tonight", label: "Tonight" },
  { id: "upcoming", label: "Upcoming" },
];

function freshnessLabel(minutes: number | null): { text: string; tone: string } {
  if (minutes === null) return { text: "No live data", tone: "unknown" };
  if (minutes < 1) return { text: "Updated just now", tone: "fresh" };
  if (minutes < 60) return { text: `Updated ${Math.round(minutes)} min ago`, tone: "fresh" };
  const hours = Math.round(minutes / 60);
  if (hours < 12) return { text: `Updated ${hours} h ago`, tone: "ageing" };
  return { text: "Data is out of date", tone: "stale" };
}

export function TrackerHeader({
  place,
  onSelectPlace,
  view,
  onSelectView,
  freshnessMinutes,
  sources,
  date,
}: Props) {
  const freshness = freshnessLabel(freshnessMinutes);

  return (
    <header className="tracker-bar tk-header">
      <div className="tk-header-identity">
        {/* The dark-surface variant, unconditionally.
        
            This used to switch on `prefers-color-scheme`, which was the wrong
            question: Tracker's shell is dark whatever the reader's system
            preference is, so a reader who prefers light interfaces got the
            wordmark drawn for a light ground — near-black navy on near-black
            navy — and the logo read as a smudge beside the icon. Caught in a
            headless screenshot, where the default preference is light.
        
            The choice belongs to the surface, and the surface is always dark. */}
        <img
          className="tracker-bar-logo"
          src="/brand/orbit-studio-tracker-logo-dark.png"
          alt="Orbit Studio Tracker"
        />
        {place ? (
          <>
            <span className="tk-header-divider" aria-hidden />
            <TrackerPlace place={place} onSelect={onSelectPlace} />
            {date ? (
              <>
                <span className="tk-header-divider" aria-hidden />
                <TrackerDate
                  date={date.value}
                  today={date.today}
                  timeZone={date.timeZone}
                  onSelect={date.onSelect}
                />
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {place ? (
        <nav className="tracker-nav tk-header-nav" aria-label="Tracker views">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="tracker-nav-item"
              aria-current={view === entry.id ? "page" : undefined}
              onClick={() => onSelectView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      ) : (
        <span />
      )}

      <div className="tk-header-utilities">
        {place ? (
          <p className={`tk-freshness is-${freshness.tone}`} aria-live="polite">
            <i aria-hidden />
            {freshness.text}
          </p>
        ) : null}

        <DialogTrigger>
          <Button className="tk-icon-button" aria-label="Reminders">
            <Bell size={17} aria-hidden />
          </Button>
          <Popover className="tracker-place-popover" placement="bottom end" offset={8}>
            <Dialog className="tracker-place-panel tk-utility-panel" aria-label="Reminders">
              <h2>Reminders</h2>
              <p>
                Tracker has no account and no server, so it cannot push a notification to
                you. What it can do is hand your own calendar an event with an alarm on it —
                that is what <strong>Set reminder</strong> does on any event.
              </p>
              <p>
                The file is generated in this browser and never leaves it. Your calendar,
                not Tracker, does the reminding.
              </p>
            </Dialog>
          </Popover>
        </DialogTrigger>

        <DialogTrigger>
          <Button className="tk-icon-button" aria-label="How to read this page">
            <CircleHelp size={17} aria-hidden />
          </Button>
          <Popover className="tracker-place-popover" placement="bottom end" offset={8}>
            <Dialog className="tracker-place-panel tk-utility-panel" aria-label="How to read this page">
              <h2>How to read this page</h2>
              <ul>
                <li>
                  <strong>The card</strong> is the recommendation: what it is, whether to
                  bother, when to go, and how good the view will be.
                </li>
                <li>
                  <strong>The panel beside it</strong> is the evidence — activity through
                  the night for a shower, a forecast field or an eclipse track for anything
                  geographic.
                </li>
                <li>
                  <strong>The four cards</strong> are the sky over you at that time.
                  &ldquo;Forecast closer to date&rdquo; means no forecast exists yet, not
                  that conditions are fine.
                </li>
                <li>
                  <strong>The list</strong> is everything else worth your time, ordered by
                  what is actually observable from here.
                </li>
              </ul>
            </Dialog>
          </Popover>
        </DialogTrigger>

        <DialogTrigger>
          <Button className="tk-icon-button" aria-label="Data and privacy">
            <Settings size={17} aria-hidden />
          </Button>
          <Popover className="tracker-place-popover" placement="bottom end" offset={8}>
            <Dialog className="tracker-place-panel tk-utility-panel" aria-label="Data and privacy">
              <h2>Data and privacy</h2>
              <p>
                Tracker is accountless. The only thing kept between visits is the place you
                confirmed, rounded, in this browser. No forecast, plan or history is stored.
              </p>
              <h3>Behind this page</h3>
              <ul>
                <li>Positions, phases and eclipse geometry: computed on this device.</li>
                {sources.length === 0 ? (
                  <li>No live provider has answered for this location.</li>
                ) : (
                  sources.map((source) => <li key={source.id}>{source.attribution}</li>)
                )}
              </ul>
              <p className="tk-utility-foot">{freshness.text}.</p>
            </Dialog>
          </Popover>
        </DialogTrigger>
      </div>
    </header>
  );
}
