import { useCallback, useEffect, useRef, useState } from "react";
import { Binoculars, Camera, Check, Eye, Telescope } from "lucide-react";

import { EQUIPMENT_RULES, type EquipmentRule } from "../../../data/tracker/observingRules";
import type { StoredTelescopeSetups, TelescopeSetup } from "../../../data/tracker/viewingCapability";
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
 * The primary decision is one of four capability tiers. Optional telescope
 * details refine the same answer only after the reader deliberately asks for
 * them; they never become onboarding or a separate expert mode.
 */

const ICONS = { eyes: Eye, binoculars: Binoculars, telescope: Telescope, imaging: Camera } as const;

interface Props {
  rule: EquipmentRule;
  onSelect: (rule: EquipmentRule) => void;
  telescopeSetups: StoredTelescopeSetups;
  onTelescopeSetupsChange: (value: StoredTelescopeSetups) => void;
}

export function TrackerEquipmentRule({ rule, onSelect, telescopeSetups, onTelescopeSetupsChange }: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Like every other transient surface: a click on the map dismisses it rather
  // than moving the reader's observing location.
  useDismissableSurface(open, close);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

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
        ref={trigger}
        type="button"
        className="tk-equipment-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        // The label names the rule as well as the control, because "Naked eye"
        // alone reads as a fact about the sky rather than a setting.
        aria-label={`Viewing: ${current.label}. Change`}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon size={15} aria-hidden />
        <span className="tk-equipment-current" aria-hidden>
          {current.label}
        </span>
      </button>

      {open ? (
        <div className="tk-equipment-panel" role="dialog" aria-label="Viewing capability">
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
                      if (entry.id !== "telescope") setOpen(false);
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
          {rule === "telescope" ? (
            <TelescopeSetupSelector value={telescopeSetups} onChange={onTelescopeSetupsChange} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TelescopeSetupSelector({
  value,
  onChange,
}: {
  value: StoredTelescopeSetups;
  onChange: (value: StoredTelescopeSetups) => void;
}) {
  const [configuring, setConfiguring] = useState(false);
  const [name, setName] = useState("My telescope");
  const [type, setType] = useState<TelescopeSetup["type"]>("reflector");
  const [aperture, setAperture] = useState("200");
  const [focalLength, setFocalLength] = useState("1200");
  const [eyepieces, setEyepieces] = useState("25, 10");
  const [mount, setMount] = useState<TelescopeSetup["mount"]>("alt-az");
  const [tracking, setTracking] = useState(false);
  const [goto, setGoto] = useState(false);

  const save = () => {
    const apertureMm = Number(aperture);
    const focalLengthMm = focalLength.trim() ? Number(focalLength) : null;
    const parsedEyepieces = eyepieces
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isFinite(entry) && entry >= 1 && entry <= 100);
    if (!name.trim() || !Number.isFinite(apertureMm) || apertureMm < 20 || apertureMm > 1_500) return;
    if (focalLengthMm !== null && (!Number.isFinite(focalLengthMm) || focalLengthMm < 50 || focalLengthMm > 20_000)) return;
    const setup: TelescopeSetup = {
      id: `telescope-${Date.now().toString(36)}`,
      name: name.trim(),
      type,
      apertureMm,
      focalLengthMm,
      eyepiecesMm: parsedEyepieces,
      mount,
      tracking,
      goto,
    };
    onChange({ version: 1, activeId: setup.id, setups: [...value.setups, setup] });
    setConfiguring(false);
  };

  return (
    <div className="tk-equipment-setup">
      {value.setups.length > 0 ? (
        <label>
          Saved telescope
          <select
            value={value.activeId ?? ""}
            onChange={(event) => onChange({ ...value, activeId: event.target.value })}
          >
            {value.setups.map((setup) => (
              <option key={setup.id} value={setup.id}>{setup.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <p>Telescope targets are available now. Adding your setup is optional.</p>
      )}
      <button type="button" className="tk-equipment-configure" onClick={() => setConfiguring((open) => !open)}>
        {configuring ? "Skip setup" : value.setups.length > 0 ? "Add another telescope" : "Add telescope details"}
      </button>
      {configuring ? (
        <div className="tk-equipment-form" aria-label="Optional telescope details">
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Type<select value={type} onChange={(event) => setType(event.target.value as TelescopeSetup["type"])}>
            <option value="reflector">Reflector</option><option value="refractor">Refractor</option>
            <option value="catadioptric">Catadioptric</option><option value="other">Other</option>
          </select></label>
          <label>Aperture (mm)<input inputMode="decimal" value={aperture} onChange={(event) => setAperture(event.target.value)} /></label>
          <label>Focal length (mm, optional)<input inputMode="decimal" value={focalLength} onChange={(event) => setFocalLength(event.target.value)} /></label>
          <label>Eyepieces (mm, comma separated)<input value={eyepieces} onChange={(event) => setEyepieces(event.target.value)} /></label>
          <label>Mount<select value={mount} onChange={(event) => setMount(event.target.value as TelescopeSetup["mount"])}>
            <option value="alt-az">Alt-az</option><option value="equatorial">Equatorial</option><option value="other">Other</option>
          </select></label>
          <label className="tk-equipment-check-row"><input type="checkbox" checked={tracking} onChange={(event) => setTracking(event.target.checked)} /> Tracking</label>
          <label className="tk-equipment-check-row"><input type="checkbox" checked={goto} onChange={(event) => setGoto(event.target.checked)} /> GoTo</label>
          <button type="button" className="tk-equipment-save" onClick={save}>Save telescope</button>
        </div>
      ) : null}
    </div>
  );
}
