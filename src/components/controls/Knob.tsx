import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

type Props = {
  label: string;
  /** Valor normalizado 0..1. */
  value: number;
  /** Valor al que vuelve con doble clic. */
  center?: number;
  /** Color del arco de valor. */
  color?: string;
  size?: number;
  killed?: boolean;
  /** Texto a mostrar bajo la perilla en vez del label (p. ej. el % de pitch). */
  readout?: string;
  onChange: (value: number) => void;
  onKill?: () => void;
};

const SWEEP = 270; // grados totales de recorrido

export function Knob({
  label,
  value,
  center = 0.5,
  color = "var(--amber)",
  size = 46,
  killed = false,
  readout,
  onChange,
  onKill,
}: Props) {
  const drag = useRef<{ y: number; value: number; fine: boolean } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const clamped = Math.min(1, Math.max(0, value));
  const angle = -SWEEP / 2 + clamped * SWEEP;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dy = d.y - event.clientY;
      const gain = event.shiftKey || d.fine ? 620 : 210;
      onChangeRef.current(Math.min(1, Math.max(0, d.value + dy / gain)));
    };
    const up = () => {
      drag.current = null;
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      drag.current = { y: event.clientY, value: clamped, fine: event.shiftKey };
      document.body.style.cursor = "ns-resize";
    },
    [clamped],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 0.01 : 0.04;
      onChange(Math.min(1, Math.max(0, clamped + (event.deltaY < 0 ? step : -step))));
    },
    [clamped, onChange],
  );

  return (
    <div className={`knob ${killed ? "killed" : ""}`} style={{ ["--knob-size" as string]: `${size}px` }}>
      <div
        className="knob-dial"
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        style={{
          ["--knob-angle" as string]: `${angle}deg`,
          ["--knob-pct" as string]: clamped,
          ["--knob-color" as string]: color,
        }}
        onPointerDown={onPointerDown}
        onWheel={onWheel}
        onDoubleClick={() => onChange(center)}
        onContextMenu={(event) => {
          if (!onKill) return;
          event.preventDefault();
          onKill();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            onChange(Math.min(1, clamped + 0.04));
          }
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            onChange(Math.max(0, clamped - 0.04));
          }
        }}
      >
        <span className="knob-arc" />
        <span className="knob-body">
          <span className="knob-indicator" />
        </span>
      </div>
      <button type="button" className="knob-label" onClick={onKill} title={onKill ? "Kill" : undefined}>
        {readout ?? label}
      </button>
    </div>
  );
}
