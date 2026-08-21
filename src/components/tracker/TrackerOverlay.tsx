import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The one drill-in.
 *
 * Everything secondary — the full sky map, the full forecast map — opens here
 * rather than being added to the page. That is the rule that keeps the page one
 * screen: additional information exists, so the temptation is always to append
 * a section, and appending sections is how an observing tool becomes a
 * scrolling dashboard.
 *
 * A native `<dialog>` rather than a hand-rolled layer: it brings the top layer,
 * the focus trap, inert background content and Escape without any of it having
 * to be reimplemented, and those are exactly the parts a hand-rolled overlay
 * gets wrong.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function TrackerOverlay({ open, onClose, title, subtitle, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  /**
   * Follow the element rather than fight it.
   *
   * The first version cancelled the browser's own Escape handling and drove the
   * close from React state instead. That is one source of truth too many: the
   * dialog closes itself for reasons React does not see, and the two states
   * drifted the moment anything else changed underneath — an overlay left open
   * over a different event than the one it was opened for.
   *
   * Now the element owns open/closed and React listens.
   */
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const handleClose = () => onClose();
    node.addEventListener("close", handleClose);
    return () => node.removeEventListener("close", handleClose);
  }, [onClose]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className="tk-overlay"
      aria-label={title}
      // Clicking the backdrop closes. The dialog element reports backdrop
      // clicks as clicks on itself, so the target check is what distinguishes
      // them from clicks on the content inside.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="tk-overlay-panel">
        <header className="tk-overlay-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="tk-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="tk-overlay-body">{children}</div>
      </div>
    </dialog>
  );
}
