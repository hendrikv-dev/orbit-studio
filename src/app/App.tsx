import { useEffect } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { useSimulationStore } from '../state/simulationStore';

export function App() {
  const tickSimulation = useSimulationStore((state) => state.tickSimulation);

  useEffect(() => {
    const interval = window.setInterval(() => tickSimulation(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [tickSimulation]);

  return <AppShell />;
}
