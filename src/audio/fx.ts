/**
 * Rack de un efecto por deck. Un knob "AMOUNT" controla mezcla húmedo/seco y la
 * intensidad del efecto; para los efectos temporales hay una división de beat.
 * Todo con nodos nativos de Web Audio (sin AudioWorklet).
 */

export type FxName = "echo" | "reverb" | "flanger" | "phaser" | "gate" | "crusher";

export const FX_NAMES: FxName[] = ["echo", "reverb", "flanger", "phaser", "gate", "crusher"];
export const FX_LABEL: Record<FxName, string> = {
  echo: "ECHO",
  reverb: "REVERB",
  flanger: "FLANGER",
  phaser: "PHASER",
  gate: "GATE",
  crusher: "CRUSHER",
};

/** Efectos que usan la división de beat. */
export const FX_TIMED = new Set<FxName>(["echo", "gate"]);
/** Divisiones de beat disponibles (en beats). */
export const FX_DIVISIONS = [0.25, 0.5, 1, 2];

type Unit = {
  input: AudioNode;
  output: AudioNode;
  /** Efecto en serie (crossfade seco/húmedo) en vez de envío paralelo. */
  series: boolean;
  update: (amount: number, beatSec: number, division: number) => void;
  dispose: () => void;
};

export class DeckFx {
  readonly input: GainNode;
  readonly output: GainNode;

  private ctx: AudioContext;
  private dry: GainNode;
  private wet: GainNode;
  private unit: Unit | null = null;

  private name: FxName = "echo";
  private amount = 0;
  private division = 0.5;
  private on = false;
  private bpm = 120;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
    this.dry.gain.value = 1;
    this.wet.gain.value = 0;
    this.build();
  }

  setName(name: FxName) {
    if (name === this.name) return;
    this.name = name;
    this.build();
  }

  setAmount(a: number) {
    this.amount = Math.min(1, Math.max(0, a));
    this.apply();
  }

  setDivision(beats: number) {
    this.division = beats;
    this.apply();
  }

  setOn(on: boolean) {
    this.on = on;
    this.apply();
  }

  setBpm(bpm: number) {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    this.bpm = bpm;
    this.apply();
  }

  snapshot() {
    return { name: this.name, amount: this.amount, division: this.division, on: this.on };
  }

  dispose() {
    this.unit?.dispose();
    this.unit = null;
  }

  private build() {
    if (this.unit) {
      try {
        this.input.disconnect(this.unit.input);
      } catch {
        /* noop */
      }
      this.unit.dispose();
    }
    this.unit = createUnit(this.ctx, this.name);
    this.input.connect(this.unit.input);
    this.unit.output.connect(this.wet);
    this.apply();
  }

  private apply() {
    const now = this.ctx.currentTime;
    const wet = this.on ? this.amount : 0;
    const series = this.unit?.series ?? false;
    this.wet.gain.setTargetAtTime(wet, now, 0.03);
    this.dry.gain.setTargetAtTime(series ? 1 - wet : 1, now, 0.03);
    const beatSec = 60 / this.bpm;
    this.unit?.update(this.on ? this.amount : 0, beatSec, this.division);
  }
}

function createUnit(ctx: AudioContext, name: FxName): Unit {
  switch (name) {
    case "echo":
      return echoUnit(ctx);
    case "reverb":
      return reverbUnit(ctx);
    case "flanger":
      return flangerUnit(ctx);
    case "phaser":
      return phaserUnit(ctx);
    case "gate":
      return gateUnit(ctx);
    case "crusher":
      return crusherUnit(ctx);
  }
}

function echoUnit(ctx: AudioContext): Unit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay(4);
  const fb = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2600;
  delay.delayTime.value = 0.3;
  fb.gain.value = 0;
  input.connect(delay);
  delay.connect(tone).connect(fb).connect(delay);
  delay.connect(output);
  return {
    input,
    output,
    series: false,
    update(amount, beatSec, division) {
      delay.delayTime.setTargetAtTime(beatSec * division, ctx.currentTime, 0.05);
      fb.gain.setTargetAtTime(0.15 + amount * 0.7, ctx.currentTime, 0.05);
    },
    dispose() {
      [input, output, delay, fb, tone].forEach((n) => safeDisconnect(n));
    },
  };
}

function reverbUnit(ctx: AudioContext): Unit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, 2.2, 2.5);
  input.connect(conv).connect(output);
  return {
    input,
    output,
    series: false,
    update() {
      /* la mezcla la controla wet.gain */
    },
    dispose() {
      [input, output, conv].forEach((n) => safeDisconnect(n));
    },
  };
}

function flangerUnit(ctx: AudioContext): Unit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay(0.05);
  const fb = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  delay.delayTime.value = 0.005;
  fb.gain.value = 0.3;
  lfo.type = "sine";
  lfo.frequency.value = 0.25;
  lfoGain.gain.value = 0.002;
  lfo.connect(lfoGain).connect(delay.delayTime);
  input.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(output);
  lfo.start();
  return {
    input,
    output,
    series: false,
    update(amount) {
      lfoGain.gain.setTargetAtTime(0.0006 + amount * 0.0035, ctx.currentTime, 0.05);
      fb.gain.setTargetAtTime(0.2 + amount * 0.55, ctx.currentTime, 0.05);
    },
    dispose() {
      try {
        lfo.stop();
      } catch {
        /* noop */
      }
      [input, output, delay, fb, lfo, lfoGain].forEach((n) => safeDisconnect(n));
    },
  };
}

function phaserUnit(ctx: AudioContext): Unit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const stages: BiquadFilterNode[] = [];
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = "sine";
  lfo.frequency.value = 0.3;
  lfoGain.gain.value = 700;
  let node: AudioNode = input;
  for (let i = 0; i < 5; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = "allpass";
    ap.frequency.value = 500 + i * 400;
    ap.Q.value = 6;
    lfo.connect(lfoGain).connect(ap.frequency);
    node.connect(ap);
    node = ap;
    stages.push(ap);
  }
  node.connect(output);
  lfo.start();
  return {
    input,
    output,
    series: false,
    update(amount) {
      lfoGain.gain.setTargetAtTime(200 + amount * 1400, ctx.currentTime, 0.05);
      lfo.frequency.setTargetAtTime(0.15 + amount * 0.9, ctx.currentTime, 0.1);
    },
    dispose() {
      try {
        lfo.stop();
      } catch {
        /* noop */
      }
      [input, output, lfo, lfoGain, ...stages].forEach((n) => safeDisconnect(n));
    },
  };
}

function gateUnit(ctx: AudioContext): Unit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const gate = ctx.createGain();
  gate.gain.value = 1;
  const lfo = ctx.createOscillator();
  lfo.type = "square";
  lfo.frequency.value = 4;
  const shaper = ctx.createWaveShaper();
  const gateCurve = new Float32Array(new ArrayBuffer(4 * 4));
  gateCurve.set([0, 0, 1, 1]); // -1/0 → 0, +1 → 1
  shaper.curve = gateCurve;
  const depth = ctx.createGain();
  depth.gain.value = 0;
  const base = ctx.createConstantSource();
  base.offset.value = 1;
  lfo.connect(shaper).connect(depth).connect(gate.gain);
  base.connect(gate.gain);
  input.connect(gate).connect(output);
  lfo.start();
  base.start();
  return {
    input,
    output,
    series: true,
    update(amount, beatSec, division) {
      lfo.frequency.setTargetAtTime(1 / (beatSec * division), ctx.currentTime, 0.02);
      // base baja y depth sube: la ganancia oscila entre (1-amount) y 1.
      base.offset.setTargetAtTime(1 - amount, ctx.currentTime, 0.03);
      depth.gain.setTargetAtTime(amount, ctx.currentTime, 0.03);
    },
    dispose() {
      try {
        lfo.stop();
        base.stop();
      } catch {
        /* noop */
      }
      [input, output, gate, lfo, shaper, depth, base].forEach((n) => safeDisconnect(n));
    },
  };
}

function crusherUnit(ctx: AudioContext): Unit {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const down = ctx.createBiquadFilter();
  down.type = "lowpass";
  down.frequency.value = 20000;
  shaper.curve = crushCurve(16);
  input.connect(shaper).connect(down).connect(output);
  return {
    input,
    output,
    series: true,
    update(amount) {
      const levels = Math.max(2, Math.round(2 ** (2 + (1 - amount) * 6))); // 256 → 4
      shaper.curve = crushCurve(levels);
      down.frequency.setTargetAtTime(1200 + (1 - amount) * 18000, ctx.currentTime, 0.05);
    },
    dispose() {
      [input, output, shaper, down].forEach((n) => safeDisconnect(n));
    },
  };
}

function crushCurve(levels: number) {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function safeDisconnect(node: AudioNode) {
  try {
    node.disconnect();
  } catch {
    /* noop */
  }
}
