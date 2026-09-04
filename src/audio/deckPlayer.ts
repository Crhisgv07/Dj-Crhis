import { analyzeBeats } from "./bpm";
import { DeckFx, type FxName } from "./fx";
import { detectKey } from "./key";
import { isVideoPath, mimeForPath } from "./media";
import { analyzeGain, extractPeaks } from "./peaks";
import { DeckStems, type StemName } from "./stems";
import { getCachedAnalysis, putCachedAnalysis } from "../library/analysisCache";
import type { BeatGrid, DeckId, DeckSnapshot, HotCue, PadMode } from "./types";
import { settings } from "../settings/store";

const CUE_COLORS = [
  "#ff4d6d",
  "#ffb703",
  "#3ae374",
  "#4cc9f0",
  "#c77dff",
  "#ff8fab",
  "#80ffdb",
  "#f72585",
];

/**
 * Un deck reproduce SIEMPRE mediante un HTMLMediaElement (`<audio>` para música,
 * `<video>` para clips). Así:
 *  - la pista suena hasta el final real (el pipeline del navegador respeta el
 *    gapless; `decodeAudioData` recortaba MP3/AAC);
 *  - `currentTime` es la posición exacta e integra bien los cambios de tempo;
 *  - hay keylock/master-tempo gratis (`preservesPitch`);
 *  - se transmite desde disco: mucha menos RAM en archivos grandes.
 * El audio entra al mismo grafo (gain → EQ → filtro → volumen → salida) vía
 * MediaElementAudioSourceNode. `decodeAudioData` se usa sólo, una vez, para la
 * forma de onda y el BPM.
 */
export class DeckPlayer {
  readonly id: DeckId;
  readonly input: GainNode;
  readonly output: GainNode;
  readonly meter: AnalyserNode;

  private ctx: AudioContext;
  private notify: () => void;

  private gain: GainNode;
  private eqLow: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqHigh: BiquadFilterNode;
  private filter: BiquadFilterNode;
  private stems: DeckStems;
  private fx: DeckFx;
  private volume: GainNode;

  private media: HTMLMediaElement | null = null;
  private mediaNode: MediaElementAudioSourceNode | null = null;
  private mediaUrl: string | null = null;
  private loadToken = 0;

  private playing = false;
  private rate = 1;
  private keylock = false;
  private title = "";
  private artist = "";
  private path = "";
  private isVideo = false;
  private videoW = 0;
  private videoH = 0;
  /** Fotograma capturado del video para usarlo como carátula en el plato. */
  private videoPoster: string | null = null;

  private bpm: number | null = null;
  private beatGrid: BeatGrid | null = null;
  private keyName: string | null = null;
  private camelot: string | null = null;
  private peaks: Float32Array | null = null;
  private analyzing = false;
  private synced = false;
  private masterFlag = false;

  private decodedBuffer: AudioBuffer | null = null;
  private autoGain = 0.7;

  private cuePoint = 0;
  private hotCues: HotCue[] = Array.from({ length: 8 }, () => null);
  private loop: { start: number; end: number } | null = null;
  private loopTimer: number | null = null;
  private loopSource: AudioBufferSourceNode | null = null;
  private loopStartedAt = 0;
  private loopBaseOffset = 0;
  private padMode: PadMode = "hotcue";
  private savedLoops: ({ start: number; end: number } | null)[] = Array.from({ length: 8 }, () => null);
  private rollBeats: number | null = null;
  private rollAnchor: number | null = null;
  private rollClock = 0;

  private cueMonitor = false;
  private eq = { low: 0.5, mid: 0.5, high: 0.5 };
  private kill = { low: false, mid: false, high: false };
  private filterAmount = 0.5;
  private gainAmount = 0.7;
  private volumeAmount = 0.8;
  private slip = false;
  private slipAnchor: number | null = null;
  private slipClock = 0;
  private bendTimer: number | null = null;

  constructor(ctx: AudioContext, id: DeckId, notify: () => void = () => {}) {
    this.ctx = ctx;
    this.id = id;
    this.notify = notify;
    this.gain = ctx.createGain();
    this.eqLow = ctx.createBiquadFilter();
    this.eqMid = ctx.createBiquadFilter();
    this.eqHigh = ctx.createBiquadFilter();
    this.filter = ctx.createBiquadFilter();
    this.stems = new DeckStems(ctx);
    this.fx = new DeckFx(ctx);
    this.volume = ctx.createGain();
    this.output = ctx.createGain();
    this.input = this.gain;
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 256;

    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = 250;
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 0.9;
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = 4000;
    this.filter.type = "allpass";
    this.filter.frequency.value = 1000;

    this.gain.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.filter);
    this.filter.connect(this.stems.input);
    this.stems.output.connect(this.fx.input);
    this.fx.output.connect(this.volume);
    this.volume.connect(this.output);
    this.volume.connect(this.meter);

    this.applyGain();
    this.applyVolume();
  }

  async load(
    arrayBuffer: ArrayBuffer,
    title: string,
    path: string,
    extra?: { artist?: string; bpm?: number | null },
  ) {
    const token = ++this.loadToken;
    this.teardown();

    this.isVideo = isVideoPath(path);
    this.title = title.replace(/\.[^.]+$/, "");
    this.artist = extra?.artist || "";
    this.path = path;
    this.cuePoint = 0;
    this.hotCues = Array.from({ length: 8 }, () => null);
    this.loop = null;
    this.savedLoops = Array.from({ length: 8 }, () => null);
    this.rollBeats = null;
    this.rollAnchor = null;
    this.playing = false;
    this.synced = false;
    this.bpm = extra?.bpm ?? null;
    this.beatGrid = null;
    this.keyName = null;
    this.camelot = null;
    this.peaks = null;
    this.decodedBuffer = null;
    this.videoPoster = null;
    this.stems.reset();

    const blob = new Blob([arrayBuffer], { type: mimeForPath(path) });
    this.mediaUrl = URL.createObjectURL(blob);

    const el: HTMLMediaElement = this.isVideo
      ? document.createElement("video")
      : document.createElement("audio");
    el.src = this.mediaUrl;
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    setPreservesPitch(el, this.keylock);

    await new Promise<void>((resolve, reject) => {
      const ok = () => {
        cleanup();
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(new Error(this.isVideo ? "El sistema no puede decodificar este video" : "Formato de audio no soportado"));
      };
      const cleanup = () => {
        el.removeEventListener("loadedmetadata", ok);
        el.removeEventListener("error", bad);
      };
      el.addEventListener("loadedmetadata", ok);
      el.addEventListener("error", bad);
    });
    if (token !== this.loadToken) return; // otra carga la adelantó

    if (this.isVideo) {
      const v = el as HTMLVideoElement;
      this.videoW = v.videoWidth;
      this.videoH = v.videoHeight;
      void this.captureVideoPoster(v, token);
    }
    el.addEventListener("ended", () => {
      this.playing = false;
      this.clearLoopTimer();
      this.notify();
    });

    this.media = el;
    this.mediaNode = this.ctx.createMediaElementSource(el);
    this.mediaNode.connect(this.gain);
    el.playbackRate = clampRate(this.rate);

    // Análisis (forma de onda + BPM) en segundo plano: no bloquea la carga.
    void this.analyze(arrayBuffer.slice(0), token, extra?.bpm ?? null);
  }

  /** Toma un fotograma del video (~1 s) y lo guarda como carátula del plato.
   *  Se hace antes de reproducir, con el cabezal en 0, así no molesta. */
  private async captureVideoPoster(v: HTMLVideoElement, token: number) {
    try {
      const grabAt = Math.min(1, (v.duration || 2) / 2);
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          v.removeEventListener("seeked", done);
          v.removeEventListener("error", fail);
          resolve();
        };
        const fail = () => {
          v.removeEventListener("seeked", done);
          v.removeEventListener("error", fail);
          reject(new Error("seek"));
        };
        v.addEventListener("seeked", done);
        v.addEventListener("error", fail);
        v.currentTime = grabAt;
      });
      if (token !== this.loadToken) return;
      const w = 256;
      const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w)) || 144;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const cx = canvas.getContext("2d");
      if (!cx) return;
      cx.drawImage(v, 0, 0, w, h);
      v.currentTime = 0;
      if (token !== this.loadToken) return;
      this.videoPoster = canvas.toDataURL("image/jpeg", 0.72);
      this.notify();
    } catch {
      /* sin poster: se usa el logo del deck */
    }
  }

  private async analyze(buffer: ArrayBuffer, token: number, knownBpm: number | null) {
    this.analyzing = true;
    this.notify();

    const path = this.path;
    const cached = await getCachedAnalysis(path).catch(() => null);
    if (token !== this.loadToken) return;
    if (cached) {
      // Resultado instantáneo desde caché; el decode se hace igual en segundo
      // plano para poder hacer loops sample-accurate.
      this.peaks = Float32Array.from(cached.peaks);
      if (cached.bpm) {
        this.beatGrid = { bpm: knownBpm ?? cached.bpm, anchor: cached.anchor ?? 0 };
        this.bpm = this.beatGrid.bpm;
        this.fx.setBpm(this.beatGrid.bpm);
      } else {
        this.bpm = knownBpm;
      }
      this.keyName = cached.keyName;
      this.camelot = cached.camelot;
      this.autoGain = cached.gain;
      this.applyAutoGain();
      this.analyzing = false;
      this.notify();
    }

    try {
      const decoded = await this.ctx.decodeAudioData(buffer);
      if (token !== this.loadToken) return;
      this.decodedBuffer = decoded;
      if (cached) return; // ya teníamos todo

      this.peaks = extractPeaks(decoded);
      const grid = analyzeBeats(decoded);
      if (grid) {
        this.beatGrid = { bpm: knownBpm ?? grid.bpm, anchor: grid.anchor };
        this.bpm = this.beatGrid.bpm;
        this.fx.setBpm(this.beatGrid.bpm);
      } else {
        this.bpm = knownBpm;
        if (knownBpm) this.fx.setBpm(knownBpm);
      }
      const key = detectKey(decoded);
      if (key) {
        this.keyName = key.name;
        this.camelot = key.camelot;
      }
      this.autoGain = analyzeGain(decoded);
      this.applyAutoGain();

      void putCachedAnalysis({
        path,
        bpm: this.beatGrid?.bpm ?? this.bpm,
        anchor: this.beatGrid?.anchor ?? null,
        keyName: this.keyName,
        camelot: this.camelot,
        gain: this.autoGain,
        duration: this.duration,
        peaks: Array.from(this.peaks),
        ts: Date.now(),
      });
    } catch {
      if (token !== this.loadToken) return;
      if (!cached) {
        this.peaks = null;
        this.bpm = knownBpm;
      }
    } finally {
      if (token === this.loadToken) {
        this.analyzing = false;
        this.notify();
      }
    }
  }

  private applyAutoGain() {
    if (!settings.get().autoGain) return;
    this.gainAmount = clamp(this.autoGain, 0, 1);
    this.applyGain();
    this.notify();
  }

  play() {
    if (!this.media || this.playing) return;
    this.media.playbackRate = clampRate(this.rate);
    this.playing = true;
    if (this.loop && this.decodedBuffer && !this.isVideo) {
      this.armLoop(); // arranca el loop-buffer; el elemento queda en pausa
      return;
    }
    void this.media.play().catch(() => {
      this.playing = false;
      this.notify();
    });
    this.armLoop();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.stopRawLoopSource();
    this.media?.pause();
    this.clearLoopTimer();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  cueDown() {
    if (!this.media) return;
    if (this.playing) {
      this.seek(this.cuePoint);
      this.pause();
      return;
    }
    this.seek(this.cuePoint);
    this.play();
  }

  cueUp() {
    if (!this.media || this.playing) {
      this.seek(this.cuePoint);
      this.pause();
    }
  }

  setCueHere() {
    this.cuePoint = this.quantize(this.position);
  }

  seek(time: number, quantize = false) {
    if (!this.media) return;
    const next = clamp(quantize ? this.quantize(time) : time, 0, this.duration || Infinity);
    if (this.loopSource && this.loop) {
      // Reposiciona dentro del loop sin salir de él.
      this.startLoopBuffer(Number.isFinite(next) ? next : this.loop.start);
      return;
    }
    try {
      this.media.currentTime = Number.isFinite(next) ? next : 0;
    } catch {
      /* aún sin metadata */
    }
  }

  jog(deltaSeconds: number) {
    const mode = settings.get().jogMode;
    const sensitivity = 0.35 + settings.get().jogSensitivity * 1.4;
    if (mode === "vinyl") {
      this.scratch(deltaSeconds * sensitivity);
      return;
    }
    // Nudge: acelera/frena momentáneamente sin recolocar el cabezal.
    const bend = deltaSeconds * sensitivity * 0.18;
    this.applyRate(this.rate + bend);
    if (this.bendTimer !== null) window.clearTimeout(this.bendTimer);
    this.bendTimer = window.setTimeout(() => {
      this.applyRate(this.rate);
      this.bendTimer = null;
    }, 90);
  }

  scratch(deltaSeconds: number) {
    if (!this.media) return;
    this.seek(this.position + deltaSeconds);
  }

  /** Cambio de tempo manual (fader de pitch): suelta el sync. */
  setRate(rate: number) {
    this.synced = false;
    this.rate = clamp(rate, 0.06, 4);
    this.applyRate(this.rate);
  }

  /** Cambio de tempo desde el motor de sync: mantiene el enganche. */
  setRateSynced(rate: number) {
    this.rate = clamp(rate, 0.06, 4);
    this.applyRate(this.rate);
  }

  setKeylock(on: boolean) {
    this.keylock = on;
    if (this.media) setPreservesPitch(this.media, on);
  }

  // --- Efectos -------------------------------------------------------------

  setFx(name: FxName) {
    this.fx.setName(name);
  }

  setFxAmount(amount: number) {
    this.fx.setAmount(amount);
  }

  setFxDivision(beats: number) {
    this.fx.setDivision(beats);
  }

  setFxOn(on: boolean) {
    this.fx.setOn(on);
  }

  setStem(stem: StemName, value: number) {
    this.stems.setLevel(stem, value);
  }

  /** Iguala tempo con el otro deck y alinea la fase de los beats. */
  syncTo(other: { grid: BeatGrid | null; rate: number; position: number } | null) {
    if (!this.beatGrid || !other?.grid) return;
    const targetRate = (other.grid.bpm * other.rate) / this.beatGrid.bpm;
    this.setRateSynced(targetRate);

    const beatMe = 60 / this.beatGrid.bpm;
    const beatOther = 60 / other.grid.bpm;
    const phaseOther = frac((other.position - other.grid.anchor) / beatOther);
    const phaseMe = frac((this.position - this.beatGrid.anchor) / beatMe);
    let delta = phaseOther - phaseMe;
    delta = ((delta + 0.5) % 1 + 1) % 1 - 0.5; // beat más cercano
    if (this.media) {
      try {
        this.media.currentTime = Math.max(0, this.position + delta * beatMe);
      } catch {
        /* sin metadata */
      }
    }
    this.synced = true;
  }

  disengageSync() {
    this.synced = false;
  }

  // --- Edición de la rejilla de beats ---------------------------------------

  nudgeGrid(deltaSeconds: number) {
    if (!this.beatGrid) return;
    this.beatGrid = { ...this.beatGrid, anchor: Math.max(0, this.beatGrid.anchor + deltaSeconds) };
  }

  setGridHere() {
    if (!this.beatGrid) return;
    const beat = 60 / this.beatGrid.bpm;
    // Coloca el beat 1 en la posición actual (mod un beat) sin mover el BPM.
    const anchor = this.position % beat;
    this.beatGrid = { ...this.beatGrid, anchor };
  }

  scaleBpm(factor: number) {
    if (!this.beatGrid) return;
    const bpm = clamp(this.beatGrid.bpm * factor, 40, 320);
    this.beatGrid = { ...this.beatGrid, bpm };
    this.bpm = bpm;
    this.fx.setBpm(bpm);
  }

  setBpmManual(bpm: number) {
    const clamped = clamp(bpm, 40, 320);
    this.beatGrid = { bpm: clamped, anchor: this.beatGrid?.anchor ?? this.position % (60 / clamped) };
    this.bpm = clamped;
    this.fx.setBpm(clamped);
  }

  setHotCue(index: number) {
    if (!this.media || index < 0 || index > 7) return;
    const existing = this.hotCues[index];
    if (existing) {
      this.seek(existing.time);
      if (!this.playing) this.play();
      return;
    }
    this.hotCues[index] = { time: this.quantize(this.position), color: CUE_COLORS[index]! };
  }

  clearHotCue(index: number) {
    if (index < 0 || index > 7) return;
    this.hotCues[index] = null;
  }

  // --- Modos de pad ------------------------------------------------------

  setPadMode(mode: PadMode) {
    this.padMode = mode;
  }

  /** BEAT JUMP: salta ± n beats manteniendo la alineación a la rejilla. */
  beatJump(beats: number) {
    if (!this.beatGrid) return;
    const beat = 60 / this.beatGrid.bpm;
    this.seek(this.position + beats * beat);
  }

  /** LOOP ROLL: loop momentáneo; al soltar vuelve a donde iría la reproducción. */
  rollStart(beats: number) {
    if (!this.beatGrid) return;
    const beat = 60 / this.beatGrid.bpm;
    this.rollBeats = beats;
    this.rollAnchor = this.position;
    this.rollClock = this.ctx.currentTime;
    const start = this.position;
    this.loop = { start, end: start + beat * beats };
    this.armLoop();
  }

  rollEnd() {
    if (this.rollBeats === null) return;
    this.rollBeats = null;
    this.loop = null;
    this.clearLoopTimer();
    this.stopRawLoopSource();
    const target =
      this.rollAnchor !== null
        ? this.rollAnchor + (this.playing ? (this.ctx.currentTime - this.rollClock) * this.rate : 0)
        : null;
    this.rollAnchor = null;
    if (target !== null) {
      try {
        if (this.media) this.media.currentTime = target;
      } catch {
        /* noop */
      }
      if (this.playing && this.media && !this.isVideo) void this.media.play().catch(() => {});
    }
  }

  /** SLICER: 8 rebanadas en la ventana de 8 beats que contiene el cabezal. */
  slice(index: number) {
    if (!this.beatGrid || index < 0 || index > 7) return;
    const beat = 60 / this.beatGrid.bpm;
    const anchor = this.beatGrid.anchor;
    const region = 8 * beat;
    const rel = this.position - anchor;
    const regionStart = anchor + Math.floor(rel / region) * region;
    this.seek(regionStart + index * beat);
  }

  /** SAVED LOOP: vacío = captura un loop de 4 beats aquí; lleno = lo reactiva. */
  savedLoop(index: number) {
    if (!this.beatGrid || index < 0 || index > 7) return;
    const existing = this.savedLoops[index];
    if (existing) {
      this.loop = { ...existing };
      this.armLoop();
      return;
    }
    const beat = 60 / this.beatGrid.bpm;
    const start = this.quantize(this.position);
    const slot = { start, end: start + beat * 4 };
    this.savedLoops[index] = slot;
    this.loop = { ...slot };
    this.armLoop();
  }

  clearSavedLoop(index: number) {
    if (index < 0 || index > 7) return;
    this.savedLoops[index] = null;
  }

  setLoopBeats(beats: number) {
    if (!this.media || !this.bpm) return;
    const beat = 60 / this.bpm;
    const start = this.quantize(this.position);
    const end = start + beat * beats;
    this.loop = { start, end: this.duration ? Math.min(this.duration, end) : end };
    this.armLoop();
  }

  clearLoop() {
    this.loop = null;
    this.clearLoopTimer();
    this.stopLoopBuffer();
  }

  setSlip(on: boolean) {
    if (on && !this.slip) {
      this.slip = true;
      this.slipAnchor = this.position;
      this.slipClock = this.ctx.currentTime;
      return;
    }
    if (!on && this.slip) {
      this.slip = false;
      if (this.slipAnchor !== null) {
        const elapsed = (this.ctx.currentTime - this.slipClock) * this.rate;
        this.seek(this.slipAnchor + elapsed);
      }
      this.slipAnchor = null;
    }
  }

  setGain(value: number) {
    this.gainAmount = clamp(value, 0, 1);
    this.applyGain();
  }

  setVolume(value: number) {
    this.volumeAmount = clamp(value, 0, 1);
    this.applyVolume();
  }

  setEq(band: "low" | "mid" | "high", value: number) {
    this.eq[band] = clamp(value, 0, 1);
    this.applyEqBand(band);
  }

  setKill(band: "low" | "mid" | "high", on?: boolean) {
    this.kill[band] = on ?? !this.kill[band];
    this.applyEqBand(band);
  }

  setFilter(value: number) {
    this.filterAmount = clamp(value, 0, 1);
    const amount = this.filterAmount;
    if (Math.abs(amount - 0.5) < 0.03) {
      this.filter.type = "allpass";
      this.filter.frequency.value = 1000;
      this.filter.Q.value = 0.1;
      return;
    }
    if (amount < 0.5) {
      this.filter.type = "lowpass";
      this.filter.frequency.value = 180 + (amount / 0.5) * 14000;
      this.filter.Q.value = 0.85;
    } else {
      this.filter.type = "highpass";
      this.filter.frequency.value = 40 + ((amount - 0.5) / 0.5) * 6000;
      this.filter.Q.value = 0.85;
    }
  }

  setCueMonitor(on: boolean) {
    this.cueMonitor = on;
  }

  setArtist(artist: string) {
    this.artist = artist;
  }

  get position() {
    if (this.loopSource && this.loop) {
      const len = this.loop.end - this.loop.start;
      const elapsed = (this.ctx.currentTime - this.loopStartedAt) * this.rate;
      let p = this.loopBaseOffset + elapsed;
      if (len > 0 && p >= this.loop.end) p = this.loop.start + ((p - this.loop.start) % len);
      return p;
    }
    return this.media ? this.media.currentTime : 0;
  }

  get duration() {
    const d = this.media?.duration ?? 0;
    return Number.isFinite(d) ? d : 0;
  }

  get isPlaying() {
    return this.playing;
  }

  get currentRate() {
    return this.rate;
  }

  get videoActive() {
    return this.isVideo && Boolean(this.media);
  }

  get sourcePath() {
    return this.path;
  }

  get grid(): BeatGrid | null {
    return this.beatGrid;
  }

  get isSynced() {
    return this.synced;
  }

  setMasterFlag(on: boolean) {
    this.masterFlag = on;
  }

  snapshot(): DeckSnapshot {
    return {
      id: this.id,
      loaded: Boolean(this.media),
      title: this.title,
      artist: this.artist,
      path: this.path,
      duration: this.duration,
      position: this.position,
      playing: this.playing,
      rate: this.rate,
      isVideo: this.isVideo,
      videoWidth: this.videoW,
      videoHeight: this.videoH,
      videoPoster: this.videoPoster,
      keylock: this.keylock,
      analyzing: this.analyzing,
      beatGrid: this.beatGrid,
      keyName: this.keyName,
      camelot: this.camelot,
      synced: this.synced,
      isMaster: this.masterFlag,
      fx: this.fx.snapshot(),
      stems: this.stems.snapshot(),
      padMode: this.padMode,
      savedLoops: this.savedLoops.map((l) => (l ? { ...l } : null)),
      rollBeats: this.rollBeats,
      bpm: this.bpm,
      cuePoint: this.cuePoint,
      hotCues: [...this.hotCues],
      loop: this.loop,
      gain: this.gainAmount,
      eq: { ...this.eq },
      kill: { ...this.kill },
      filter: this.filterAmount,
      volume: this.volumeAmount,
      cueMonitor: this.cueMonitor,
      slip: this.slip,
      jogMode: settings.get().jogMode,
      peaks: this.peaks,
    };
  }

  level() {
    const bins = new Uint8Array(this.meter.frequencyBinCount);
    this.meter.getByteTimeDomainData(bins);
    let peak = 0;
    for (const sample of bins) {
      const v = Math.abs(sample - 128) / 128;
      if (v > peak) peak = v;
    }
    return peak;
  }

  private quantize(time: number) {
    if (!settings.get().quantize || !this.beatGrid) return time;
    const beat = 60 / this.beatGrid.bpm;
    const a = this.beatGrid.anchor;
    return Math.max(0, a + Math.round((time - a) / beat) * beat);
  }

  private applyRate(rate: number) {
    if (this.media) this.media.playbackRate = clampRate(rate);
    if (this.loopSource) {
      // Rebasea para que la posición calculada no salte.
      this.loopBaseOffset = this.position;
      this.loopStartedAt = this.ctx.currentTime;
      this.loopSource.playbackRate.value = clampRate(rate);
    }
  }

  private armLoop() {
    this.clearLoopTimer();
    this.stopRawLoopSource();
    if (!this.loop || !this.playing) return;
    if (this.decodedBuffer && !this.isVideo) {
      // Loop sample-accurate con AudioBufferSourceNode nativo.
      this.startLoopBuffer(this.position);
      return;
    }
    // Fallback: elemento multimedia + salto por temporizador (menos preciso).
    this.loopTimer = window.setInterval(() => {
      if (!this.loop || !this.playing) return;
      if (this.position >= this.loop.end) this.seek(this.loop.start);
    }, 16);
  }

  private startLoopBuffer(fromPos: number) {
    if (!this.decodedBuffer || !this.loop) return;
    this.stopRawLoopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.decodedBuffer;
    src.loop = true;
    src.loopStart = this.loop.start;
    src.loopEnd = this.loop.end;
    src.playbackRate.value = clampRate(this.rate);
    src.connect(this.gain);
    const start = clamp(fromPos, this.loop.start, this.loop.end);
    this.loopBaseOffset = start;
    this.loopStartedAt = this.ctx.currentTime;
    src.start(0, start);
    this.loopSource = src;
    this.media?.pause();
  }

  private stopRawLoopSource() {
    if (!this.loopSource) return;
    try {
      this.loopSource.stop();
    } catch {
      /* ya detenido */
    }
    try {
      this.loopSource.disconnect();
    } catch {
      /* noop */
    }
    this.loopSource = null;
  }

  /** Detiene el loop-buffer y devuelve la reproducción al elemento multimedia. */
  private stopLoopBuffer() {
    if (!this.loopSource) return;
    const resumePos = this.position;
    this.stopRawLoopSource();
    if (this.playing && this.media && !this.isVideo) {
      try {
        this.media.currentTime = resumePos;
      } catch {
        /* noop */
      }
      void this.media.play().catch(() => {});
    }
  }

  private clearLoopTimer() {
    if (this.loopTimer !== null) {
      window.clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private teardown() {
    this.clearLoopTimer();
    this.stopRawLoopSource();
    this.decodedBuffer = null;
    if (this.bendTimer !== null) {
      window.clearTimeout(this.bendTimer);
      this.bendTimer = null;
    }
    if (this.media) {
      try {
        this.media.pause();
      } catch {
        /* noop */
      }
      this.media.removeAttribute("src");
      try {
        this.media.load();
      } catch {
        /* noop */
      }
    }
    if (this.mediaNode) {
      try {
        this.mediaNode.disconnect();
      } catch {
        /* noop */
      }
      this.mediaNode = null;
    }
    if (this.mediaUrl) {
      URL.revokeObjectURL(this.mediaUrl);
      this.mediaUrl = null;
    }
    this.media = null;
    this.playing = false;
    this.isVideo = false;
    this.videoW = 0;
    this.videoH = 0;
    this.videoPoster = null;
    this.analyzing = false;
  }

  dispose() {
    this.teardown();
    this.fx.dispose();
    this.stems.reset();
  }

  private applyEqBand(band: "low" | "mid" | "high") {
    const node = band === "low" ? this.eqLow : band === "mid" ? this.eqMid : this.eqHigh;
    node.gain.value = this.kill[band] ? -40 : (this.eq[band] - 0.5) * 24;
  }

  private applyGain() {
    this.gain.gain.value = this.gainAmount * 1.4;
  }

  private applyVolume() {
    this.volume.gain.value = this.volumeAmount * this.volumeAmount;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampRate(rate: number) {
  return clamp(rate, 0.0625, 16);
}

function frac(x: number) {
  return x - Math.floor(x);
}

function setPreservesPitch(el: HTMLMediaElement, on: boolean) {
  const anyEl = el as HTMLMediaElement & {
    preservesPitch?: boolean;
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };
  anyEl.preservesPitch = on;
  anyEl.mozPreservesPitch = on;
  anyEl.webkitPreservesPitch = on;
}
