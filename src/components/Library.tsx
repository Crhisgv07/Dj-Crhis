import { memo, useEffect, useMemo, useState } from "react";
import { camelotColor } from "../audio/key";
import type { DeckId } from "../audio/types";
import {
  addToCrate,
  loadCrates,
  newCrate,
  removeFromCrate,
  saveCrates,
  type Crate,
} from "../library/crates";
import type { LibraryTrack } from "../library/libraryStore";
import { formatDuration } from "../library/libraryStore";

type Props = {
  tracks: LibraryTrack[];
  covers?: Map<string, string>;
  folderFilter?: Set<string> | null;
  selected: number;
  previewTitle?: string;
  onSelect: (index: number) => void;
  onLoad: (track: LibraryTrack, deck: DeckId) => void;
  onPreview: (track: LibraryTrack) => void;
  onOpenFiles: () => void;
  onOpenFolder: () => void;
  onDropCover?: (path: string, file: File) => void;
  onClearFolder?: () => void;
};

export const Library = memo(function Library({
  tracks,
  covers,
  folderFilter,
  selected,
  previewTitle,
  onSelect,
  onLoad,
  onPreview,
  onOpenFiles,
  onOpenFolder,
  onDropCover,
  onClearFolder,
}: Props) {
  const [query, setQuery] = useState("");
  const [crates, setCrates] = useState<Crate[]>(() => loadCrates());
  const [activeCrate, setActiveCrate] = useState<string | null>(null);
  const [dropCrate, setDropCrate] = useState<string | null>(null);

  useEffect(() => {
    saveCrates(crates);
  }, [crates]);

  const activePaths = useMemo(
    () => (activeCrate ? new Set(crates.find((c) => c.id === activeCrate)?.paths ?? []) : null),
    [activeCrate, crates],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tracks;
    if (folderFilter) list = list.filter((t) => folderFilter.has(t.path));
    if (activePaths) list = list.filter((t) => activePaths.has(t.path));
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          (t.camelot ?? "").toLowerCase().includes(q) ||
          t.path.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tracks, query, activePaths, folderFilter]);

  const addCrate = () => {
    const name = window.prompt("Nombre del crate")?.trim();
    if (!name) return;
    const c = newCrate(name);
    setCrates((cs) => [...cs, c]);
    setActiveCrate(c.id);
  };

  return (
    <section className="library">
      <div className="library-head">
        <h2>
          {folderFilter ? "Carpeta" : "Biblioteca"} · {filtered.length}
          {folderFilter ? (
            <button className="ghost tiny-btn" onClick={onClearFolder} title="Ver toda la biblioteca">
              ✕
            </button>
          ) : null}
        </h2>
        <div className="library-actions">
          <input
            className="search"
            placeholder="Buscar título, artista, key…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="ghost" onClick={onOpenFiles}>
            Archivos
          </button>
          <button className="ghost" onClick={onOpenFolder}>
            Carpeta
          </button>
        </div>
      </div>

      <div className="crate-list">
        <button
          className={`crate ${activeCrate === null ? "on" : ""}`}
          onClick={() => setActiveCrate(null)}
        >
          Todas <span>{tracks.length}</span>
        </button>
        {crates.map((c) => (
          <button
            key={c.id}
            className={`crate ${activeCrate === c.id ? "on" : ""} ${dropCrate === c.id ? "drop" : ""}`}
            onClick={() => setActiveCrate(c.id)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("text/crhis-track")) return;
              e.preventDefault();
              setDropCrate(c.id);
            }}
            onDragLeave={() => setDropCrate((d) => (d === c.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              setDropCrate(null);
              const path = e.dataTransfer.getData("text/crhis-track");
              if (path) setCrates((cs) => addToCrate(cs, c.id, path));
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (window.confirm(`¿Borrar el crate "${c.name}"?`)) {
                setCrates((cs) => cs.filter((x) => x.id !== c.id));
                setActiveCrate((a) => (a === c.id ? null : a));
              }
            }}
            title="Arrastra pistas aquí · clic derecho para borrar"
          >
            {c.name} <span>{c.paths.length}</span>
          </button>
        ))}
        <button className="crate add" onClick={addCrate}>
          + Crate
        </button>
      </div>

      {previewTitle ? <div className="preview-bar">PREVIEW · {previewTitle} · solo cue</div> : null}

      {filtered.length === 0 ? (
        <div className="empty">
          {activeCrate
            ? "Crate vacío. Arrastra pistas desde \"Todas\"."
            : "Arrastra audio o video, o abre una carpeta. Doble clic carga al deck. Arrastra una fila al plato."}
        </div>
      ) : (
        <div className="track-table-wrap">
          <table className="track-table">
            <thead>
              <tr>
                <th />
                <th>Título</th>
                <th>Artista</th>
                <th>BPM</th>
                <th>Key</th>
                <th>Tiempo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((track) => {
                const index = tracks.findIndex((item) => item.path === track.path);
                return (
                  <tr
                    key={track.id}
                    className={index === selected ? "selected" : ""}
                    draggable
                    onClick={() => onSelect(index)}
                    onDoubleClick={() => onLoad(track, "a")}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/crhis-track", track.path);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      const f = event.dataTransfer.files?.[0];
                      if (f && f.type.startsWith("image/")) {
                        event.preventDefault();
                        event.stopPropagation();
                        onDropCover?.(track.path, f);
                      }
                    }}
                  >
                    <td>
                      {covers?.get(track.path) || track.cover ? (
                        <img className="cover" src={covers?.get(track.path) || track.cover} alt="" />
                      ) : (
                        <span className="cover empty-cover" />
                      )}
                    </td>
                    <td>{track.name}</td>
                    <td>{track.artist || "—"}</td>
                    <td>{track.bpm ? track.bpm.toFixed(1) : "—"}</td>
                    <td className="key-cell">
                      {track.camelot ? (
                        <span className="key-badge" style={{ color: camelotColor(track.camelot) }}>
                          {track.camelot}
                          <em>{track.key}</em>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{formatDuration(track.duration)}</td>
                    <td className="row-actions">
                      <button onClick={() => onPreview(track)}>CUE</button>
                      <button onClick={() => onLoad(track, "a")}>A</button>
                      <button onClick={() => onLoad(track, "b")}>B</button>
                      {activeCrate ? (
                        <button
                          title="Quitar del crate"
                          onClick={() => setCrates((cs) => removeFromCrate(cs, activeCrate, track.path))}
                        >
                          ✕
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});
