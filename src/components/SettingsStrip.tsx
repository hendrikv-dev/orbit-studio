import { Cloud, Map, Moon, Satellite } from "lucide-react";
import type { ReactNode } from "react";
import { useApsisStore } from "../store/useApsisStore";

export function SettingsStrip() {
  const settings = useApsisStore((state) => state.scenario.renderSettings);
  const setRenderSetting = useApsisStore((state) => state.setRenderSetting);

  return (
    <div className="settings-strip">
      <Toggle
        label="Clouds"
        active={settings.clouds}
        icon={<Cloud size={15} />}
        onClick={() => setRenderSetting("clouds", !settings.clouds)}
      />
      <Toggle
        label="Night"
        active={settings.nightLights}
        icon={<Moon size={15} />}
        onClick={() => setRenderSetting("nightLights", !settings.nightLights)}
      />
      <Toggle
        label="Tracks"
        active={settings.groundTracks}
        icon={<Map size={15} />}
        onClick={() => setRenderSetting("groundTracks", !settings.groundTracks)}
      />
      <span className="quality-chip">
        <Satellite size={15} />
        {settings.quality}
      </span>
    </div>
  );
}

function Toggle({ label, active, icon, onClick }: { label: string; active: boolean; icon: ReactNode; onClick: () => void }) {
  return (
    <button className={active ? "toggle active" : "toggle"} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}
