/**
 * "Stems" aproximados SIN IA: separación por bandas + canal central.
 *  - BASS  = zona baja del canal central (M = (L+R)/2), filtro paso-bajo.
 *  - VOCAL = banda media del canal central (donde suele estar la voz).
 *  - MUSIC = agudos del central + todo el canal lateral (S = (L-R)/2), que es
 *            donde vive la estereofonía de instrumentos/ambiente.
 * Cada stem tiene una ganancia (0 = mute). No es Demucs, pero permite quitar la
 * voz (karaoke), aislar el bajo, etc.
 */

export type StemName = "vocal" | "bass" | "music";
export type StemLevels = { vocal: number; bass: number; music: number };

export class DeckStems {
  readonly input: GainNode;
  readonly output: GainNode;

  private vocalGain: GainNode;
  private bassGain: GainNode;
  private musicGain: GainNode;
  private levels: StemLevels = { vocal: 1, bass: 1, music: 1 };

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    const splitter = ctx.createChannelSplitter(2);
    this.input.connect(splitter);

    // Canal central M = 0.5L + 0.5R
    const midL = ctx.createGain();
    const midR = ctx.createGain();
    midL.gain.value = 0.5;
    midR.gain.value = 0.5;
    const mid = ctx.createGain();
    splitter.connect(midL, 0);
    splitter.connect(midR, 1);
    midL.connect(mid);
    midR.connect(mid);

    // Canal lateral S = 0.5L - 0.5R
    const sideL = ctx.createGain();
    const sideR = ctx.createGain();
    sideL.gain.value = 0.5;
    sideR.gain.value = -0.5;
    const side = ctx.createGain();
    splitter.connect(sideL, 0);
    splitter.connect(sideR, 1);
    sideL.connect(side);
    sideR.connect(side);

    // BASS: paso-bajo del central
    const bassLp = ctx.createBiquadFilter();
    bassLp.type = "lowpass";
    bassLp.frequency.value = 220;
    bassLp.Q.value = 0.7;
    this.bassGain = ctx.createGain();
    mid.connect(bassLp).connect(this.bassGain).connect(this.output);

    // VOCAL: banda media del central
    const vocalHp = ctx.createBiquadFilter();
    vocalHp.type = "highpass";
    vocalHp.frequency.value = 220;
    const vocalLp = ctx.createBiquadFilter();
    vocalLp.type = "lowpass";
    vocalLp.frequency.value = 4500;
    this.vocalGain = ctx.createGain();
    mid.connect(vocalHp).connect(vocalLp).connect(this.vocalGain).connect(this.output);

    // MUSIC: agudos del central + todo el lateral
    const musicHp = ctx.createBiquadFilter();
    musicHp.type = "highpass";
    musicHp.frequency.value = 4500;
    this.musicGain = ctx.createGain();
    mid.connect(musicHp).connect(this.musicGain);
    side.connect(this.musicGain);
    this.musicGain.connect(this.output);
  }

  setLevel(stem: StemName, value: number) {
    const v = Math.min(1, Math.max(0, value));
    this.levels[stem] = v;
    const target = stem === "vocal" ? this.vocalGain : stem === "bass" ? this.bassGain : this.musicGain;
    target.gain.setTargetAtTime(v, target.context.currentTime, 0.02);
  }

  reset() {
    this.setLevel("vocal", 1);
    this.setLevel("bass", 1);
    this.setLevel("music", 1);
  }

  snapshot(): StemLevels {
    return { ...this.levels };
  }
}
