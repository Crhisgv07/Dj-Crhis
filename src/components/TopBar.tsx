import { useEffect, useState } from "react";
import { engine } from "../audio/engine";
import { usePlayback } from "../hooks/useEngine";
import { useSettings } from "../hooks/useSettings";
import { settings, type LayoutMode } from "../settings/store";
import { Vu } from "./controls/Vu";

const LAYOUTS: { id: LayoutMode; label: string }[] = [
  { id: "full", label: "Completo" },
  { id: "waves", label: "Waveforms" },
  { id: "library", label: "Biblioteca" },
  { id: "perform", label: "Performance" },
];

type Props = {
  status: string;
  statusOk: boolean;
  master: number;
  onLoad: () => void;
  onSetup: () => void;
  onHelp: () => void;
};

export function TopBar({ status, statusOk, master, onLoad, onSetup, onHelp }: Props) {
  const [clock, setClock] = useState(() => now());
  const prefs = useSettings();

  useEffect(() => {
    const id = window.setInterval(() => setClock(now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <strong>CRHIS</strong>
        <select
          className="layout-select"
          value={prefs.layout}
          onChange={(event) => settings.set({ layout: event.target.value as LayoutMode })}
          title="Distribución de la cabina"
        >
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className={`status-pill ${statusOk ? "ok" : ""}`}>{status}</div>

      <div className="topbar-right">
        <div className="master-mini">
          <span className="master-mini-label">MASTER</span>
          <MasterMeter />
          <input
            type="range"
            className="fader-h master-mini-fader"
            min={0}
            max={1}
            step={0.01}
            value={master}
            onChange={(event) => engine.setMaster(Number(event.target.value))}
            onDoubleClick={() => engine.setMaster(0.85)}
            title="Volumen master"
          />
          <span className="master-mini-val">{Math.round(master * 100)}</span>
        </div>

        <RecButton />

        <span className="topbar-clock">{clock}</span>

        <button className="ghost" onClick={onLoad}>
          Cargar pistas
        </button>
        <button className="ghost" onClick={onSetup}>
          Setup
        </button>
        <button className="ghost icon" title="Atajos de teclado" onClick={onHelp}>
          ?
        </button>
      </div>
    </header>
  );
}

function MasterMeter() {
  const live = usePlayback();
  return (
    <div className="master-mini-meter">
      <Vu level={live.levels.master} orientation="horizontal" segments={18} />
    </div>
  );
}

function RecButton() {
  const live = usePlayback();
  const rec = live.recording;
  const mm = Math.floor(rec.seconds / 60);
  const ss = Math.floor(rec.seconds % 60);
  return (
    <button
      className={`ghost rec-btn ${rec.active ? "on" : ""}`}
      onClick={() => engine.toggleRecording()}
      title={rec.active ? "Detener grabación del set" : "Grabar el set (salida master)"}
    >
      <span className="rec-dot" />
      {rec.active ? `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : "REC"}
    </button>
  );
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
