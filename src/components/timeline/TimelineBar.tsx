import { Pause, Play, RotateCcw, StepBack, TimerReset } from 'lucide-react';
import { useSimulationStore } from '../../state/simulationStore';
import { formatDateTime, fromDateTimeLocalValue, toDateTimeLocalValue } from '../../utils/format';

const scales = [-1000, -100, -10, -1, 1, 10, 100, 1000];

export function TimelineBar() {
  const currentTime = useSimulationStore((state) => state.currentTime);
  const timeScale = useSimulationStore((state) => state.timeScale);
  const isPlaying = useSimulationStore((state) => state.isPlaying);
  const togglePlaying = useSimulationStore((state) => state.togglePlaying);
  const setTimeScale = useSimulationStore((state) => state.setTimeScale);
  const resetToNow = useSimulationStore((state) => state.resetToNow);
  const setCurrentTime = useSimulationStore((state) => state.setCurrentTime);

  return (
    <footer className="timeline-bar">
      <button className="transport-button primary" onClick={togglePlaying} title={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? <Pause size={17} /> : <Play size={17} />}
      </button>

      <div className="toolbar-group speed-group" aria-label="Time scale">
        <StepBack size={15} />
        {scales.map((scale) => (
          <button
            key={scale}
            className={timeScale === scale ? 'segmented active' : 'segmented'}
            onClick={() => setTimeScale(scale)}
            title={`${scale}x`}
          >
            {scale === 1 ? 'Realtime' : `${scale}x`}
          </button>
        ))}
      </div>

      <label className="time-input">
        <TimerReset size={16} />
        <input
          type="datetime-local"
          value={toDateTimeLocalValue(currentTime)}
          onChange={(event) => {
            const iso = fromDateTimeLocalValue(event.target.value);
            if (iso) {
              setCurrentTime(iso);
            }
          }}
        />
      </label>

      <button className="transport-button" onClick={resetToNow} title="Reset to now">
        <RotateCcw size={16} />
        Now
      </button>

      <div className="sim-time">{formatDateTime(currentTime)}</div>
    </footer>
  );
}
