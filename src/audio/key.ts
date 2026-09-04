/**
 * Detección de tonalidad musical: chromagrama (energía por clase de altura,
 * calculada con Goertzel) correlacionado con los 24 perfiles de Krumhansl.
 * Devuelve la clave, su notación Camelot (rueda armónica de DJ) y compatibilidad.
 */

export type KeyResult = {
  /** Clase de altura de la tónica, 0 = Do. */
  pitchClass: number;
  mode: "major" | "minor";
  /** Ej. "F#m", "Ab". */
  name: string;
  /** Ej. "11A", "4B". */
  camelot: string;
};

const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// Perfiles Krumhansl-Kessler (relativos), rotados sobre las 12 tónicas.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Camelot: índice = clase de altura (0=Do). Mayor = "B", menor = "A".
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

export function camelotOf(pitchClass: number, mode: "major" | "minor"): string {
  const n = (mode === "major" ? CAMELOT_MAJOR : CAMELOT_MINOR)[((pitchClass % 12) + 12) % 12]!;
  return `${n}${mode === "major" ? "B" : "A"}`;
}

/** Claves compatibles para mezcla armónica: misma, ±1 en la rueda, y el par mayor/menor. */
export function compatibleCamelot(camelot: string): string[] {
  const m = /^(\d{1,2})([AB])$/.exec(camelot);
  if (!m) return [];
  const num = Number(m[1]);
  const letter = m[2] as "A" | "B";
  const other = letter === "A" ? "B" : "A";
  const wrap = (x: number) => ((x - 1 + 12) % 12) + 1;
  return [
    `${num}${letter}`,
    `${wrap(num - 1)}${letter}`,
    `${wrap(num + 1)}${letter}`,
    `${num}${other}`,
  ];
}

export function areKeysCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return compatibleCamelot(a).includes(b);
}

/** Color HSL estable por número de Camelot (para la biblioteca/tags). */
export function camelotColor(camelot: string | null): string {
  const m = camelot ? /^(\d{1,2})/.exec(camelot) : null;
  if (!m) return "#8a8d94";
  const hue = ((Number(m[1]) - 1) / 12) * 360;
  return `hsl(${hue} 70% 62%)`;
}

export function detectKey(buffer: AudioBuffer): KeyResult | null {
  const chroma = chromagram(buffer);
  if (!chroma) return null;

  let best = { score: -Infinity, pc: 0, mode: "major" as "major" | "minor" };
  for (let t = 0; t < 12; t++) {
    const maj = correlate(chroma, MAJOR_PROFILE, t);
    if (maj > best.score) best = { score: maj, pc: t, mode: "major" };
    const min = correlate(chroma, MINOR_PROFILE, t);
    if (min > best.score) best = { score: min, pc: t, mode: "minor" };
  }

  const name = NOTE_NAMES[best.pc]! + (best.mode === "minor" ? "m" : "");
  return { pitchClass: best.pc, mode: best.mode, name, camelot: camelotOf(best.pc, best.mode) };
}

/** Vector de 12 clases de altura, energía acumulada de MIDI 36..96. */
function chromagram(buffer: AudioBuffer): Float32Array | null {
  const srcRate = buffer.sampleRate;
  const decim = 4;
  const rate = srcRate / decim;

  // Downmix a mono + decimación con promedio (anti-alias básico).
  const maxSrc = Math.min(buffer.length, Math.floor(srcRate * 90));
  const outLen = Math.floor(maxSrc / decim);
  if (outLen < 8192) return null;
  const mono = new Float32Array(outLen);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < outLen; i++) {
      let acc = 0;
      for (let k = 0; k < decim; k++) acc += data[i * decim + k] ?? 0;
      mono[i] += acc / (decim * channels);
    }
  }

  const N = 8192;
  const hop = 4096;
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  const midiLo = 36;
  const midiHi = 96;
  const coeffs: number[] = [];
  const pcOf: number[] = [];
  const weight: number[] = [];
  for (let m = midiLo; m <= midiHi; m++) {
    const freq = 440 * Math.pow(2, (m - 69) / 12);
    if (freq >= rate / 2) break;
    coeffs.push(2 * Math.cos((2 * Math.PI * freq) / rate));
    pcOf.push(((m % 12) + 12) % 12);
    weight.push(m >= 48 && m <= 72 ? 1 : 0.5);
  }

  const chroma = new Float32Array(12);
  for (let start = 0; start + N <= mono.length; start += hop) {
    for (let n = 0; n < coeffs.length; n++) {
      const coeff = coeffs[n]!;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < N; i++) {
        s0 = mono[start + i]! * hann[i]! + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      chroma[pcOf[n]!]! += Math.sqrt(Math.max(0, power)) * weight[n]!;
    }
  }

  // Normaliza a media 0 / varianza 1 para la correlación.
  return normalize(chroma);
}

function normalize(v: Float32Array): Float32Array {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let variance = 0;
  for (const x of v) variance += (x - mean) ** 2;
  const std = Math.sqrt(variance / v.length) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i]! - mean) / std;
  return out;
}

function correlate(chroma: Float32Array, profile: number[], tonic: number): number {
  // profile ya se normaliza al vuelo; chroma viene normalizado.
  let pMean = 0;
  for (const x of profile) pMean += x;
  pMean /= 12;
  let dot = 0;
  let pNorm = 0;
  for (let i = 0; i < 12; i++) {
    const p = profile[(i - tonic + 12) % 12]! - pMean;
    dot += chroma[i]! * p;
    pNorm += p * p;
  }
  return dot / (Math.sqrt(pNorm) || 1);
}
