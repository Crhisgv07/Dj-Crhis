import type { FxName } from "./fx";
import type { SamplerSlotState } from "./sampler";
import type { StemLevels } from "./stems";

export type { SamplerSlotState } from "./sampler";
export type { StemLevels, StemName } from "./stems";

export type DeckId = "a" | "b";

export type PadMode = "hotcue" | "jump" | "roll" | "slicer" | "savedloop" | "sampler";

export type FxState = {
  name: FxName;
  amount: number;
  division: number;
  on: boolean;
};

export type HotCue = {
  time: number;
  color: string;
} | null;

export type BeatGrid = {
  bpm: number;
  /** Tiempo (s) del primer beat. Beat n = anchor + n * 60/bpm. */
  anchor: number;
};

export type DeckSnapshot = {
  id: DeckId;
  loaded: boolean;
  title: string;
  artist: string;
  path: string;
  duration: number;
  position: number;
  playing: boolean;
  rate: number;
  isVideo: boolean;
  videoWidth: number;
  videoHeight: number;
  /** Fotograma del video usado como carátula cuando el archivo no trae una. */
  videoPoster: string | null;
  /** Keylock / master-tempo: el tono no cambia al mover el pitch. */
  keylock: boolean;
  /** El análisis de forma de onda/BPM aún no terminó. */
  analyzing: boolean;
  /** Rejilla de beats detectada (o editada). Null si no hay análisis. */
  beatGrid: BeatGrid | null;
  /** Tonalidad detectada, ej. "F#m". */
  keyName: string | null;
  /** Notación Camelot, ej. "11A". */
  camelot: string | null;
  /** El deck está enganchado en sync al máster. */
  synced: boolean;
  /** Este deck es la referencia de tempo/fase. */
  isMaster: boolean;
  fx: FxState;
  stems: StemLevels;
  padMode: PadMode;
  /** Loops guardados (modo SAVED LOOP). */
  savedLoops: ({ start: number; end: number } | null)[];
  /** Tamaño de loop roll activo (en beats) o null. */
  rollBeats: number | null;
  bpm: number | null;
  cuePoint: number;
  hotCues: HotCue[];
  loop: { start: number; end: number } | null;
  gain: number;
  eq: { low: number; mid: number; high: number };
  kill: { low: boolean; mid: boolean; high: boolean };
  filter: number;
  volume: number;
  cueMonitor: boolean;
  slip: boolean;
  jogMode: "vinyl" | "cdj";
  peaks: Float32Array | null;
};

export type MixerSnapshot = {
  crossfader: number;
  master: number;
  cueMix: number;
  levels: { a: number; b: number; master: number };
};

export type PreviewSnapshot = {
  playing: boolean;
  title: string;
};

/** Estado de alta frecuencia (posición de reproducción y medidores). Se lee en
 *  un bucle rAF sin reconstruir el snapshot completo. */
export type LiveDeck = {
  position: number;
  playing: boolean;
  rate: number;
};

export type LiveState = {
  a: LiveDeck;
  b: LiveDeck;
  levels: { a: number; b: number; master: number };
  previewPlaying: boolean;
  recording: { active: boolean; seconds: number };
};

export type MidiTarget =
  | `deck.${DeckId}.play`
  | `deck.${DeckId}.cue`
  | `deck.${DeckId}.sync`
  | `deck.${DeckId}.pitch`
  | `deck.${DeckId}.jog`
  | `deck.${DeckId}.volume`
  | `deck.${DeckId}.gain`
  | `deck.${DeckId}.eqLow`
  | `deck.${DeckId}.eqMid`
  | `deck.${DeckId}.eqHigh`
  | `deck.${DeckId}.filter`
  | `deck.${DeckId}.load`
  | `deck.${DeckId}.hotcue.${number}`
  | "mixer.crossfader"
  | "mixer.master"
  | "library.up"
  | "library.down"
  | "preview.toggle";

export type MidiBinding = {
  target: MidiTarget;
  type: "note" | "cc";
  channel: number;
  data: number;
};

export type EngineSnapshot = {
  decks: Record<DeckId, DeckSnapshot>;
  mixer: MixerSnapshot;
  preview: PreviewSnapshot;
  sampler: SamplerSlotState[];
};

export type VideoFxName = "none" | "invert" | "mono" | "hue" | "rgb" | "mirror";

export type VideoDeckProgram = {
  path: string;
  time: number;
  rate: number;
  paused: boolean;
};

/** Estado que necesita la ventana de salida de video: los dos decks (para
 *  mezclarlos), el crossfader y el efecto de video. Null = no hay video. */
export type VideoProgram = {
  a: VideoDeckProgram | null;
  b: VideoDeckProgram | null;
  crossfader: number;
  fx: VideoFxName;
  fxAmount: number;
} | null;
