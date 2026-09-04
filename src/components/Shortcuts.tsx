type Props = {
  open: boolean;
  onClose: () => void;
};

const ROWS: Array<[string, string]> = [
  ["Espacio / Q", "Play/Pause Deck A"],
  ["W", "Play/Pause Deck B"],
  ["A (mantener)", "Cue Deck A"],
  ["S (mantener)", "Cue Deck B"],
  ["Clic en waveform", "Saltar a esa posición"],
  ["Clic derecho en CUE", "Fijar punto de cue aquí"],
  ["Clic derecho en hot cue", "Borrar ese hot cue"],
  ["Arrastrar fila → deck", "Cargar pista en ese deck"],
  ["?", "Abrir/cerrar esta ayuda"],
];

export function Shortcuts({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="modal-back" onClick={onClose}>
      <section className="settings" onClick={(event) => event.stopPropagation()}>
        <div className="midi-head">
          <h2>Atajos de teclado</h2>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <div className="shortcuts-body">
          {ROWS.map(([keys, action]) => (
            <div className="shortcut-row" key={keys}>
              <kbd>{keys}</kbd>
              <span>{action}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
