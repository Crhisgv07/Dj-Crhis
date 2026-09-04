import type { DeckId } from "../audio/types";
import { engine } from "../audio/engine";

export function desktop() {
  return window.crhis;
}

export function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).buffer;
  }
  if (data && typeof data === "object") {
    const maybe = data as { type?: string; data?: number[] };
    if (maybe.type === "Buffer" && Array.isArray(maybe.data)) {
      return Uint8Array.from(maybe.data).buffer;
    }
  }
  throw new Error("No se pudo leer el audio");
}

export async function loadFromPath(
  filePath: string,
  deck: DeckId,
  title?: string,
  extra?: { artist?: string; bpm?: number | null },
) {
  const api = desktop();
  if (!api) throw new Error("La API de escritorio no está lista. Reinicia la app.");
  const track = await api.readTrack(filePath);
  await engine.unlock();
  await engine.loadDeck(deck, toArrayBuffer(track.buffer), title || track.name, track.path, extra);
}

export async function loadFromFile(file: File, deck: DeckId) {
  await engine.unlock();
  const buffer = await file.arrayBuffer();
  const filePath = desktop()?.pathForFile(file) || file.name;
  await engine.loadDeck(deck, buffer, file.name.replace(/\.[^.]+$/, ""), filePath);
  return filePath;
}

export async function previewPath(filePath: string, title?: string) {
  const api = desktop();
  if (!api) throw new Error("La API de escritorio no está lista. Reinicia la app.");
  const track = await api.readTrack(filePath);
  await engine.preview(toArrayBuffer(track.buffer), title || track.name);
}

export async function readMeta(filePath: string) {
  const api = desktop();
  if (!api?.readHead) return null;
  const head = await api.readHead(filePath);
  return { ...head, buffer: toArrayBuffer(head.buffer) };
}
