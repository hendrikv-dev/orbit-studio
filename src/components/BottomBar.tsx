import { Clock, Pause, Play, RotateCcw, StepBack, TimerReset } from "lucide-react";
import {
  formatLocalSimulationTime,
  formatUtcSimulationTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "../lib/format";
import { useSimulationStore } from "../state/useSimulationStore";

const timeScales = [1, 10, 100, 1000, 1250, 2500, 5000, 10000];

export function BottomBar() {
  const scenario = useSimulationStore((state) => state.scenario);
  const isPlaying = useSimulationStore((state) => state.isPlaying);
  const setPlaying = useSimulationStore((state) => state.setPlaying);
  const setTimeScale = useSimulationStore((state) => state.setTimeScale);
  const setReverse = useSimulationStore((state) => state.setReverse);
  const setSimulationTime = useSimulationStore((state) => state.setSimulationTime);
  const resetSimulationTime = useSimulationStore((state) => state.resetSimulationTime);

  return (
    <footer className="bottom-bar">
      <div className="transport">
        <button
          className="icon-button primary"
          type="button"
          title={isPlaying ? "Pause" : "Play"}
          onClick={() => setPlaying(!isPlaying)}
        >
          {isPlaying ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button
          className={scenario.isReverse ? "active" : ""}
          type="button"
          title="Reverse time"
          onClick={() => setReverse(!scenario.isReverse)}
        >
          <StepBack size={15} />
          <span>Reverse</span>
        </button>
        <label className="speed-select">
          <span>Speed</span>
          <select
            aria-label="Playground playback speed"
            value={scenario.timeScale}
            onChange={(event) => setTimeScale(Number(event.target.value))}
          >
            {timeScales.map((scale) => (
              <option key={scale} value={scale}>
                {scale === 1 ? "Realtime" : `${scale.toLocaleString()}x`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="time-input">
        <Clock size={15} />
        <span>Local</span>
        <input
          aria-label="Simulation local date and time"
          type="datetime-local"
          value={toDateTimeLocalValue(scenario.simulationTimeUtc)}
          onChange={(event) => {
            const nextTimeUtc = fromDateTimeLocalValue(event.target.value);

            if (nextTimeUtc) {
              setSimulationTime(nextTimeUtc);
            }
          }}
        />
      </label>

      <button type="button" title="Reset to now" onClick={resetSimulationTime}>
        <TimerReset size={15} />
        <span>Now</span>
      </button>
      <div className="time-readout">
        <RotateCcw size={14} />
        <span>Local: {formatLocalSimulationTime(scenario.simulationTimeUtc)}</span>
        <span>UTC: {formatUtcSimulationTime(scenario.simulationTimeUtc)}</span>
      </div>
    </footer>
  );
}
