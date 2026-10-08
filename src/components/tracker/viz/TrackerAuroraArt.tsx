/**
 * The aurora hero image, drawn rather than photographed.
 *
 * Every other phenomenon in Tracker has a real photograph behind it, taken by a
 * named photographer under a licence the repository can show. There is no such
 * image of an aurora in the set, and the two obvious shortcuts are both worse
 * than drawing one:
 *
 * - Using the dark-sky photograph as a stand-in puts a picture of no aurora on
 *   a card about aurora, which is a claim about the sky that happens to be
 *   false.
 * - Shipping an unattributed image found elsewhere is exactly the thing this
 *   project's provenance rules exist to stop.
 *
 * So this is a drawing, it is labelled as a forecast visualisation rather than
 * as a photograph, and its intensity comes from the nowcast probability the
 * page is already showing. A quiet night draws a faint band low down; a storm
 * draws curtains overhead. It is the same value the map is drawn from, so the
 * picture cannot disagree with the number beside it.
 *
 * A cleared aurora photograph would be better here, and this is a deliberate
 * placeholder for one rather than a preference.
 */

export function TrackerAuroraArt({ probabilityPercent }: { probabilityPercent: number | null }) {
  // Height and opacity of the curtains, from the forecast. Clamped so a null
  // reading still draws something recognisable rather than an empty frame — but
  // a faint one, because "nothing known" should not look like a good night.
  const strength = Math.max(0.12, Math.min(1, (probabilityPercent ?? 8) / 60));
  const curtainTop = 118 - strength * 62;
  const glow = 0.22 + strength * 0.5;

  return (
    <div className="tracker-media tracker-media-photo tk-aurora-art">
      <svg
        viewBox="0 0 480 270"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={
          probabilityPercent === null
            ? "A drawing of aurora over a horizon, at a nominal intensity because no forecast was available."
            : `A drawing of aurora over a horizon, at the intensity NOAA's ${probabilityPercent}% nowcast implies.`
        }
      >
        <defs>
          <linearGradient id="tk-aurora-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#060a16" />
            <stop offset="62%" stopColor="#0a1428" />
            <stop offset="100%" stopColor="#101c30" />
          </linearGradient>
          <linearGradient id="tk-aurora-curtain" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7ef0c0" stopOpacity="0" />
            <stop offset="35%" stopColor="#63e0b4" stopOpacity={glow} />
            <stop offset="78%" stopColor="#3fa8d8" stopOpacity={glow * 0.7} />
            <stop offset="100%" stopColor="#2c5c9a" stopOpacity="0" />
          </linearGradient>
          <filter id="tk-aurora-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>

        <rect x="0" y="0" width="480" height="270" fill="url(#tk-aurora-sky)" />

        {/* Stars, on a fixed lattice rather than at random, so the drawing is
            identical between renders and cannot flicker on a re-render. */}
        <g fill="#dfe9f7">
          {Array.from({ length: 46 }, (_, index) => {
            const x = ((index * 97) % 471) + 4;
            const y = ((index * 53) % 150) + 6;
            const r = index % 7 === 0 ? 1.3 : 0.75;
            return <circle key={index} cx={x} cy={y} r={r} opacity={index % 3 === 0 ? 0.75 : 0.4} />;
          })}
        </g>

        <g filter="url(#tk-aurora-blur)">
          <path
            d={`M -20 200 C 60 ${curtainTop + 30}, 110 ${curtainTop}, 178 ${curtainTop + 22}
                C 250 ${curtainTop + 46}, 300 ${curtainTop - 6}, 372 ${curtainTop + 18}
                C 428 ${curtainTop + 36}, 470 ${curtainTop + 60}, 500 200 L 500 210 L -20 210 Z`}
            fill="url(#tk-aurora-curtain)"
          />
          <path
            d={`M -20 205 C 80 ${curtainTop + 74}, 150 ${curtainTop + 52}, 232 ${curtainTop + 70}
                C 320 ${curtainTop + 90}, 400 ${curtainTop + 58}, 500 205 L 500 212 L -20 212 Z`}
            fill="url(#tk-aurora-curtain)"
            opacity="0.6"
          />
        </g>

        {/* A horizon, so the drawing reads as a view from the ground rather than
            as an abstract gradient. */}
        <path
          d="M -10 208 L 52 196 L 92 205 L 148 190 L 196 203 L 250 192 L 302 206 L 356 194 L 410 204 L 490 197 L 490 280 L -10 280 Z"
          fill="#04070e"
        />
      </svg>
    </div>
  );
}
