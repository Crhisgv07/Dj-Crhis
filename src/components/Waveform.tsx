import { memo, useEffect, useRef } from "react";
import type { DeckSnapshot } from "../audio/types";

type Props = {
  deck: DeckSnapshot;
  position: number;
  accent: string;
  onSeek: (time: number) => void;
};

export const Waveform = memo(function Waveform({ deck, position, accent, onSeek }: Props) {
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    drawOverview(overviewRef.current, deck, position, accent);
    drawZoom(zoomRef.current, deck, position, accent);
  }, [deck, position, accent]);

  // Redibuja cuando cambia el tamaño del contenedor (ventana redimensionada,
  // paneles que crecen). Sin esto el canvas queda estirado o borroso.
  useEffect(() => {
    const overview = overviewRef.current;
    const zoom = zoomRef.current;
    if (!overview || !zoom || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      drawOverview(overviewRef.current, deck, position, accent);
      drawZoom(zoomRef.current, deck, position, accent);
    });
    observer.observe(overview);
    observer.observe(zoom);
    return () => observer.disconnect();
  }, [deck, position, accent]);

  return (
    <div className="wave-card">
      <div className="wave-head">
        <span>
          Deck {deck.id.toUpperCase()} · <b>{deck.title || "Vacío"}</b>
        </span>
        <span>{deck.bpm ? `${deck.bpm.toFixed(1)} BPM` : "BPM —"}</span>
      </div>
      <canvas
        ref={overviewRef}
        height={46}
        style={{ width: "100%", height: 46, display: "block", cursor: "pointer" }}
        onClick={(event) => {
          if (!deck.duration) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onSeek(((event.clientX - rect.left) / rect.width) * deck.duration);
        }}
      />
      <canvas
        ref={zoomRef}
        height={70}
        style={{ width: "100%", height: 70, display: "block", marginTop: 3 }}
      />
    </div>
  );
});

/** Fondo de "sin señal": línea central + rejilla tenue + marca de agua. */
function drawIdle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  accent: string,
  withLabel = false,
) {
  const mid = height / 2;
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.moveTo(0, mid + 0.5);
  ctx.lineTo(width, mid + 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (withLabel) {
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    ctx.font = "600 10px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "middle";
    ctx.fillText("NO SIGNAL", 10, mid);
  }
}

function sizeCanvas(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}

function drawOverview(
  canvas: HTMLCanvasElement | null,
  deck: DeckSnapshot,
  position: number,
  accent: string,
) {
  if (!canvas) return;
  const sized = sizeCanvas(canvas);
  if (!sized.ctx) return;
  const { ctx, width, height } = sized;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#07080a";
  ctx.fillRect(0, 0, width, height);
  if (!deck.peaks) {
    drawIdle(ctx, width, height, accent, false);
    return;
  }

  const mid = height / 2;
  const played = deck.duration ? position / deck.duration : 0;
  for (let i = 0; i < deck.peaks.length; i++) {
    const x = (i / deck.peaks.length) * width;
    const h = Math.max(1, deck.peaks[i]! * (height * 0.86));
    ctx.fillStyle = i / deck.peaks.length <= played ? accent : "#3b3d46";
    ctx.fillRect(x, mid - h / 2, Math.max(1, width / deck.peaks.length), h);
  }

  deck.hotCues.forEach((cue) => {
    if (!cue || !deck.duration) return;
    const x = (cue.time / deck.duration) * width;
    ctx.fillStyle = cue.color;
    ctx.fillRect(x, 0, 2, height);
  });

  if (deck.beatGrid && deck.duration) {
    const beat = 60 / deck.beatGrid.bpm;
    const anchor = deck.beatGrid.anchor;
    const firstIndex = Math.ceil((0 - anchor) / beat);
    for (let n = firstIndex; ; n++) {
      const t = anchor + n * beat;
      if (t >= deck.duration) break;
      if (t < 0) continue;
      const x = (t / deck.duration) * width;
      const downbeat = ((n % 4) + 4) % 4 === 0;
      ctx.fillStyle = downbeat ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)";
      ctx.fillRect(x, 0, downbeat ? 1.4 : 0.6, height);
    }
  }

  if (deck.duration) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(played * width, 0, 1.5, height);
  }
}

function drawZoom(
  canvas: HTMLCanvasElement | null,
  deck: DeckSnapshot,
  position: number,
  accent: string,
) {
  if (!canvas) return;
  const sized = sizeCanvas(canvas);
  if (!sized.ctx) return;
  const { ctx, width, height } = sized;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#06070a";
  ctx.fillRect(0, 0, width, height);
  if (!deck.peaks || !deck.duration) {
    drawIdle(ctx, width, height, accent, true);
    return;
  }

  const windowSec = 8;
  const start = Math.max(0, position - windowSec / 2);
  const end = Math.min(deck.duration, start + windowSec);
  const startIndex = Math.floor((start / deck.duration) * deck.peaks.length);
  const endIndex = Math.max(startIndex + 1, Math.floor((end / deck.duration) * deck.peaks.length));
  const mid = height / 2;
  const slice = endIndex - startIndex;

  for (let i = 0; i < slice; i++) {
    const peak = deck.peaks[startIndex + i] ?? 0;
    const x = (i / slice) * width;
    const h = Math.max(1, peak * (height * 0.9));
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(x, mid - h / 2, Math.max(1, width / slice), h);
  }
  ctx.globalAlpha = 1;
  if (deck.beatGrid) {
    const beat = 60 / deck.beatGrid.bpm;
    const anchor = deck.beatGrid.anchor;
    const firstN = Math.ceil((start - anchor) / beat);
    for (let n = firstN; ; n++) {
      const t = anchor + n * beat;
      if (t > end) break;
      const x = ((t - start) / (end - start)) * width;
      const downbeat = ((n % 4) + 4) % 4 === 0;
      ctx.fillStyle = downbeat ? "rgba(120,200,255,0.5)" : "rgba(255,255,255,0.16)";
      ctx.fillRect(x, 0, downbeat ? 2 : 1, height);
    }
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(width / 2, 0, 2, height);
}
