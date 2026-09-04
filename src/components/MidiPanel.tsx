import { memo } from "react";
import { useMidi } from "../hooks/useMidi";
import { useSettings } from "../hooks/useSettings";
import { labelFor, midi, midiTargets } from "../midi/midiManager";
import { MIDI_PRESETS } from "../midi/numark";
import { settings } from "../settings/store";

export const MidiPanel = memo(function MidiPanel() {
  const state = useMidi();
  const prefs = useSettings();

  return (
    <section className="midi-panel">
      <div className="midi-head">
        <h2>MIDI · mapeo de controladora</h2>
        <div>
          <select
            className="fx-select"
            defaultValue=""
            onChange={(event) => {
              const preset = MIDI_PRESETS.find((p) => p.id === event.target.value);
              if (preset) midi.applyPreset(preset.bindings, preset.label);
              event.target.value = "";
            }}
          >
            <option value="" disabled>
              Preset…
            </option>
            {MIDI_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={() => midi.rescan()}>
            Reescanear
          </button>
          <button className="ghost" onClick={() => midi.cancelLearn()}>
            Cancelar
          </button>
          <button className="ghost" onClick={() => midi.clearAll()}>
            Borrar
          </button>
        </div>
      </div>

      <div className="empty" style={{ padding: "8px 12px 0", textAlign: "left", lineHeight: 1.5 }}>
        {!state.supported ? (
          <span style={{ color: "var(--danger)" }}>
            Este entorno no expone Web MIDI. Reinicia la app.
          </span>
        ) : (
          <>
            <div>
              Dispositivos:{" "}
              <b>{state.devices.length ? state.devices.join(", ") : "ninguno"}</b>
            </div>
            <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}>
              {state.lastMessage || "esperando señal…"}
            </div>
            <div style={{ color: state.msgCount ? "var(--green)" : "#8a8680" }}>
              {state.msgCount
                ? `✓ recibiendo MIDI (${state.msgCount}) ${state.lastAction}`
                : "Sin señal MIDI aún — mueve un control"}
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px 0", flexWrap: "wrap" }}>
        <button
          className="btn"
          style={{ background: "var(--amber)", color: "#1a1300", minHeight: 32, padding: "0 14px" }}
          onClick={() => midi.startWizard()}
        >
          {state.wizardRemaining ? `Mapeando… faltan ${state.wizardRemaining}` : "▶ Aprender TODO (asistente)"}
        </button>
        {state.wizardRemaining ? (
          <>
            <button className="ghost" onClick={() => midi.skipWizard()}>
              Saltar este
            </button>
            <button className="ghost" onClick={() => midi.stopWizard()}>
              Detener
            </button>
          </>
        ) : null}
        <label className="check" style={{ marginLeft: "auto", fontSize: 11 }}>
          <input
            type="checkbox"
            checked={prefs.midiPickup}
            onChange={(e) => settings.set({ midiPickup: e.target.checked })}
          />
          Soft-takeover (faders no saltan)
        </label>
      </div>

      {state.wizardRemaining ? (
        <div
          style={{
            margin: "8px 12px 0",
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(242,177,52,0.12)",
            border: "1px solid rgba(242,177,52,0.4)",
          }}
        >
          Pulsa / mueve el control físico para:{" "}
          <b>{state.learning ? labelFor(state.learning) : "…"}</b>
        </div>
      ) : null}

      {state.seen.length ? (
        <div style={{ padding: "8px 12px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--muted)" }}>
              MONITOR — controles detectados
            </strong>
            <button
              className="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  JSON.stringify(
                    state.seen.map(({ type, channel, data }) => ({ type, channel, data })),
                  ),
                );
              }}
            >
              Copiar
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 3,
              marginTop: 4,
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 10.5,
            }}
          >
            {state.seen.map((s) => (
              <span
                key={`${s.type}-${s.channel}-${s.data}`}
                style={{ color: s.type === "cc" ? "var(--amber)" : "var(--deck-a)" }}
              >
                {s.type.toUpperCase()} ch{s.channel} #{s.data} = {s.value}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="midi-list">
        {midiTargets.map((target) => {
          const bound = state.bindings.find((b) => b.target === target);
          return (
            <div
              key={target}
              className={`midi-row ${state.learning === target ? "learning" : ""}`}
            >
              <span>
                {labelFor(target)}
                <br />
                <em style={{ color: "#8a8680", fontStyle: "normal" }}>
                  {bound ? `${bound.type.toUpperCase()} ch${bound.channel} #${bound.data}` : "sin asignar"}
                </em>
              </span>
              <span>
                <button onClick={() => midi.beginLearn(target)}>Aprender</button>
                {bound ? <button onClick={() => midi.clearBinding(target)}>X</button> : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
});
