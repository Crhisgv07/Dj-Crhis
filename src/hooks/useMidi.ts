import { useEffect, useState } from "react";
import { midi } from "../midi/midiManager";

export function useMidi() {
  const [state, setState] = useState(() => midi.getState());
  useEffect(() => {
    const off = midi.subscribe(() => setState(midi.getState()));
    return () => {
      off();
    };
  }, []);
  return state;
}
