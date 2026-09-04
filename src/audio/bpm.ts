const MIN_BPM = 70;
const MAX_BPM = 180;
const HOP = 512;

export type BeatAnalysis = {
  bpm: number;
  /** Tiempo (s) del primer beat de la rejilla. Beat n = anchor + n * 60/bpm. */
  anchor: number;
  /** 0..1 aprox., qué tan marcado está el pulso. */
  confidence: number;
};

/** BPM + fase de la rejilla, a partir de la envolvente de onsets. */
export function analyzeBeats(buffer: AudioBuffer): BeatAnalysis | null {
  const sampleRate = buffer.sampleRate;
  const maxSamples = Math.min(buffer.length, Math.floor(sampleRate * 60));
  const data = mixToMono(buffer, maxSamples);
  const flux = onsetEnvelope(data, HOP);
  if (flux.length < 64) return null;

  const minLag = Math.round(((60 / MAX_BPM) * sampleRate) / HOP);
  const maxLag = Math.round(((60 / MIN_BPM) * sampleRate) / HOP);
  if (maxLag >= flux.length) return null;

  // Autocorrelación normalizada de la envolvente.
  const ac = new Float32Array(maxLag + 2);
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i < flux.length - lag; i++) {
      score += flux[i]! * flux[i + lag]!;
    }
    score /= flux.length - lag;
    ac[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // Corrige errores de octava: elige el periodo cuyo "peine" (energía en el
  // periodo y sus múltiplos) sea más fuerte, dentro del rango musical.
  bestLag = pickOctave(flux, bestLag, minLag, maxLag);

  // Interpolación parabólica: precisión sub-frame en el pico (clave para BPM
  // altos, donde el paso de frames es grueso).
  let refinedLag = bestLag;
  const yl = ac[bestLag - 1] ?? 0;
  const yc = ac[bestLag] ?? 0;
  const yr = ac[bestLag + 1] ?? 0;
  const denom = yl - 2 * yc + yr;
  if (denom !== 0) {
    const shift = (0.5 * (yl - yr)) / denom;
    if (Math.abs(shift) < 1) refinedLag = bestLag + shift;
  }

  let bpm = (60 * sampleRate) / (refinedLag * HOP);
  if (!Number.isFinite(bpm)) return null;
  bpm = normalizeBpm(bpm);
  const lag = ((60 / bpm) * sampleRate) / HOP;

  // Fase: desplazamiento o ∈ [0, lag) que maximiza la energía alineada al pulso.
  const lagFrames = Math.max(1, Math.round(lag));
  let bestOffset = 0;
  let bestOffsetScore = -Infinity;
  for (let o = 0; o < lagFrames; o++) {
    let sum = 0;
    let hits = 0;
    for (let k = 0; ; k++) {
      const idx = Math.round(o + k * lag);
      if (idx >= flux.length) break;
      // Suma también los frames vecinos para tolerar el redondeo.
      sum += (flux[idx] ?? 0) + 0.5 * ((flux[idx - 1] ?? 0) + (flux[idx + 1] ?? 0));
      hits++;
    }
    const norm = hits > 0 ? sum / hits : 0;
    if (norm > bestOffsetScore) {
      bestOffsetScore = norm;
      bestOffset = o;
    }
  }

  const mean = average(flux);
  const confidence = mean > 0 ? clamp01((bestOffsetScore / mean - 1) / 3) : 0;

  return {
    bpm: Math.round(bpm * 100) / 100,
    anchor: (bestOffset * HOP) / sampleRate,
    confidence,
  };
}

/** Compat: sólo el BPM. */
export function detectBpm(buffer: AudioBuffer): number | null {
  return analyzeBeats(buffer)?.bpm ?? null;
}

function pickOctave(flux: Float32Array, lag: number, minLag: number, maxLag: number): number {
  const candidates = [lag, Math.round(lag / 2), lag * 2, Math.round(lag * 2 / 3), Math.round(lag * 3 / 2)];
  let best = lag;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c < minLag || c > maxLag) continue;
    let score = 0;
    for (let m = 1; m <= 4; m++) {
      const l = c * m;
      for (let i = 0; i < flux.length - l; i++) score += flux[i]! * flux[i + l]!;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function mixToMono(buffer: AudioBuffer, length: number): Float32Array {
  const mono = new Float32Array(length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const chan = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += chan[i]! / channels;
  }
  return mono;
}

function onsetEnvelope(data: Float32Array, hop: number): Float32Array {
  const frames = Math.floor(data.length / hop);
  const flux = new Float32Array(frames);
  let prev = 0;
  for (let i = 0; i < frames; i++) {
    let energy = 0;
    const start = i * hop;
    for (let j = 0; j < hop; j++) {
      const s = data[start + j] ?? 0;
      energy += s * s;
    }
    const value = Math.sqrt(energy / hop);
    flux[i] = Math.max(0, value - prev);
    prev = value;
  }
  return flux;
}

function normalizeBpm(bpm: number): number {
  let value = bpm;
  while (value < MIN_BPM) value *= 2;
  while (value > MAX_BPM) value /= 2;
  return value;
}

function average(arr: Float32Array): number {
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
