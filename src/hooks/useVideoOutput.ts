import { useEffect, useRef } from "react";
import { engine } from "../audio/engine";
import { desktop } from "../desktop/api";

/** Abre/cierra y sincroniza la ventana de salida de video de Electron: envía las
 *  dos fuentes (para mezclarlas), el crossfader y el efecto de video. En
 *  navegador (sin `window.crhis.video`) no hace nada. */
export function useVideoOutput() {
  const shown = useRef<{ a: string | null; b: string | null }>({ a: null, b: null });

  useEffect(() => {
    const api = desktop();
    const video = api?.video;
    if (!video) return;

    const evaluate = () => {
      const program = engine.videoProgram();
      if (!program) {
        if (shown.current.a || shown.current.b) {
          shown.current = { a: null, b: null };
          void video.hide();
        }
        return;
      }
      const a = program.a?.path ?? null;
      const b = program.b?.path ?? null;
      if (a !== shown.current.a || b !== shown.current.b) {
        shown.current = { a, b };
        void video.show(JSON.stringify({ a, b }));
      }
    };

    const off = engine.subscribe(evaluate);
    evaluate();

    let raf = 0;
    let odd = 0;
    const tick = () => {
      odd ^= 1;
      if (!odd) {
        const program = engine.videoProgram();
        if (program) video.sync(program as unknown as { time: number; rate: number; paused: boolean });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      off();
      cancelAnimationFrame(raf);
      void video.hide();
    };
  }, []);
}
