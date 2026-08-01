import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, Github, Heart, MoreHorizontal } from "lucide-react";
import { orbitStudioRepositoryUrl, orbitStudioSponsorUrl } from "../../lib/projectLinks";

export type OrbitAppId = "explorer" | "playground";

interface OrbitAppMenuProps {
  activeApp: OrbitAppId;
  onOpenHome: () => void;
  onOpenExplorer: () => void;
  onOpenPlayground: () => void;
  onHideInterface: () => void;
}

interface DestinationItemProps {
  active?: boolean;
  iconSrc: string;
  label: string;
  onSelect: () => void;
}

function DestinationItem({ active = false, iconSrc, label, onSelect }: DestinationItemProps) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={active ? "active" : ""}
      role="menuitem"
      type="button"
      onClick={onSelect}
    >
      <img alt="" aria-hidden="true" src={iconSrc} />
      <span>{label}</span>
      {active && <Check aria-hidden="true" className="orbit-app-menu-check" size={15} />}
    </button>
  );
}

export function OrbitAppMenu({
  activeApp,
  onOpenHome,
  onOpenExplorer,
  onOpenPlayground,
  onHideInterface,
}: OrbitAppMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const select = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="orbit-app-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open Orbit Studio menu"
        className={`orbit-app-menu-trigger ${open ? "active" : ""}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal aria-hidden="true" size={19} />
      </button>

      {open && (
        <div aria-label="Orbit Studio navigation" className="orbit-app-menu-panel" role="menu">
          <DestinationItem
            iconSrc="/brand/orbit-studio-icon.png"
            label="Orbit Studio Home"
            onSelect={() => select(onOpenHome)}
          />
          <DestinationItem
            active={activeApp === "explorer"}
            iconSrc="/brand/orbit-studio-explorer-icon.png"
            label="Explorer"
            onSelect={() => activeApp === "explorer" ? setOpen(false) : select(onOpenExplorer)}
          />
          <DestinationItem
            active={activeApp === "playground"}
            iconSrc="/brand/orbit-studio-playground-icon.png"
            label="Playground"
            onSelect={() => activeApp === "playground" ? setOpen(false) : select(onOpenPlayground)}
          />

          <div aria-hidden="true" className="orbit-app-menu-divider" />

          {/* Project links are grouped together: both leave the app, so they read
              as one kind of action. Support sits beside GitHub rather than in its
              own group, which would give it emphasis it should not have. */}
          <a
            href={orbitStudioRepositoryUrl}
            rel="noreferrer"
            role="menuitem"
            target="_blank"
            onClick={() => setOpen(false)}
          >
            <Github aria-hidden="true" size={17} />
            <span>GitHub</span>
          </a>

          <a
            href={orbitStudioSponsorUrl}
            rel="noreferrer"
            role="menuitem"
            target="_blank"
            onClick={() => setOpen(false)}
          >
            <Heart aria-hidden="true" size={17} />
            <span>Support Orbit Studio</span>
          </a>

          <div aria-hidden="true" className="orbit-app-menu-divider" />

          {/* View control last: it acts on the current screen, not the project. */}
          <button role="menuitem" type="button" onClick={() => select(onHideInterface)}>
            <EyeOff aria-hidden="true" size={17} />
            <span>Hide interface</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function ShowInterfaceButton({ onShow }: { onShow: () => void }) {
  return (
    <button className="orbit-show-interface" type="button" onClick={onShow}>
      <Eye aria-hidden="true" size={16} />
      <span>Show interface</span>
      <kbd>Esc</kbd>
    </button>
  );
}
