import { TopBar } from './TopBar';
import { LeftPanel } from '../panels/LeftPanel';
import { SatelliteEditor } from '../panels/SatelliteEditor';
import { TimelineBar } from '../timeline/TimelineBar';
import { SimulationScene } from '../../render/Scene';

export function AppShell() {
  return (
    <div className="app-shell">
      <TopBar />
      <main className="workspace">
        <LeftPanel />
        <SimulationScene />
        <SatelliteEditor />
      </main>
      <TimelineBar />
    </div>
  );
}
