import { memo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { engine } from "../audio/engine";
import { FX_DIVISIONS, FX_LABEL, FX_NAMES, FX_TIMED, type FxName } from "../audio/fx";
import { camelotColor } from "../audio/key";
import type { DeckId, DeckSnapshot, PadMode, SamplerSlotState, VideoFxName } from "../audio/types";
import { useSettings } from "../hooks/useSettings";
import { settings } from "../settings/store";
import { formatTime } from "../ui/theme";
import { Knob } from "./controls/Knob";

const DIV_LABEL: Record<number, string> = { 0.25: "1/4", 0.5: "1/2", 1: "1", 2: "2" };

const PAD_MODES: { id: PadMode; label: string }[] = [
  { id: "hotcue", label: "CUE" },
  { id: "jump", label: "JUMP" },
  { id: "roll", label: "ROLL" },
  { id: "slicer", label: "SLICE" },
  { id: "savedloop", label: "LOOP" },
  { id: "sampler", label: "SMPL" },
];

const JUMP_BEATS = [-8, -4, -2, -1, 1, 2, 4, 8];
const ROLL_BEATS = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8];
const VIDEO_FX: VideoFxName[] = ["none", "invert", "mono", "hue", "rgb", "mirror"];

function beatLabel(b: number): string {
  if (b >= 1) return String(b);
  return `1/${Math.round(1 / b)}`;
}

function renderPads(deck: DeckSnapshot, id: DeckId, sampler?: SamplerSlotState[]) {
  switch (deck.padMode) {
    case "hotcue":
      return deck.hotCues.map((cue, i) => (
        <button
          key={i}
          className={`pad-hot ${cue ? "set" : ""}`}
          style={cue ? { ["--pad-color" as string]: cue.color } : undefined}
          onClick={() => engine.hotCue(id, i)}
          onContextMenu={(e) => {
            e.preventDefault();
            engine.clearHotCue(id, i);
          }}
          title={`Hot cue ${i + 1}`}
        >
          {i + 1}
        </button>
      ));
    case "jump":
      return JUMP_BEATS.map((b, i) => (
        <button
          key={i}
          className="pad-hot jump"
          onClick={() => engine.beatJump(id, b)}
          title={`Salto ${b > 0 ? "+" : ""}${b} beats`}
        >
          {b < 0 ? "◀" : "▶"}
          {Math.abs(b)}
        </button>
      ));
    case "roll":
      return ROLL_BEATS.map((b, i) => (
        <button
          key={i}
          className={`pad-hot roll ${deck.rollBeats === b ? "on" : ""}`}
          onPointerDown={() => engine.rollStart(id, b)}
          onPointerUp={() => engine.rollEnd(id)}
          onPointerLeave={() => engine.rollEnd(id)}
          title={`Loop roll ${beatLabel(b)}`}
        >
          {beatLabel(b)}
        </button>
      ));
    case "slicer":
      return Array.from({ length: 8 }, (_, i) => (
        <button
          key={i}
          className="pad-hot slice"
          onClick={() => engine.slice(id, i)}
          title={`Rebanada ${i + 1}`}
        >
          {i + 1}
        </button>
      ));
    case "savedloop":
      return deck.savedLoops.map((sl, i) => (
        <button
          key={i}
          className={`pad-hot ${sl ? "set green" : ""}`}
          onClick={() => engine.savedLoop(id, i)}
          onContextMenu={(e) => {
            e.preventDefault();
            engine.clearSavedLoop(id, i);
          }}
          title={sl ? `Loop guardado ${i + 1}` : `Guardar loop de 4 beats en ${i + 1}`}
        >
          {i + 1}
        </button>
      ));
    case "sampler":
      return Array.from({ length: 8 }, (_, i) => {
        const s = sampler?.[i] ?? null;
        return (
          <button
            key={i}
            className={`pad-hot sampler ${s ? "set" : ""} ${s?.playing ? "playing" : ""}`}
            onClick={() => {
              if (s) engine.samplerTrigger(i);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              engine.samplerClear(i);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer.files?.[0];
              if (f) void f.arrayBuffer().then((buf) => engine.samplerLoad(i, buf, f.name));
            }}
            title={s ? s.name : `Slot ${i + 1} — arrastra un audio`}
          >
            {s ? s.name : "—"}
          </button>
        );
      });
  }
}

type Props = {
  deck: DeckSnapshot;
  position: number;
  cover?: string;
  sampler?: SamplerSlotState[];
  /** Las tonalidades de los dos decks son compatibles para mezcla armónica. */
  harmonic?: boolean;
  /** Arrastre de una fila de la biblioteca (transfiere `text/crhis-track`). */
  onDropTrack?: (path: string, deck: DeckId) => void;
  /** Arrastre de un archivo del sistema (audio o video) sobre el deck. */
  onDropFile?: (file: File, deck: DeckId) => void;
  /** Arrastre de una imagen sobre el deck: la fija como carátula de la pista. */
  onDropCover?: (path: string, file: File) => void;
};

export const Deck = memo(function Deck({
  deck,
  position,
  cover,
  sampler,
  harmonic,
  onDropTrack,
  onDropFile,
  onDropCover,
}: Props) {
  const drag = useRef<{ lastY: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const prefs = useSettings();
  const id = deck.id;
  const pitchPct = (deck.rate - 1) * 100;
  const angle = (position * 360 * deck.rate) / 1.8;
  const progress = deck.duration ? position / deck.duration : 0;
  // Carátula: la del archivo (ID3 o fijada por el usuario) y, si no hay y es
  // video, el fotograma capturado del propio clip.
  const art = cover || deck.videoPoster || undefined;

  const acceptDrag = (event: ReactDragEvent) => {
    // Sólo nos interesan filas de la biblioteca o archivos sueltos.
    const types = event.dataTransfer.types;
    if (!types.includes("text/crhis-track") && !types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = types.includes("text/crhis-track") ? "copy" : "copy";
    if (!dragOver) setDragOver(true);
  };

  return (
    <section
      className={`deck deck-${id} ${dragOver ? "drag-over" : ""}`}
      onDragEnter={acceptDrag}
      onDragOver={acceptDrag}
      onDragLeave={(event) => {
        // Ignora el dragleave al pasar de un hijo a otro dentro del deck.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        const path = event.dataTransfer.getData("text/crhis-track");
        if (path) {
          onDropTrack?.(path, id);
          return;
        }
        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        if (file.type.startsWith("image/")) {
          if (deck.path) onDropCover?.(deck.path, file);
          return;
        }
        onDropFile?.(file, id);
      }}
    >
      <div className="deck-head">
        <div className="deck-cover-frame">
          {art ? (
            <img className="deck-cover" src={art} alt="" />
          ) : (
            <span className="deck-cover empty-cover" />
          )}
        </div>
        <div className="deck-titles">
          <div className="track-title">{deck.title || "Arrastra una pista aquí"}</div>
          <div className="track-meta">{deck.artist || (deck.loaded ? "Sin artista" : "—")}</div>
          <div className="deck-tags">
            {deck.isVideo ? <span className="tag tag-video">VIDEO</span> : null}
            <span className={`tag tag-bpm ${deck.bpm ? "" : "muted"}`}>
              <b>{deck.bpm ? deck.bpm.toFixed(1) : "—"}</b>
              <i>BPM</i>
            </span>
            <span
              className={`tag tag-key ${deck.camelot ? "" : "muted"} ${harmonic ? "harmonic" : ""}`}
              style={deck.camelot ? { color: camelotColor(deck.camelot) } : undefined}
              title={harmonic ? "Compatible con el otro deck" : deck.keyName || undefined}
            >
              <b>{deck.camelot ?? "—"}</b>
              <i>{harmonic ? "✓ KEY" : "KEY"}</i>
            </span>
            <span className="tag muted">
              <b>{formatTime(deck.cuePoint)}</b>
              <i>CUE</i>
            </span>
          </div>
        </div>
        <div className="deck-screen">
          <div className="deck-screen-time">{formatTime(position)}</div>
          <div className="deck-screen-remain">-{formatTime(Math.max(0, deck.duration - position))}</div>
        </div>
      </div>

      <div className="deck-main">
        <div className="tempo">
          <span className="tempo-range">PITCH ±{prefs.pitchRange}</span>
          <div className="fader-v tempo-fader">
            <input
              type="range"
              min={-prefs.pitchRange}
              max={prefs.pitchRange}
              step={0.02}
              value={pitchPct}
              onChange={(event) => engine.setRate(id, 1 + Number(event.target.value) / 100)}
              onDoubleClick={() => engine.setRate(id, 1)}
            />
          </div>
          <span className="tempo-readout">{pitchPct > 0 ? "+" : ""}{pitchPct.toFixed(1)}%</span>
        </div>

        <div className="deck-jog-col">
          <div className="jog-wrap">
            <div
              className={`jog ${deck.playing ? "spinning" : ""}`}
              onPointerDown={(event) => {
                try {
                  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                } catch {
                  /* noop */
                }
                drag.current = { lastY: event.clientY };
              }}
              onPointerMove={(event) => {
                if (!drag.current) return;
                const delta = (event.clientY - drag.current.lastY) * -0.012;
                drag.current.lastY = event.clientY;
                engine.jog(id, delta);
              }}
              onPointerUp={(event) => {
                drag.current = null;
                try {
                  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
                } catch {
                  /* noop */
                }
              }}
            >
              <div className="jog-strobe" />
              <div
                className="jog-progress"
                style={{ ["--jog-progress" as string]: `${progress * 360}deg` }}
              />
              <div className="jog-platter" style={{ transform: `rotate(${angle}deg)` }}>
                <div className="jog-brush" />
                <div className="jog-mark" />
                <div className="jog-center">
                  {art ? <img src={art} alt="" /> : <span className="jog-logo">{id.toUpperCase()}</span>}
                </div>
              </div>
              <div className="jog-spindle" />
              <div className="jog-glass" />
              <div className="jog-drophint">SUELTA AQUÍ</div>
            </div>
          </div>
          <div className="jog-under">
            <button
              className={`chip ${prefs.jogMode === "vinyl" ? "on" : ""}`}
              onClick={() => settings.set({ jogMode: prefs.jogMode === "vinyl" ? "cdj" : "vinyl" })}
            >
              {prefs.jogMode === "vinyl" ? "VINYL" : "CDJ"}
            </button>
            <button
              className={`chip ${deck.keylock ? "on" : ""}`}
              onClick={() => engine.setKeylock(id, !deck.keylock)}
              title="Keylock / master tempo"
            >
              KEY
            </button>
            <button
              className={`chip ${deck.slip ? "on" : ""}`}
              onClick={() => engine.setSlip(id, !deck.slip)}
            >
              SLIP
            </button>
            <button
              className={`chip ${prefs.quantize ? "on" : ""}`}
              onClick={() => settings.set({ quantize: !prefs.quantize })}
            >
              QUANT
            </button>
          </div>
        </div>

        <div className="deck-ctrl-col">
          <div className="pad-tabs">
            {PAD_MODES.map((m) => (
              <button
                key={m.id}
                className={`pad-tab ${deck.padMode === m.id ? "on" : ""}`}
                onClick={() => engine.setPadMode(id, m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="deck-pads">{renderPads(deck, id, sampler)}</div>

          <div className="deck-stems" title="Stems aproximados (sin IA) — clic derecho: silenciar">
            <span className="row-label">STEMS</span>
            {(["vocal", "bass", "music"] as const).map((s) => (
              <Knob
                key={s}
                label={s === "vocal" ? "VOX" : s === "bass" ? "BASS" : "MUS"}
                value={deck.stems[s]}
                center={1}
                size={26}
                color="var(--green)"
                onChange={(v) => engine.setStem(id, s, v)}
                onKill={() => engine.toggleStem(id, s)}
              />
            ))}
          </div>

          <div className="deck-fx-row">
            <button
              className={`chip fx-power ${deck.fx.on ? "on" : ""}`}
              onClick={() => engine.fxToggle(id)}
            >
              FX
            </button>
            <select
              className="fx-select"
              value={deck.fx.name}
              onChange={(event) => engine.fxSelect(id, event.target.value as FxName)}
            >
              {FX_NAMES.map((n) => (
                <option key={n} value={n}>
                  {FX_LABEL[n]}
                </option>
              ))}
            </select>
            {FX_TIMED.has(deck.fx.name) ? (
              <div className="seg fx-div">
                {FX_DIVISIONS.map((d) => (
                  <button
                    key={d}
                    className={`chip ${deck.fx.division === d ? "on" : ""}`}
                    onClick={() => engine.fxDivision(id, d)}
                  >
                    {DIV_LABEL[d]}
                  </button>
                ))}
              </div>
            ) : null}
            <Knob
              label="AMT"
              value={deck.fx.amount}
              center={0}
              size={30}
              color="var(--amber)"
              onChange={(v) => engine.fxAmount(id, v)}
            />
            {deck.isVideo ? (
              <select
                className="fx-select vfx-select"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) engine.setVideoFx(event.target.value as VideoFxName);
                }}
                title="Efecto de video (salida)"
              >
                <option value="" disabled>
                  VFX
                </option>
                {VIDEO_FX.map((v) => (
                  <option key={v} value={v}>
                    {v.toUpperCase()}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="deck-loop-row">
            <span className="loop-label">LOOP</span>
            {[1, 2, 4, 8, 16].map((beats) => (
              <button
                key={beats}
                className={`chip ${deck.loop && deck.bpm && Math.round((deck.loop.end - deck.loop.start) / (60 / deck.bpm)) === beats ? "on" : ""}`}
                onClick={() => engine.loop(id, beats)}
              >
                {beats}
              </button>
            ))}
            <button className="chip danger" onClick={() => engine.clearLoop(id)} title="Salir del loop">
              ✕
            </button>
            <span className="grid-sep" />
            <span className="grid-bpm" title="BPM de la rejilla">
              {deck.beatGrid ? deck.beatGrid.bpm.toFixed(1) : deck.analyzing ? "···" : "—"}
            </span>
            <button className="chip" onClick={() => engine.nudgeGrid(id, -0.005)} title="Rejilla ←">◀</button>
            <button className="chip" onClick={() => engine.nudgeGrid(id, 0.005)} title="Rejilla →">▶</button>
            <button className="chip" onClick={() => engine.bpmScale(id, 0.5)}>÷2</button>
            <button className="chip" onClick={() => engine.bpmScale(id, 2)}>×2</button>
            <button className="chip" onClick={() => engine.gridHere(id)} title="Fijar el 1 aquí">SET</button>
          </div>

          <div className="deck-transport">
            <button
              className="btn btn-cue"
              onPointerDown={() => engine.cue(id, true)}
              onPointerUp={() => engine.cue(id, false)}
              onPointerLeave={() => engine.cue(id, false)}
              onContextMenu={(event) => {
                event.preventDefault();
                engine.setCueHere(id);
              }}
              title="Mantener: cue. Clic derecho: fijar cue aquí."
            >
              CUE
            </button>
            <button
              className={`btn btn-play ${deck.playing ? "active" : ""}`}
              onClick={() => engine.toggle(id)}
            >
              {deck.playing ? "❚❚" : "▶"}
            </button>
            <button
              className={`btn btn-sync ${deck.synced ? "active" : ""} ${deck.isMaster ? "master" : ""}`}
              onClick={() => engine.sync(id)}
              onContextMenu={(event) => {
                event.preventDefault();
                engine.setMasterDeck(id);
              }}
              title="Clic: sync. Clic derecho: fijar como máster."
            >
              {deck.isMaster ? "MASTER" : "SYNC"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});
