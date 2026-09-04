/** Carátulas persistentes: data URL por ruta de archivo. */

import { STORE_COVERS, idbGet, idbPut } from "./db";

export function getCover(path: string): Promise<string | null> {
  return idbGet<string>(STORE_COVERS, path);
}

export function setCover(path: string, dataUrl: string): Promise<void> {
  return idbPut(STORE_COVERS, dataUrl, path);
}

/** Lee un File de imagen como data URL (para arrastrar una portada a un deck). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}
