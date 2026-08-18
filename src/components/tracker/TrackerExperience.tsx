import { useEffect, useRef, useState } from "react";

/**
 * What the phenomenon actually looks like, as real footage where it exists.
 *
 * The experience layer answers "is this worth going outside for" in a way no
 * chart can. It is deliberately separate from the observing instrument: this
 * says what a Perseid looks like, the instrument says what will happen here
 * tonight. Merging them would make historical footage read as a forecast.
 *
 * Nothing here is synthesised. There are no particle meteors, no procedural
 * aurora and no drifting starfields — if a real, licence-verified asset is not
 * available for a phenomenon, this falls back to the still and says nothing.
 * A convincing fake is worse than an honest photograph, because a reader
 * cannot tell it was invented.
 */

export interface ExperienceMedia {
  /** Motion, where a verified asset exists. */
  videoSrc?: string;
  /** Always present: shown before playback, and if playback fails or is declined. */
  posterSrc: string;
  /** Alt text for the still. */
  alt: string;
  credit: string;
  licence: string;
  sourceUrl: string;
  /**
   * True where this is representative footage of the phenomenon rather than
   * anything recorded here or tonight. Stated in the interface, because the
   * difference between "this is what Perseids look like" and "this is your sky
   * tonight" is the difference between context and a false promise.
   */
  representative: boolean;
}

interface Props {
  media: ExperienceMedia;
  className?: string;
}

export function TrackerExperience({ media, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  // Honours the OS setting rather than autoplaying regardless. Read once at
  // mount and followed if it changes, so a reader who turns motion off does not
  // have to reload to be listened to.
  const [reduceMotion, setReduceMotion] = useState(
    () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const query = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setReduceMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Switching events must not leave the previous phenomenon's footage playing
  // under the new one's name. Keyed on the source so the element is rebuilt.
  useEffect(() => {
    setFailed(false);
  }, [media.videoSrc]);

  // Play is asked for explicitly rather than left to the autoplay attribute.
  // With a poster set, Chrome was holding the element at readyState 0 — poster
  // shown, nothing loaded, nothing played — so the motion layer was present in
  // the DOM and invisible in the product. A rejected promise means autoplay was
  // refused, which is a fallback rather than an error: the poster stands in.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduceMotion || !media.videoSrc) return;
    video.load();
    void video.play().catch(() => setFailed(true));
  }, [media.videoSrc, reduceMotion]);

  const showVideo = Boolean(media.videoSrc) && !reduceMotion && !failed;

  return (
    <figure className={`tk-exp ${className ?? ""}`}>
      {showVideo ? (
        <video
          key={media.videoSrc}
          ref={videoRef}
          className="tk-exp-media"
          src={media.videoSrc}
          poster={media.posterSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-label={media.alt}
          onError={() => setFailed(true)}
        />
      ) : (
        <img className="tk-exp-media" src={media.posterSrc} alt={media.alt} decoding="async" />
      )}

      <figcaption className="tk-exp-credit">
        {media.representative ? <span className="tk-exp-tag">Not tonight's sky</span> : null}
        <a href={media.sourceUrl} target="_blank" rel="noreferrer noopener">
          {media.credit}
        </a>{" "}
        · {media.licence}
      </figcaption>
    </figure>
  );
}

/**
 * Verified assets, by phenomenon.
 *
 * Each entry was checked as an individual file rather than inherited from the
 * host: the Perseid clip's Commons record was queried directly and returns CC0
 * 1.0, Bautsch, own work. A licence held by one file on Wikimedia says nothing
 * about the next one.
 *
 * Phenomena with no verified motion asset simply have none. They are not given
 * a stand-in.
 */
export function experienceFor(kind: string): ExperienceMedia | null {
  if (kind === "meteors") {
    return {
      videoSrc: "/media/perseids-realtime-bautsch-cc0.webm",
      posterSrc: "/media/perseids-realtime-bautsch-cc0-poster.webp",
      alt: "Real-time footage of Perseid meteors crossing a dark sky.",
      credit: "Bautsch, Wikimedia Commons",
      licence: "CC0 1.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Perseiden.Echtzeit.2020-08-12.webm",
      representative: true,
    };
  }
  return null;
}
