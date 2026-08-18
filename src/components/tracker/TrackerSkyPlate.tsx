import type { ReactNode } from "react";

/**
 * The frame every sky drawing sits in.
 *
 * There were three of these: the entry screen's arc over a photograph, the
 * planet path on flat panel colour, and the shower timeline on flat panel
 * colour with a different caption voice. Three grounds, three stroke weights,
 * three ways of saying the same kind of thing — in an application whose entry
 * screen captions its graphic "every recommendation is drawn like this".
 *
 * So there is one now, and the photograph is part of it rather than a separate
 * box underneath. That is not decoration: a drawing of the sky belongs on the
 * sky, the plate gives the annotation something to be legible against, and it
 * puts the real photograph in a load-bearing position instead of a bordered
 * rectangle doing nothing. The image is dimmed and gradient-washed hard enough
 * that the drawing always wins — the picture is the ground, never the subject.
 *
 * Credit sits on the plate because the licence requires it to travel with the
 * image and not be moved behind a disclosure.
 */

interface Props {
  /** Ground photograph. Omitted where a phenomenon has none worth using. */
  imageSrc?: string;
  creditName?: string;
  creditHref?: string | null;
  creditLicence?: string;
  /** Sits above the drawing, naming what the reader is looking at. */
  title?: string;
  children: ReactNode;
  caption?: ReactNode;
  /** Phenomenon hue, for the accent on the drawing inside. */
  tone?: string;
}

export function TrackerSkyPlate({
  imageSrc,
  creditName,
  creditHref,
  creditLicence,
  title,
  children,
  caption,
  tone = "neutral",
}: Props) {
  return (
    <figure className="tk-plate" data-tone={tone}>
      <div className="tk-plate-frame">
        {imageSrc ? (
          <div className="tk-plate-ground" aria-hidden>
            <img src={imageSrc} alt="" decoding="async" fetchPriority="high" />
          </div>
        ) : null}

        {title ? <p className="tk-plate-title">{title}</p> : null}

        <div className="tk-plate-drawing">{children}</div>

        {creditName ? (
          <p className="tk-plate-credit">
            {creditHref ? (
              <a href={creditHref} target="_blank" rel="noreferrer noopener">
                {creditName}
              </a>
            ) : (
              creditName
            )}
            {creditLicence ? ` · ${creditLicence}` : ""}
          </p>
        ) : null}
      </div>
      {caption ? <figcaption className="tk-plate-caption">{caption}</figcaption> : null}
    </figure>
  );
}
