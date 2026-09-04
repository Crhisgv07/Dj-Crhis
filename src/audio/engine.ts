import { settings } from "../settings/store";
import { DeckPlayer } from "./deckPlayer";
import type { FxName } from "./fx";
import { Sampler } from "./sampler";
import type { StemName } from "./stems";
import type {
  DeckId,
  EngineSnapshot,
  LiveState,
  MixerSnapshot,
  PadMode,
  PreviewSnapshot,
  VideoFxName,
  VideoProgram,
} from "./types";

type Listener = () => void;

class DjEngine {
  private ctx: AudioContext | null = null;
  private decks: Record<DeckId, DeckPlayer> | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private masterMeter: AnalyserNode | null = null;
  private recDest: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private recChunks: Blob[] = [];
  private recStartedAt = 0;
  private recording = false;
  private xfaderA: GainNode | null = null;
  private xfaderB: GainNode | null = null;
  private cueA: GainNode | null = null;
  private cueB: GainNode | null = null;
  private cueBus: GainNode | null = null;
  private programBus: GainNode | null = null;
  private crossfader = 0.5;
  private masterLevel = 0.85;
  private cueMix = 0;
  private listeners = new Set<Listener>();
  private meterTimer: number | null = null;
  private syncTimer: number | null = null;
  private masterDeck: DeckId | null = null;
  private sampler: Sampler | null = null;
  private videoFxName: VideoFxName = "none";
  private videoFxAmount = 0.5;
  private levels = { a: 0, b: 0, master: 0 };
  private previewGain: GainNode | null = null;
  private previewSource: AudioBufferSourceNode | null = null;
  private previewTitle = "";
  private previewPlaying = false;

  async unlock() {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
  }

  async loadDeck(
    id: DeckId,
    arrayBuffer: ArrayBuffer,
    title: string,
    path: string,
    extra?: { artist?: string; bpm?: number | null },
  ) {
    this.ensure();
    await this.unlock();
    await this.deck(id).load(arrayBuffer, title, path, extra);
    this.emit();
  }

  play(id: DeckId) {
    this.deck(id).play();
    this.emit();
  }

  pause(id: DeckId) {
    this.deck(id).pause();
    this.emit();
  }

  toggle(id: DeckId) {
    this.deck(id).toggle();
    this.emit();
  }

  cue(id: DeckId, down: boolean) {
    if (down) this.deck(id).cueDown();
    else this.deck(id).cueUp();
    this.emit();
  }

  setCueHere(id: DeckId) {
    this.deck(id).setCueHere();
    this.emit();
  }

  seek(id: DeckId, time: number) {
    this.deck(id).seek(time, true);
    this.emit();
  }

  scratch(id: DeckId, delta: number) {
    this.deck(id).scratch(delta);
  }

  jog(id: DeckId, delta: number) {
    this.deck(id).jog(delta);
  }

  setSlip(id: DeckId, on: boolean) {
    this.deck(id).setSlip(on);
    this.emit();
  }

  setKill(id: DeckId, band: "low" | "mid" | "high") {
    this.deck(id).setKill(band);
    this.emit();
  }

  setRate(id: DeckId, rate: number) {
    this.deck(id).setRate(rate);
    this.emit();
  }

  setKeylock(id: DeckId, on: boolean) {
    this.deck(id).setKeylock(on);
    this.emit();
  }

  fxSelect(id: DeckId, name: FxName) {
    this.deck(id).setFx(name);
    this.emit();
  }

  fxAmount(id: DeckId, amount: number) {
    this.deck(id).setFxAmount(amount);
    this.emit();
  }

  fxDivision(id: DeckId, beats: number) {
    this.deck(id).setFxDivision(beats);
    this.emit();
  }

  fxToggle(id: DeckId) {
    const on = !this.deck(id).snapshot().fx.on;
    this.deck(id).setFxOn(on);
    this.emit();
  }

  setStem(id: DeckId, stem: StemName, value: number) {
    this.deck(id).setStem(stem, value);
    this.emit();
  }

  toggleStem(id: DeckId, stem: StemName) {
    const cur = this.deck(id).snapshot().stems[stem];
    this.deck(id).setStem(stem, cur > 0.5 ? 0 : 1);
    this.emit();
  }

  setPitch(id: DeckId, amount: number) {
    const range = settings.get().pitchRange;
    this.setRate(id, 1 + ((amount - 0.5) * 2 * range) / 100);
  }

  refreshMixer() {
    this.applyXfade();
    this.emit();
  }

  /** Botón SYNC: engancha/desengancha `id` respecto al otro deck. */
  sync(id: DeckId) {
    const deck = this.deck(id);
    if (deck.isSynced) {
      deck.disengageSync();
      this.updateMasterFlags();
      this.emit();
      return;
    }
    const otherId = id === "a" ? "b" : "a";
    const other = this.deck(otherId);
    this.masterDeck = otherId;
    deck.syncTo({ grid: other.grid, rate: other.currentRate, position: other.position });
    this.updateMasterFlags();
    this.emit();
  }

  setMasterDeck(id: DeckId) {
    this.masterDeck = id;
    // Fijar máster manualmente implica enganchar el otro deck.
    const otherId = id === "a" ? "b" : "a";
    const other = this.deck(otherId);
    if (!other.isSynced) {
      other.syncTo({ grid: this.deck(id).grid, rate: this.deck(id).currentRate, position: this.deck(id).position });
    }
    this.updateMasterFlags();
    this.emit();
  }

  nudgeGrid(id: DeckId, deltaSeconds: number) {
    this.deck(id).nudgeGrid(deltaSeconds);
    this.emit();
  }

  gridHere(id: DeckId) {
    this.deck(id).setGridHere();
    this.emit();
  }

  bpmScale(id: DeckId, factor: number) {
    this.deck(id).scaleBpm(factor);
    this.emit();
  }

  bpmManual(id: DeckId, bpm: number) {
    this.deck(id).setBpmManual(bpm);
    this.emit();
  }

  private updateMasterFlags() {
    if (!this.decks) return;
    const anySynced = this.decks.a.isSynced || this.decks.b.isSynced;
    if (!anySynced) this.masterDeck = null;
    this.decks.a.setMasterFlag(this.masterDeck === "a" && anySynced);
    this.decks.b.setMasterFlag(this.masterDeck === "b" && anySynced);
  }

  /** Corrección continua de fase para los decks enganchados (PLL suave). */
  private syncTick() {
    if (!this.decks || !this.masterDeck) return;
    const masterId = this.masterDeck;
    const followerId = masterId === "a" ? "b" : "a";
    const m = this.decks[masterId];
    const f = this.decks[followerId];
    if (!f.isSynced || !f.isPlaying || !m.isPlaying) return;
    const mg = m.grid;
    const fg = f.grid;
    if (!mg || !fg) return;

    const targetRate = (mg.bpm * m.currentRate) / fg.bpm;
    const beatM = 60 / mg.bpm;
    const beatF = 60 / fg.bpm;
    const phaseM = frac((m.position - mg.anchor) / beatM);
    const phaseF = frac((f.position - fg.anchor) / beatF);
    let err = phaseM - phaseF;
    err = ((err + 0.5) % 1 + 1) % 1 - 0.5; // beat más cercano, (-0.5, 0.5]

    if (Math.abs(err) > 0.2) {
      // Muy desalineado: reengancha con un salto y vuelve al tempo exacto.
      f.setRateSynced(targetRate);
      f.seek(f.position + err * beatF);
    } else {
      // Corrección proporcional pequeña sobre el tempo.
      const trim = Math.max(-0.03, Math.min(0.03, err * 0.5));
      f.setRateSynced(targetRate * (1 + trim));
    }
  }

  hotCue(id: DeckId, index: number) {
    this.deck(id).setHotCue(index);
    this.emit();
  }

  clearHotCue(id: DeckId, index: number) {
    this.deck(id).clearHotCue(index);
    this.emit();
  }

  // --- Modos de pad -----------------------------------------------------

  setPadMode(id: DeckId, mode: PadMode) {
    this.deck(id).setPadMode(mode);
    this.emit();
  }

  beatJump(id: DeckId, beats: number) {
    this.deck(id).beatJump(beats);
    this.emit();
  }

  rollStart(id: DeckId, beats: number) {
    this.deck(id).rollStart(beats);
    this.emit();
  }

  rollEnd(id: DeckId) {
    this.deck(id).rollEnd();
    this.emit();
  }

  slice(id: DeckId, index: number) {
    this.deck(id).slice(index);
    this.emit();
  }

  savedLoop(id: DeckId, index: number) {
    this.deck(id).savedLoop(index);
    this.emit();
  }

  clearSavedLoop(id: DeckId, index: number) {
    this.deck(id).clearSavedLoop(index);
    this.emit();
  }

  // --- Sampler compartido --------------------------------------------

  samplerTrigger(index: number) {
    this.ensure();
    this.sampler?.trigger(index);
    this.emit();
  }

  samplerStop(index: number) {
    this.sampler?.stop(index);
    this.emit();
  }

  async samplerLoad(index: number, arrayBuffer: ArrayBuffer, name: string) {
    this.ensure();
    await this.unlock();
    await this.sampler?.load(index, arrayBuffer, name);
    this.emit();
  }

  samplerClear(index: number) {
    this.sampler?.clear(index);
    this.emit();
  }

  loop(id: DeckId, beats: number) {
    this.deck(id).setLoopBeats(beats);
    this.emit();
  }

  clearLoop(id: DeckId) {
    this.deck(id).clearLoop();
    this.emit();
  }

  setGain(id: DeckId, value: number) {
    this.deck(id).setGain(value);
    this.applyCue();
    this.emit();
  }

  setVolume(id: DeckId, value: number) {
    this.deck(id).setVolume(value);
    this.emit();
  }

  setEq(id: DeckId, band: "low" | "mid" | "high", value: number) {
    this.deck(id).setEq(band, value);
    this.emit();
  }

  setFilter(id: DeckId, value: number) {
    this.deck(id).setFilter(value);
    this.emit();
  }

  setCueMonitor(id: DeckId, on: boolean) {
    this.deck(id).setCueMonitor(on);
    this.applyCue();
    this.emit();
  }

  setCrossfader(value: number) {
    this.crossfader = clamp(value, 0, 1);
    this.applyXfade();
    this.emit();
  }

  setMaster(value: number) {
    this.masterLevel = clamp(value, 0, 1);
    if (this.master) this.master.gain.value = this.masterLevel;
    this.emit();
  }

  setCueMix(value: number) {
    this.cueMix = clamp(value, 0, 1);
    this.applyCue();
    this.emit();
  }

  // --- Grabación del set (salida master, post-limitador) ------------------

  toggleRecording() {
    if (this.recording) this.stopRecording();
    else this.startRecording();
  }

  startRecording() {
    const ctx = this.ensure();
    if (this.recording || typeof MediaRecorder === "undefined") return;
    if (!this.recDest) {
      this.recDest = ctx.createMediaStreamDestination();
      this.limiter?.connect(this.recDest);
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    this.recorder = new MediaRecorder(this.recDest.stream, { mimeType: mime, audioBitsPerSecond: 256000 });
    this.recChunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.recChunks.push(event.data);
    };
    this.recorder.onstop = () => void this.finishRecording();
    this.recorder.start(1000);
    this.recStartedAt = performance.now();
    this.recording = true;
    this.emit();
  }

  stopRecording() {
    if (!this.recording || !this.recorder) return;
    this.recording = false;
    try {
      this.recorder.stop();
    } catch {
      /* noop */
    }
    this.emit();
  }

  recordingState() {
    return {
      active: this.recording,
      seconds: this.recording ? (performance.now() - this.recStartedAt) / 1000 : 0,
    };
  }

  private async finishRecording() {
    const type = this.recorder?.mimeType || "audio/webm";
    const blob = new Blob(this.recChunks, { type });
    this.recChunks = [];
    this.recorder = null;
    const name = `CRHIS-set-${recStamp()}.webm`;
    try {
      const api = (globalThis as { crhis?: { recorder?: { save?: (d: ArrayBuffer, n: string) => Promise<boolean> } } }).crhis;
      if (api?.recorder?.save) {
        await api.recorder.save(await blob.arrayBuffer(), name);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch {
      /* el usuario canceló o no hay API */
    }
    this.emit();
  }

  async preview(arrayBuffer: ArrayBuffer, title: string) {
    this.ensure();
    await this.unlock();
    this.stopPreview();
    const ctx = this.ctx!;
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this.previewSource = ctx.createBufferSource();
    this.previewSource.buffer = buffer;
    this.previewSource.connect(this.previewGain!);
    this.previewSource.onended = () => {
      this.previewPlaying = false;
      this.previewTitle = "";
      this.emit();
    };
    this.previewTitle = title;
    this.previewPlaying = true;
    if (this.cueMix < 0.4) this.setCueMix(0.55);
    this.previewSource.start(0);
    this.emit();
  }

  stopPreview() {
    if (this.previewSource) {
      this.previewSource.onended = null;
      try {
        this.previewSource.stop();
      } catch {
        /* already stopped */
      }
      this.previewSource.disconnect();
      this.previewSource = null;
    }
    this.previewPlaying = false;
    this.previewTitle = "";
    this.emit();
  }

  snapshot(): EngineSnapshot {
    return {
      decks: {
        a: this.decks?.a.snapshot() ?? emptyDeck("a"),
        b: this.decks?.b.snapshot() ?? emptyDeck("b"),
      },
      mixer: this.mixerSnapshot(),
      preview: this.previewSnapshot(),
      sampler: this.sampler?.snapshot() ?? Array.from({ length: 8 }, () => null),
    };
  }

  /** Qué video debe mostrar la ventana de salida. Con dos videos cargados, el
   *  crossfader elige (corte duro en el centro). Null = no hay video → ventana
   *  cerrada. */
  videoProgram(): VideoProgram {
    const a = this.decks?.a;
    const b = this.decks?.b;
    const aVid = a?.videoActive ? a : null;
    const bVid = b?.videoActive ? b : null;
    if (!aVid && !bVid) return null;
    const dp = (d: DeckPlayer) => ({
      path: d.sourcePath,
      time: d.position,
      rate: d.currentRate,
      paused: !d.isPlaying,
    });
    return {
      a: aVid ? dp(aVid) : null,
      b: bVid ? dp(bVid) : null,
      crossfader: this.crossfader,
      fx: this.videoFxName,
      fxAmount: this.videoFxAmount,
    };
  }

  setVideoFx(name: VideoFxName) {
    this.videoFxName = name;
    this.emit();
  }

  setVideoFxAmount(value: number) {
    this.videoFxAmount = clamp(value, 0, 1);
    this.emit();
  }

  videoFxState() {
    return { name: this.videoFxName, amount: this.videoFxAmount };
  }

  /** Estado ligero para el bucle rAF: sin copiar hot cues, peaks ni EQ. */
  liveState(): LiveState {
    const a = this.decks?.a;
    const b = this.decks?.b;
    return {
      a: {
        position: a?.position ?? 0,
        playing: a?.isPlaying ?? false,
        rate: a?.currentRate ?? 1,
      },
      b: {
        position: b?.position ?? 0,
        playing: b?.isPlaying ?? false,
        rate: b?.currentRate ?? 1,
      },
      levels: { ...this.levels },
      previewPlaying: this.previewPlaying,
      recording: this.recordingState(),
    };
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  destroy() {
    if (this.meterTimer !== null) window.clearInterval(this.meterTimer);
    if (this.syncTimer !== null) window.clearInterval(this.syncTimer);
    this.meterTimer = null;
    this.syncTimer = null;
    if (this.recording) this.stopRecording();
    this.sampler?.stopAll();
    this.decks?.a.dispose();
    this.decks?.b.dispose();
    void this.ctx?.close();
    this.ctx = null;
    this.decks = null;
  }

  private ensure() {
    if (this.ctx && this.decks) return this.ctx;
    const ctx = new AudioContext();
    const notify = () => this.emit();
    const deckA = new DeckPlayer(ctx, "a", notify);
    const deckB = new DeckPlayer(ctx, "b", notify);
    this.sampler = new Sampler(ctx);
    const xfaderA = ctx.createGain();
    const xfaderB = ctx.createGain();
    const programBus = ctx.createGain();
    const cueA = ctx.createGain();
    const cueB = ctx.createGain();
    const cueBus = ctx.createGain();
    const previewGain = ctx.createGain();
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    const masterMeter = ctx.createAnalyser();

    limiter.threshold.value = -8;
    limiter.knee.value = 12;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    master.gain.value = this.masterLevel;
    masterMeter.fftSize = 256;

    deckA.output.connect(xfaderA);
    deckB.output.connect(xfaderB);
    xfaderA.connect(programBus);
    xfaderB.connect(programBus);
    deckA.output.connect(cueA);
    deckB.output.connect(cueB);
    cueA.connect(cueBus);
    cueB.connect(cueBus);
    previewGain.connect(cueBus);
    previewGain.gain.value = 0.9;
    programBus.connect(master);
    cueBus.connect(master);
    this.sampler.output.connect(master);
    master.connect(limiter);
    limiter.connect(masterMeter);
    limiter.connect(ctx.destination);

    this.ctx = ctx;
    this.decks = { a: deckA, b: deckB };
    this.xfaderA = xfaderA;
    this.xfaderB = xfaderB;
    this.programBus = programBus;
    this.cueA = cueA;
    this.cueB = cueB;
    this.cueBus = cueBus;
    this.previewGain = previewGain;
    this.master = master;
    this.masterMeter = masterMeter;
    this.limiter = limiter;
    this.applyXfade();
    this.applyCue();
    this.startMeters();
    if (this.syncTimer === null) {
      this.syncTimer = window.setInterval(() => this.syncTick(), 180);
    }
    return ctx;
  }

  private deck(id: DeckId) {
    this.ensure();
    return this.decks![id];
  }

  private applyXfade() {
    if (!this.xfaderA || !this.xfaderB) return;
    const x = this.crossfader;
    const curve = settings.get().xfaderCurve;
    const width = 0.02 + (1 - curve) * 0.48;
    const smoothA = Math.cos((x * Math.PI) / 2);
    const smoothB = Math.sin((x * Math.PI) / 2);
    const sharpA = x < 0.5 - width ? 1 : x > 0.5 + width ? 0 : (0.5 + width - x) / (width * 2);
    const sharpB = 1 - sharpA;
    this.xfaderA.gain.value = smoothA * (1 - curve) + sharpA * curve;
    this.xfaderB.gain.value = smoothB * (1 - curve) + sharpB * curve;
  }

  private applyCue() {
    if (!this.cueA || !this.cueB || !this.cueBus || !this.programBus || !this.decks) return;
    const a = this.decks.a.snapshot().cueMonitor ? 1 : 0;
    const b = this.decks.b.snapshot().cueMonitor ? 1 : 0;
    this.cueA.gain.value = a;
    this.cueB.gain.value = b;
    this.cueBus.gain.value = this.cueMix;
    this.programBus.gain.value = 1 - this.cueMix * 0.85;
  }

  private mixerSnapshot(): MixerSnapshot {
    return {
      crossfader: this.crossfader,
      master: this.masterLevel,
      cueMix: this.cueMix,
      levels: this.levels,
    };
  }

  private previewSnapshot(): PreviewSnapshot {
    return { playing: this.previewPlaying, title: this.previewTitle };
  }

  private startMeters() {
    if (this.meterTimer !== null) return;
    this.meterTimer = window.setInterval(() => {
      if (!this.decks || !this.masterMeter) return;
      this.levels = {
        a: this.decks.a.level(),
        b: this.decks.b.level(),
        master: readAnalyser(this.masterMeter),
      };
    }, 50);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }
}

function readAnalyser(node: AnalyserNode) {
  const bins = new Uint8Array(node.frequencyBinCount);
  node.getByteTimeDomainData(bins);
  let peak = 0;
  for (const sample of bins) {
    const v = Math.abs(sample - 128) / 128;
    if (v > peak) peak = v;
  }
  return peak;
}

function emptyDeck(id: DeckId) {
  return {
    id,
    loaded: false,
    title: "",
    artist: "",
    path: "",
    duration: 0,
    position: 0,
    playing: false,
    rate: 1,
    isVideo: false,
    videoWidth: 0,
    videoHeight: 0,
    videoPoster: null,
    keylock: false,
    analyzing: false,
    beatGrid: null,
    keyName: null,
    camelot: null,
    synced: false,
    isMaster: false,
    fx: { name: "echo" as const, amount: 0, division: 0.5, on: false },
    stems: { vocal: 1, bass: 1, music: 1 },
    padMode: "hotcue" as const,
    savedLoops: Array.from({ length: 8 }, () => null),
    rollBeats: null,
    bpm: null,
    cuePoint: 0,
    hotCues: Array.from({ length: 8 }, () => null),
    loop: null,
    gain: 0.7,
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    kill: { low: false, mid: false, high: false },
    filter: 0.5,
    volume: 0.8,
    cueMonitor: false,
    slip: false,
    jogMode: settings.get().jogMode,
    peaks: null,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function frac(x: number) {
  return x - Math.floor(x);
}

function recStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export const engine = new DjEngine();

if (import.meta.env.DEV) {
  (globalThis as unknown as { __engine?: DjEngine }).__engine = engine;
}
