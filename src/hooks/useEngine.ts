import { useEffect, useRef, useState } from "react";
import { engine } from "../audio/engine";
import type { EngineSnapshot, LiveState } from "../audio/types";

/** Estado estructural del motor: sólo se re-renderiza cuando el motor emite un
 *  cambio discreto (cargar pista, play/pause, EQ, hot cues, loops…). */
export function useEngine(): EngineSnapshot {
  const [snap, setSnap] = useState<EngineSnapshot>(() => engine.snapshot());
  useEffect(() => {
    const off = engine.subscribe(() => setSnap(engine.snapshot()));
    return () => {
      off();
    };
  }, []);
  return snap;
}

/** Estado de alta frecuencia (posición + medidores) en un bucle rAF.
 *  Se detiene solo cuando nada suena y los medidores ya cayeron a cero, para no
 *  mantener despierto el hilo de render sin necesidad. */
export function usePlayback(): LiveState {
  const [live, setLive] = useState<LiveState>(() => engine.liveState());
  const idleRef = useRef(0);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      const next = engine.liveState();
      const busy =
        next.a.playing ||
        next.b.playing ||
        next.previewPlaying ||
        next.recording.active ||
        next.levels.a > 0.001 ||
        next.levels.b > 0.001 ||
        next.levels.master > 0.001;
      if (busy) {
        idleRef.current = 0;
        setLive(next);
      } else if (idleRef.current < 4) {
        // Deja que los medidores terminen de caer a cero tras el último sonido.
        idleRef.current += 1;
        setLive(next);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return live;
}

/** Alias histórico. Ahora es sólo el estado estructural: los consumidores de
 *  posición usan `usePlayback`. */
export function useSnapshot(): EngineSnapshot {
  return useEngine();
}
