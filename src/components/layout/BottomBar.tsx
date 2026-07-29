import {
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  TimerReset
} from 'lucide-react';
import { useApsisStore } from '../../state/store';
import { fromDateTimeLocal, toDateTimeLocal } from '../../utils/time';

const SCALES = [1, 10, 100, 1000];

export function BottomBar() {
  const currentTimeMs = useApsisStore((state) => state.currentTimeMs);
  const playing = useApsisStore((state) => state.playing);
  const realtime = useApsisStore((state) => state.realtime);
  const timeScale = useApsisStore((state) => state.timeScale);
  const timeDirection = useApsisStore((state) => state.timeDirection);
  const setPlaying = useApsisStore((state) => state.setPlaying);
  const setRealtime = useApsisStore((state) => state.setRealtime);
  const setTimeScale = useApsisStore((state) => state.setTimeScale);
  const setTimeDirection = useApsisStore((state) => state.setTimeDirection);
  const setCurrentTime = useApsisStore((state) => state.setCurrentTime);
  const resetToNow = useApsisStore((state) => state.resetToNow);

  return (
    <footer className="bottom-bar">
      <div className="time-readout">
        <span className={realtime ? 'status-dot live' : 'status-dot'} />
        <div>
          <div className="label">Simulation time</div>
          <time>{new Date(currentTimeMs).toLocaleString()}</time>
        </div>
      </div>

      <div className="timeline-controls">
        <button
          className="icon-button"
          type="button"
          title={playing ? 'Pause' : 'Play'}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          className={timeDirection < 0 ? 'icon-button active' : 'icon-button'}
          type="button"
          title="Reverse time"
          onClick={() => setTimeDirection(timeDirection < 0 ? 1 : -1)}
        >
          <SkipBack size={18} />
        </button>
        <button className={realtime ? 'pill-button active' : 'pill-button'} type="button" onClick={setRealtime}>
          Realtime
        </button>
        {SCALES.map((scale) => (
          <button
            key={scale}
            className={!realtime && timeScale === scale ? 'pill-button active' : 'pill-button'}
            type="button"
            onClick={() => setTimeScale(scale)}
          >
            {scale}x
          </button>
        ))}
        <button className="icon-button" type="button" title="Reset to now" onClick={resetToNow}>
          <TimerReset size={18} />
        </button>
      </div>

      <label className="manual-time">
        <RotateCcw size={16} />
        <input
          type="datetime-local"
          value={toDateTimeLocal(currentTimeMs)}
          onChange={(event) => setCurrentTime(fromDateTimeLocal(event.target.value))}
        />
      </label>
    </footer>
  );
}
