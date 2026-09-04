import { engine } from "../audio/engine";
import { useSettings } from "../hooks/useSettings";
import { settings, type PitchRange } from "../settings/store";
import { MidiPanel } from "./MidiPanel";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function Settings({ open, onClose }: Props) {
  const value = useSettings();
  if (!open) return null;

  return (
    <div className="modal-back" onClick={onClose}>
      <section className="settings settings-wide" onClick={(event) => event.stopPropagation()}>
        <div className="midi-head">
          <h2>Setup</h2>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <div className="settings-body">
          <label>
            Jog
            <select
              value={value.jogMode}
              onChange={(event) => settings.set({ jogMode: event.target.value as "vinyl" | "cdj" })}
            >
              <option value="cdj">CDJ / Nudge</option>
              <option value="vinyl">Vinyl / Scratch</option>
            </select>
          </label>
          <label>
            Sensibilidad jog
            <input
              type="range"
              min={0.2}
              max={1.4}
              step={0.05}
              value={value.jogSensitivity}
              onChange={(event) => settings.set({ jogSensitivity: Number(event.target.value) })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.quantize}
              onChange={(event) => settings.set({ quantize: event.target.checked })}
            />
            Quantize (cues y loops al beat)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.autoGain}
              onChange={(event) => settings.set({ autoGain: event.target.checked })}
            />
            Auto-gain (nivela el volumen de cada pista al cargar)
          </label>
          <label>
            Rango de pitch
            <select
              value={value.pitchRange}
              onChange={(event) => settings.set({ pitchRange: Number(event.target.value) as PitchRange })}
            >
              <option value={8}>±8%</option>
              <option value={16}>±16%</option>
              <option value={50}>±50%</option>
            </select>
          </label>
          <label>
            Curva de crossfader
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={value.xfaderCurve}
              onChange={(event) => {
                settings.set({ xfaderCurve: Number(event.target.value) });
                engine.refreshMixer();
              }}
            />
            <span className="track-meta">{value.xfaderCurve < 0.5 ? "Mezcla suave" : "Corte scratch"}</span>
          </label>
        </div>
        <div className="settings-midi">
          <MidiPanel />
        </div>
      </section>
    </div>
  );
}
