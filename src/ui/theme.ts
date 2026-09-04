import type { DeckId } from "../audio/types";

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.0";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

export function deckAccent(id: DeckId) {
  return id === "a" ? "#27e0c3" : "#ff4f9a";
}
