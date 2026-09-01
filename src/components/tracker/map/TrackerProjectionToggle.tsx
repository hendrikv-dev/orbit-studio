import { useRef, type KeyboardEvent } from "react";
import { Globe, Map as MapIcon } from "lucide-react";

/**
 * Mercator or globe, as one control with two states.
 *
 * ## Why it is not in the control stack on the right
 *
 * That stack is about *where the map is looking* — zoom, recentre, locate — and
 * a projection is not a viewport. It is closer to what Layers is: a statement
 * about how the map is drawn. But Layers changes what is on the map and this
 * changes the map itself, so it sits on its own, under the elements that name
 * what the reader is looking at rather than beside the ones that move it.
 *
 * ## Why a segmented control rather than a switch
 *
 * Because both states are named. A single button that toggles has to be
 * labelled with either the state it is in or the state it goes to, and readers
 * disagree about which — this labels both and marks the one that is current,
 * which is also what makes it announce properly.
 *
 * Two mutually exclusive options is a radio group, so it behaves like one: a
 * single tab stop on whichever is selected, and the arrow keys move between
 * them and select as they go. Declaring the role without the keyboard model
 * would announce a promise the control does not keep.
 */

interface Props {
  projection: "mercator" | "globe";
  onSelect: (projection: "mercator" | "globe") => void;
}

const MODES = [
  { id: "mercator" as const, label: "2D", icon: MapIcon, description: "Flat map" },
  { id: "globe" as const, label: "3D", icon: Globe, description: "Globe" },
];

export function TrackerProjectionToggle({ projection, onSelect }: Props) {
  const group = useRef<HTMLDivElement>(null);

  /** Arrows move and select; Home and End go to the ends, as a radio group does. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = MODES.findIndex((mode) => mode.id === projection);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % MODES.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + MODES.length) % MODES.length;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = MODES.length - 1;
    else return;
    event.preventDefault();
    onSelect(MODES[next].id);
    // Focus follows selection, which is what makes the arrow keys usable
    // rather than merely functional.
    group.current
      ?.querySelectorAll<HTMLButtonElement>(".tk-projection-option")
      [next]?.focus();
  };

  return (
    <div
      className="tk-projection"
      role="radiogroup"
      aria-label="Map projection"
      ref={group}
      onKeyDown={onKeyDown}
    >
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const current = projection === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={current}
            // One tab stop for the group, on whichever option is selected.
            tabIndex={current ? 0 : -1}
            className="tk-projection-option"
            data-current={current ? "true" : "false"}
            // The visible label is two characters, which is not a name. The
            // accessible name says what the two characters mean.
            aria-label={`${mode.description} (${mode.label})`}
            onClick={() => onSelect(mode.id)}
          >
            <Icon size={14} aria-hidden />
            <span aria-hidden>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}
