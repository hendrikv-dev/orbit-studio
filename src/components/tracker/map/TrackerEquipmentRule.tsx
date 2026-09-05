import { useCallback, useEffect, useRef, useState } from "react";
import { Binoculars, Check, Eye, Telescope } from "lucide-react";

import { EQUIPMENT_RULES, type EquipmentRule } from "../../../data/tracker/observingRules";
import { useDismissableSurface } from "../../../data/tracker/dismissable";

/**
 * What the reader is observing with.
 *
 * ## Why this is here and not in Layers
 *
 * Layers is what the map draws. Equipment is not drawn anywhere: it decides
 * what is *eligible*, which puts it beside the place and the date as one of the
 * three things a Tracker answer depends on. So it sits in the top bar with
 * them, not in the stack that changes the map's appearance.
 *
 * ## Why it is this small
 *
 * Because the brief for it is one rule with three values, and the temptation
 * with equipment is a settings page: aperture, focal length, eyepieces, mounts.
 * None of that changes the answer Tracker gives — a 200 mm reflector and a 250
 * mm reflector see the same list — and all of it would turn one question into a
 * form. Three named tiers is the whole model.
 */

const ICONS = { eyes: Eye, binoculars: Binoculars, telescope: Telescope } as const;

interface Props {
  rule: EquipmentRule;
  onSelect: (rule: EquipmentRule) => void;
}

export function TrackerEquipmentRule({ rule, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Like every other transient surface: a click on the map dismisses it rather
  // than moving the reader's observing location.
  useDismissableSurface(open, close);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const current = EQUIPMENT_RULES.find((entry) => entry.id === rule) ?? EQUIPMENT_RULES[0];
  const Icon = ICONS[current.id];

  return (
    <div className="tk-equipment" ref={root}>
      <button
        type="button"
        className="tk-equipment-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        // The label names the rule as well as the control, because "Naked eye"
        // alone reads as a fact about the sky rather than a setting.
        aria-label={`Observing with: ${current.label}. Change`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={15} aria-hidden />
        <span className="tk-equipment-current" aria-hidden>
          {current.label}
        </span>
      </button>

      {open ? (
        <div className="tk-equipment-panel" role="dialog" aria-label="Observing with">
          <p className="tk-equipment-lead">
            Tracker only offers what you can actually see. Say what you are using and the
            list changes.
          </p>
          <ul>
            {EQUIPMENT_RULES.map((entry) => {
              const EntryIcon = ICONS[entry.id];
              const selected = entry.id === rule;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={selected}
                    className="tk-equipment-option"
                    onClick={() => {
                      onSelect(entry.id);
                      setOpen(false);
                    }}
                  >
                    <EntryIcon size={16} aria-hidden />
                    <span className="tk-equipment-option-text">
                      <span className="tk-equipment-option-name">{entry.label}</span>
                      <span className="tk-equipment-option-blurb">{entry.blurb}</span>
                    </span>
                    <span className="tk-equipment-check" aria-hidden>
                      {selected ? <Check size={14} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
