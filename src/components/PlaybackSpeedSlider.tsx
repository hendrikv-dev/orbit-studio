import { useMemo } from "react";

const MIN_SPEED = 1;
export const MAX_SPEED = 3000;
// Exported so the review harness can be pinned to the speeds this slider actually offers.
export const SPEED_ANCHORS = [1, 10, 100, 1000, 3000] as const;
const SLIDER_MAX = 1000;
const SNAP_DISTANCE = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function speedToSlider(speed: number): number {
  const normalized = Math.log(clamp(speed, MIN_SPEED, MAX_SPEED) / MIN_SPEED) /
    Math.log(MAX_SPEED / MIN_SPEED);
  return Math.round(normalized * SLIDER_MAX);
}

export function sliderToSpeed(position: number): number {
  const normalized = clamp(position, 0, SLIDER_MAX) / SLIDER_MAX;
  return Math.round(MIN_SPEED * Math.pow(MAX_SPEED / MIN_SPEED, normalized));
}

function snappedSpeed(position: number): number {
  const nearestAnchor = SPEED_ANCHORS
    .map((speed) => ({ speed, distance: Math.abs(speedToSlider(speed) - position) }))
    .sort((a, b) => a.distance - b.distance)[0];

  return nearestAnchor.distance <= SNAP_DISTANCE
    ? nearestAnchor.speed
    : sliderToSpeed(position);
}

export function PlaybackSpeedSlider({
  value,
  onChange,
  label = "Playback speed",
  className = "",
}: {
  value: number;
  onChange: (speed: number) => void;
  label?: string;
  className?: string;
}) {
  const sliderValue = useMemo(() => speedToSlider(value), [value]);

  return (
    <label className={`playback-speed-slider ${className}`.trim()}>
      <span className="playback-speed-slider-heading">
        <span>Speed</span>
        <output>{Math.round(value).toLocaleString()}×</output>
      </span>
      <span className="playback-speed-slider-track">
        <input
          aria-label={label}
          min={0}
          max={SLIDER_MAX}
          step={1}
          type="range"
          value={sliderValue}
          onChange={(event) => onChange(snappedSpeed(Number(event.target.value)))}
        />
        <span className="playback-speed-slider-anchors" aria-hidden="true">
          {SPEED_ANCHORS.map((speed) => (
            <i key={speed} style={{ left: `${speedToSlider(speed) / 10}%` }} />
          ))}
        </span>
      </span>
      <span className="playback-speed-slider-labels" aria-hidden="true">
        {SPEED_ANCHORS.map((speed, index) => (
          <span
            className={index === 0 ? "first" : index === SPEED_ANCHORS.length - 1 ? "last" : ""}
            key={speed}
            style={{ left: `${speedToSlider(speed) / 10}%` }}
          >
            {speed === 1000 ? "1k×" : speed === 3000 ? "3k×" : `${speed}×`}
          </span>
        ))}
      </span>
    </label>
  );
}
