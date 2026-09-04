/** Caché en IndexedDB del análisis por pista (BPM, rejilla, tonalidad, peaks,
 *  auto-gain). Evita re-analizar al recargar una pista ya vista. */

import { STORE_ANALYSIS, idbGet, idbPut } from "./db";

export type CachedAnalysis = {
  path: string;
  bpm: number | null;
  anchor: number | null;
  keyName: string | null;
  camelot: string | null;
  gain: number;
  duration: number;
  peaks: number[];
  ts: number;
};

export function getCachedAnalysis(path: string): Promise<CachedAnalysis | null> {
  return idbGet<CachedAnalysis>(STORE_ANALYSIS, path);
}

export function putCachedAnalysis(entry: CachedAnalysis): Promise<void> {
  return idbPut(STORE_ANALYSIS, entry);
}
