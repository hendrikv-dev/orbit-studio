import { Compass, Map as MapIcon, MoonStar } from "lucide-react";

export type TrackerPrimaryMode = "map" | "tonight" | "sky";

interface Props {
  current: TrackerPrimaryMode;
  skyAvailable: boolean;
  skyLabel: string;
  onMap: () => void;
  onTonight: () => void;
  onSky: () => void;
}

/**
 * The three ways to use one Tracker plan.
 *
 * These are deliberately not routes to three data systems. Map and Tonight
 * share the URL-backed observing context, while Sky adds only the selected
 * target needed for pointing or preview. Upcoming remains planning inside
 * Tonight rather than becoming a fourth primary destination.
 */
export function TrackerModeNav({
  current,
  skyAvailable,
  skyLabel,
  onMap,
  onTonight,
  onSky,
}: Props) {
  const items = [
    { id: "map" as const, label: "Map", Icon: MapIcon, onSelect: onMap, available: true },
    { id: "tonight" as const, label: "Tonight", Icon: MoonStar, onSelect: onTonight, available: true },
    { id: "sky" as const, label: "Sky", Icon: Compass, onSelect: onSky, available: skyAvailable },
  ];
  return (
    <nav className="tk-mode-nav" aria-label="Tracker modes">
      {items.map(({ id, label, Icon, onSelect, available }) => (
        <button
          key={id}
          type="button"
          aria-current={current === id ? "page" : undefined}
          aria-label={id === "sky" ? skyLabel : label}
          disabled={!available}
          onClick={onSelect}
        >
          <Icon size={15} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
