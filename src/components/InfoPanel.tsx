import { memo, useRef } from "react";
import { camelotColor } from "../audio/key";
import { fileToDataUrl } from "../library/covers";
import { formatDuration, type LibraryTrack } from "../library/libraryStore";

type Props = {
  track: LibraryTrack | null;
  cover?: string;
  onSetCover: (path: string, dataUrl: string) => void;
  onLoad: (track: LibraryTrack, deck: "a" | "b") => void;
  onPreview: (track: LibraryTrack) => void;
};

export const InfoPanel = memo(function InfoPanel({ track, cover, onSetCover, onLoad, onPreview }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);

  if (!track) {
    return (
      <div className="info-panel">
        <div className="info-empty">Selecciona una pista para ver su información y su carátula.</div>
      </div>
    );
  }

  const pickImage = async () => {
    // En escritorio: diálogo nativo. En navegador: input de archivo.
    const desktopApi = window.crhis;
    if (desktopApi?.pickImage) {
      const dataUrl = await desktopApi.pickImage();
      if (dataUrl) onSetCover(track.path, dataUrl);
      return;
    }
    fileInput.current?.click();
  };

  return (
    <div className="info-panel">
      <button className="info-cover" onClick={pickImage} title="Clic para elegir una carátula">
        {cover || track.cover ? (
          <img src={cover || track.cover} alt="" />
        ) : (
          <span className="info-cover-empty">♪<em>elegir imagen</em></span>
        )}
        <span className="info-cover-edit">Cambiar carátula</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={async (event) => {
          const f = event.target.files?.[0];
          if (f) onSetCover(track.path, await fileToDataUrl(f));
          event.target.value = "";
        }}
      />

      <div className="info-title">{track.name}</div>
      <div className="info-artist">{track.artist || "Sin artista"}</div>

      <div className="info-fields">
        <div><span>BPM</span><b>{track.bpm ? track.bpm.toFixed(1) : "—"}</b></div>
        <div>
          <span>Key</span>
          <b style={track.camelot ? { color: camelotColor(track.camelot) } : undefined}>
            {track.camelot ? `${track.camelot} · ${track.key ?? ""}` : "—"}
          </b>
        </div>
        <div><span>Duración</span><b>{formatDuration(track.duration)}</b></div>
        <div><span>Álbum</span><b>{track.album || "—"}</b></div>
        <div><span>Año</span><b>{track.year || "—"}</b></div>
        <div><span>Género</span><b>{track.genre || "—"}</b></div>
        <div><span>Reproducciones</span><b>{track.playCount ?? 0}</b></div>
      </div>

      {track.comment ? <div className="info-comment">{track.comment}</div> : null}

      <div className="info-actions">
        <button onClick={() => onPreview(track)}>Pre-escuchar</button>
        <button onClick={() => onLoad(track, "a")}>→ A</button>
        <button onClick={() => onLoad(track, "b")}>→ B</button>
      </div>
    </div>
  );
});
