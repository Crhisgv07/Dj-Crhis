/** Banco de samples compartido: 8 slots, disparo one-shot al master. */

export type SamplerSlotState = { name: string; playing: boolean } | null;

type Slot = { buffer: AudioBuffer; name: string } | null;

export class Sampler {
  readonly output: GainNode;

  private ctx: AudioContext;
  private slots: Slot[] = Array.from({ length: 8 }, () => null);
  private active = new Map<number, AudioBufferSourceNode>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0.85;
  }

  async load(index: number, arrayBuffer: ArrayBuffer, name: string) {
    if (index < 0 || index > 7) return;
    const buffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    this.slots[index] = { buffer, name: name.replace(/\.[^.]+$/, "") };
  }

  clear(index: number) {
    this.stop(index);
    this.slots[index] = null;
  }

  trigger(index: number) {
    const slot = this.slots[index];
    if (!slot) return;
    this.stop(index);
    const src = this.ctx.createBufferSource();
    src.buffer = slot.buffer;
    src.connect(this.output);
    src.onended = () => {
      if (this.active.get(index) === src) this.active.delete(index);
    };
    src.start(0);
    this.active.set(index, src);
  }

  stop(index: number) {
    const src = this.active.get(index);
    if (!src) return;
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* ya detenido */
    }
    src.disconnect();
    this.active.delete(index);
  }

  stopAll() {
    for (const i of [...this.active.keys()]) this.stop(i);
  }

  snapshot(): SamplerSlotState[] {
    return this.slots.map((slot, i) =>
      slot ? { name: slot.name, playing: this.active.has(i) } : null,
    );
  }
}
