import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * One callout, anchored to a real control.
 *
 * ## The precedent
 *
 * LinkedIn's Hopscotch, deliberately — its interaction model, not the archived
 * library. A single small bubble pointing at something actually on screen, the
 * product fully visible and usable behind it, and a way out at every step. Not
 * a slideshow, not a modal, and not a tour that takes the screen away to show
 * you a picture of it.
 *
 * ## Why anchoring to the real control matters
 *
 * A tutorial that describes an interface is a manual. A callout that points at
 * one is a label. The reader learns where the date control *is* rather than
 * that one exists, and when the callout closes they are already looking at the
 * thing they were told about.
 */

export interface CalloutStep {
  id: string;
  /** CSS selector for the control this is about. */
  anchor: string;
  title: string;
  body: string;
  /** Preferred side. The bubble flips and clamps if it will not fit. */
  placement?: "top" | "bottom" | "left" | "right";
}

interface Props {
  step: CalloutStep;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 12;
const BUBBLE_WIDTH = 300;

export function TrackerCallout({ step, index, total, onNext, onBack, onClose }: Props) {
  const [anchorBox, setAnchorBox] = useState<Box | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);

  /**
   * Track the anchor, because the map moves under it.
   *
   * Measured on a frame loop rather than once: these controls sit on a map the
   * reader can pan while the callout is open, the rail can scroll underneath,
   * and the window can be resized. A bubble pointing where a control *was* is
   * worse than no bubble. The state only changes when the box actually moves,
   * so a still map costs one comparison a frame and no renders.
   */
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const element = document.querySelector(step.anchor);
      if (element) {
        const rect = element.getBoundingClientRect();
        setAnchorBox((current) =>
          current &&
          Math.abs(current.top - rect.top) < 0.5 &&
          Math.abs(current.left - rect.left) < 0.5 &&
          Math.abs(current.width - rect.width) < 0.5
            ? current
            : { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        );
      } else {
        setAnchorBox(null);
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [step.anchor]);

  /** Focus moves to the bubble, and back where it came from on close. */
  useEffect(() => {
    previousFocus.current = document.activeElement;
    bubble.current?.focus();
    return () => {
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus();
    };
  }, [step.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!anchorBox) return null;

  /**
   * Where the bubble goes, kept inside the viewport.
   *
   * The requested side first; the opposite if it would run off; then clamped,
   * so a callout anchored to something in a corner is still readable rather
   * than half off the screen.
   */
  const preferred = step.placement ?? "bottom";
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(BUBBLE_WIDTH, viewportWidth - 24);
  const height = bubble.current?.offsetHeight ?? 170;

  let top: number;
  let left: number;
  if (preferred === "top" || preferred === "bottom") {
    const below = anchorBox.top + anchorBox.height + GAP;
    const above = anchorBox.top - height - GAP;
    top = preferred === "bottom" ? below : above;
    if (top + height > viewportHeight - 8) top = above;
    if (top < 8) top = below;
    left = anchorBox.left + anchorBox.width / 2 - width / 2;
  } else {
    const rightOf = anchorBox.left + anchorBox.width + GAP;
    const leftOf = anchorBox.left - width - GAP;
    left = preferred === "right" ? rightOf : leftOf;
    if (left + width > viewportWidth - 8) left = leftOf;
    if (left < 8) left = rightOf;
    top = anchorBox.top + anchorBox.height / 2 - height / 2;
  }
  left = Math.max(12, Math.min(left, viewportWidth - width - 12));
  top = Math.max(12, Math.min(top, viewportHeight - height - 12));

  return (
    <>
      {/* A ring around the real control rather than a mask over the product.
          The map stays visible and usable; this only says "here". */}
      <div
        className="tk-callout-ring"
        aria-hidden
        style={{
          top: anchorBox.top - 6,
          left: anchorBox.left - 6,
          width: anchorBox.width + 12,
          height: anchorBox.height + 12,
        }}
      />
      <div
        ref={bubble}
        className="tk-callout"
        role="dialog"
        aria-labelledby={`tk-callout-title-${step.id}`}
        tabIndex={-1}
        style={{ top, left, width }}
      >
        <div className="tk-callout-head">
          <h2 id={`tk-callout-title-${step.id}`}>{step.title}</h2>
          <button
            type="button"
            className="tk-icon-button"
            onClick={onClose}
            aria-label="Close the tour"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <p className="tk-callout-body">{step.body}</p>
        <div className="tk-callout-foot">
          <span className="tk-callout-count">{`${index + 1} of ${total}`}</span>
          <span className="tk-callout-actions">
            {index > 0 ? (
              <button type="button" className="tk-callout-back" onClick={onBack}>
                Back
              </button>
            ) : null}
            <button type="button" className="tk-callout-next" onClick={onNext}>
              {index === total - 1 ? "Done" : "Next"}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}
