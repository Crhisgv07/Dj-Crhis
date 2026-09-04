import { memo } from "react";

type Props = {
  /** Nivel 0..1 (pico). */
  level: number;
  segments?: number;
  /** Orientación de la tira de LEDs. */
  orientation?: "vertical" | "horizontal";
};

/** Medidor de LEDs discretos, estilo mixer físico: verde → ámbar → rojo. */
export const Vu = memo(function Vu({ level, segments = 14, orientation = "vertical" }: Props) {
  const lit = Math.round(Math.min(1, level * 1.08) * segments);
  const clip = level > 0.96;
  return (
    <div className={`vu vu-${orientation} ${clip ? "clip" : ""}`}>
      {Array.from({ length: segments }, (_, i) => {
        const zone =
          i >= segments - 2 ? "red" : i >= segments - 5 ? "amber" : "green";
        return <span key={i} className={`vu-seg ${zone} ${i < lit ? "on" : ""}`} />;
      })}
    </div>
  );
});
