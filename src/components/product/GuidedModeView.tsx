import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  Gauge,
  Pause,
  Play,
} from "lucide-react";
import type { GuidedMissionFrame, GuidedSequence } from "../../data/productFlow";
import { SimulationScene } from "../../rendering/SimulationScene";
import { AppErrorBoundary } from "../AppErrorBoundary";

type GuidedPlaybackMode = "default" | "fast";

interface GuidedModeViewProps {
  sequence: GuidedSequence;
  activeEventIndex: number;
  sequencePlaying: boolean;
  missionFrame: GuidedMissionFrame;
  timelineIso: string;
  timelineProgress: number;
  playbackMode: GuidedPlaybackMode;
  totalPlaybackLabel: string;
  onBackToLibrary: () => void;
  onOpenOrbitMode: () => void;
  onPreviousEvent: () => void;
  onNextEvent: () => void;
  onJumpToEvent: (eventIndex: number) => void;
  onToggleSequence: () => void;
  onSetPlaybackMode: (mode: GuidedPlaybackMode) => void;
  onReadStory: () => void;
}

function formatMissionTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

export function GuidedModeView({
  sequence,
  activeEventIndex,
  sequencePlaying,
  missionFrame,
  timelineIso,
  timelineProgress,
  playbackMode,
  totalPlaybackLabel,
  onBackToLibrary,
  onOpenOrbitMode,
  onPreviousEvent,
  onNextEvent,
  onJumpToEvent,
  onToggleSequence,
  onSetPlaybackMode,
  onReadStory,
}: GuidedModeViewProps) {
  const activeEvent = sequence.events[activeEventIndex];
  const frame = missionFrame;
  const atStart = activeEventIndex === 0;
  const atEnd = activeEventIndex === sequence.events.length - 1;

  return (
    <main className="guided-shell">
      <header className="guided-header">
        <button type="button" onClick={onBackToLibrary}>
          <ArrowLeft size={16} />
          <span>Library</span>
        </button>
        <div className="guided-title-block">
          <span>Guided Mode</span>
          <strong>{sequence.item.title}</strong>
        </div>
        <button type="button" onClick={onReadStory}>
          <BookOpen size={16} />
          <span>Read Story</span>
        </button>
      </header>

      <section className="guided-stage">
        <aside className="guided-event-panel" aria-label="Mission events">
          <div className="guided-panel-heading">
            <span>Event List</span>
            <strong>
              {activeEventIndex + 1}/{sequence.events.length}
            </strong>
          </div>
          <div className="guided-clock-panel">
            <Clock3 size={15} />
            <div>
              <span>Mission Time</span>
              <strong>{formatMissionTimestamp(timelineIso)}</strong>
            </div>
          </div>
          <div className="guided-event-list">
            {sequence.events.map((event, index) => (
              <button
                className={index === activeEventIndex ? "active" : ""}
                key={event.id}
                type="button"
                onClick={() => onJumpToEvent(index)}
              >
                <span>{event.timeLabel}</span>
                <strong>{event.title}</strong>
              </button>
            ))}
          </div>
          <div className="guided-transport">
            <button type="button" disabled={atStart} title="Previous event" onClick={onPreviousEvent}>
              <ChevronLeft size={17} />
            </button>
            <button
              className="primary"
              type="button"
              title={sequencePlaying ? "Pause sequence" : "Play sequence"}
              onClick={onToggleSequence}
            >
              {sequencePlaying ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button type="button" disabled={atEnd} title="Next event" onClick={onNextEvent}>
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="playback-mode-row" aria-label="Playback speed">
            <button
              className={playbackMode === "default" ? "active" : ""}
              type="button"
              onClick={() => onSetPlaybackMode("default")}
            >
              <Clock3 size={14} />
              <span>Default</span>
            </button>
            <button
              className={playbackMode === "fast" ? "active" : ""}
              type="button"
              onClick={() => onSetPlaybackMode("fast")}
            >
              <Gauge size={14} />
              <span>Fast</span>
            </button>
          </div>
          <p className="playback-note">Full playback: {totalPlaybackLabel}</p>
        </aside>

        <section className="guided-simulation" aria-label="Guided simulation state">
          <AppErrorBoundary
            variant="renderer"
            fallbackTitle="Guided simulation failed to start"
            fallbackMessage="The Guided Mode controls are still available, but the 3D viewport crashed while initializing."
          >
            <SimulationScene missionFrame={frame} />
          </AppErrorBoundary>
          <div className={`mission-map-overlay focus-${frame.focus}`} aria-hidden="true">
            <div className="mission-map-earth">
              <span>Earth</span>
            </div>
            {frame.moonVisible && (
              <div
                className="mission-map-moon"
                style={{
                  left: `${frame.moonMap.x}%`,
                  top: `${frame.moonMap.y}%`,
                  transform: `translate(-50%, -50%) scale(${frame.moonMap.scale})`,
                }}
              >
                <span>Moon</span>
              </div>
            )}
            {frame.spacecraftVisible && (
              <div
                className="mission-map-spacecraft"
                style={{
                  left: `${frame.spacecraftMap.x}%`,
                  top: `${frame.spacecraftMap.y}%`,
                }}
              >
                <i />
                <span>{frame.spacecraftLabel}</span>
              </div>
            )}
            <div className="mission-map-trajectory" />
          </div>
          <div className="guided-timeline-bar">
            <div style={{ width: `${Math.max(0, Math.min(1, timelineProgress)) * 100}%` }} />
          </div>
        </section>

        <aside className="mission-state-panel" aria-label="Mission state">
          <div>
            <span>Current Event</span>
            <h2>{activeEvent.title}</h2>
            <p>{activeEvent.stateNote}</p>
          </div>
          <div>
            <span>Mission Context</span>
            <p>{activeEvent.context}</p>
          </div>
          <div className="mission-frame-readout">
            <span>Camera Framing</span>
            <strong>{frame.cameraLabel}</strong>
            <p>
              {frame.primaryBody} - {frame.distanceLabel}
            </p>
          </div>
          <button className="primary open-orbit-button" type="button" onClick={onOpenOrbitMode}>
            <Compass size={17} />
            <span>Open In Orbit Mode</span>
          </button>
        </aside>
      </section>
    </main>
  );
}
