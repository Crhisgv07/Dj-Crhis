/**
 * Auto-gain: valor 0..1 para el knob GAIN que nivela la pista a un RMS objetivo.
 * (El knob aplica `value * 1.4` al nodo, así que devolvemos ya en esa escala.)
 */
export function analyzeGain(buffer: AudioBuffer): number {
  const channel = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(channel.length / 400_000));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < channel.length; i += step) {
    const v = channel[i] ?? 0;
    sum += v * v;
    count++;
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  const target = 0.12;
  if (rms < 1e-5) return 0.7;
  const gain = target / rms / 1.4; // deshace el ×1.4 del nodo
  return Math.min(1, Math.max(0.25, gain));
}

export function extractPeaks(buffer: AudioBuffer, bars = 1800): Float32Array {
  const channel = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(channel.length / bars));
  const peaks = new Float32Array(bars);

  for (let i = 0; i < bars; i++) {
    const start = i * block;
    let max = 0;
    const end = Math.min(start + block, channel.length);
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j] ?? 0);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }

  return peaks;
}
