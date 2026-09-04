import { memo } from "react";
import { engine } from "../audio/engine";
import type { DeckSnapshot, MixerSnapshot } from "../audio/types";
import { usePlayback } from "../hooks/useEngine";
import { Knob } from "./controls/Knob";
import { Vu } from "./controls/Vu";

type Props = {
  deckA: DeckSnapshot;
  deckB: DeckSnapshot;
  mixer: MixerSnapshot;
};

export const Mixer = memo(function Mixer({ deckA, deckB, mixer }: Props) {
  return (
    <section className="mixer">
      <div className="mixer-brand">MIXER</div>

      <div className="mixer-strips">
        <Channel deck={deckA} label="A" />
        <div className="mixer-center">
          <MasterVuPair />
        </div>
        <Channel deck={deckB} label="B" />
      </div>

      <div className="xfader">
        <div className="xfader-rail">
          <input
            type="range"
            className="fader-h"
            min={0}
            max={1}
            step={0.001}
            value={mixer.crossfader}
            onChange={(event) => engine.setCrossfader(Number(event.target.value))}
            onDoubleClick={() => engine.setCrossfader(0.5)}
          />
        </div>
        <div className="xfader-legend">
          <span>A</span>
          <span>CROSSFADER</span>
          <span>B</span>
        </div>
      </div>

      <div className="master-block">
        <Knob
          label="MASTER"
          value={mixer.master}
          center={0.85}
          color="var(--danger)"
          size={34}
          onChange={(v) => engine.setMaster(v)}
        />
        <Knob
          label="CUE MIX"
          value={mixer.cueMix}
          center={0}
          color="var(--deck-a)"
          size={34}
          onChange={(v) => engine.setCueMix(v)}
        />
      </div>
    </section>
  );
});

function MasterVuPair() {
  const live = usePlayback();
  return (
    <div className="master-vu">
      <Vu level={live.levels.a} />
      <Vu level={live.levels.master} />
      <Vu level={live.levels.b} />
    </div>
  );
}

function ChannelVu({ deckId }: { deckId: "a" | "b" }) {
  const live = usePlayback();
  return <Vu level={live.levels[deckId]} />;
}

const Channel = memo(function Channel({ deck, label }: { deck: DeckSnapshot; label: string }) {
  const id = deck.id;
  const accent = id === "a" ? "var(--deck-a)" : "var(--deck-b)";
  return (
    <div className={`channel channel-${id}`}>
      <div className="channel-head">
        <strong>{label}</strong>
        <button
          type="button"
          className={`cue-btn ${deck.cueMonitor ? "on" : ""}`}
          onClick={() => engine.setCueMonitor(id, !deck.cueMonitor)}
          title="Pre-escucha (PFL)"
        >
          CUE
        </button>
      </div>

      <div className="knob-stack">
        <div className="knob-row-2">
          <Knob
            label="TRIM"
            value={deck.gain}
            center={0.7}
            size={32}
            color={accent}
            onChange={(v) => engine.setGain(id, v)}
          />
          <Knob
            label="FILTER"
            value={deck.filter}
            center={0.5}
            size={32}
            color="var(--amber)"
            onChange={(v) => engine.setFilter(id, v)}
          />
        </div>
        <div className="knob-row-3">
          <Knob
            label={deck.kill.high ? "HI ✕" : "HI"}
            value={deck.eq.high}
            killed={deck.kill.high}
            size={32}
            color={accent}
            onChange={(v) => engine.setEq(id, "high", v)}
            onKill={() => engine.setKill(id, "high")}
          />
          <Knob
            label={deck.kill.mid ? "MID ✕" : "MID"}
            value={deck.eq.mid}
            killed={deck.kill.mid}
            size={32}
            color={accent}
            onChange={(v) => engine.setEq(id, "mid", v)}
            onKill={() => engine.setKill(id, "mid")}
          />
          <Knob
            label={deck.kill.low ? "LOW ✕" : "LOW"}
            value={deck.eq.low}
            killed={deck.kill.low}
            size={32}
            color={accent}
            onChange={(v) => engine.setEq(id, "low", v)}
            onKill={() => engine.setKill(id, "low")}
          />
        </div>
      </div>

      <div className="channel-bottom">
        <ChannelVu deckId={id} />
        <div className="fader-v">
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={deck.volume}
            onChange={(event) => engine.setVolume(id, Number(event.target.value))}
          />
        </div>
      </div>
    </div>
  );
});
