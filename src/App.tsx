import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { engine } from "./audio/engine";
import type { DeckId } from "./audio/types";
import { Deck } from "./components/Deck";
import { FolderTree } from "./components/FolderTree";
import { InfoPanel } from "./components/InfoPanel";
import { Library } from "./components/Library";
import { Mixer } from "./components/Mixer";
import { Settings } from "./components/Settings";
import { Shortcuts } from "./components/Shortcuts";
import { TopBar } from "./components/TopBar";
import { Waveform } from "./components/Waveform";
import { desktop, loadFromFile, loadFromPath, previewPath, readMeta } from "./desktop/api";
import { areKeysCompatible } from "./audio/key";
import { usePlayback, useSnapshot } from "./hooks/useEngine";
import { useMidi } from "./hooks/useMidi";
import { useSettings } from "./hooks/useSettings";
import { useVideoOutput } from "./hooks/useVideoOutput";
import { getCover, setCover, fileToDataUrl } from "./library/covers";
import { parseId3 } from "./library/id3";
import {
  fileName,
  loadLibrary,
  mergeLibrary,
  saveLibrary,
  tracksFromPaths,
  type LibraryTrack,
} from "./library/libraryStore";
import { midi } from "./midi/midiManager";
import { settings } from "./settings/store";
import { deckAccent } from "./ui/theme";

export function App() {
  const snap = useSnapshot();
  const live = usePlayback();
  const midiState = useMidi();
  const prefs = useSettings();
  useVideoOutput();
  const [tracks, setTracks] = useState<LibraryTrack[]>(() => loadLibrary());
  const [selected, setSelected] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [folderFilter, setFolderFilter] = useState<Set<string> | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  useEffect(() => {
    void engine.unlock();
    void midi.start();
    // Migración única: re-lee los metadatos de la biblioteca ya guardada para
    // corregir nombres/artistas de imports viejos (tags UTF-16/UTF-8 mal
    // decodificados). Se ejecuta una sola vez.
    try {
      if (desktop() && !localStorage.getItem("crhis.id3fix.v2")) {
        const persisted = loadLibrary();
        if (persisted.length) void enrich(persisted.map((t) => t.path), setTracks);
        localStorage.setItem("crhis.id3fix.v2", "1");
      }
    } catch {
      /* noop */
    }
    return settings.subscribe(() => engine.refreshMixer());
  }, []);

  useEffect(() => {
    saveLibrary(tracks);
  }, [tracks]);

  // Cuando un deck termina de analizar (BPM/tonalidad), refleja el resultado en
  // la fila de la biblioteca correspondiente.
  useEffect(() => {
    for (const id of ["a", "b"] as DeckId[]) {
      const d = snap.decks[id];
      if (!d.loaded || d.analyzing || !d.path) continue;
      setTracks((current) => {
        const prev = current.find((t) => t.path === d.path);
        if (prev && prev.bpm === d.bpm && (prev.camelot ?? null) === (d.camelot ?? null)) {
          return current;
        }
        return mergeLibrary(current, [
          {
            id: d.path,
            path: d.path,
            name: d.title || fileName(d.path),
            artist: d.artist || prev?.artist || "",
            bpm: d.bpm,
            duration: d.duration,
            key: d.keyName,
            camelot: d.camelot,
            cover: prev?.cover,
          },
        ]);
      });
    }
  }, [
    snap.decks.a.analyzing,
    snap.decks.a.bpm,
    snap.decks.a.camelot,
    snap.decks.a.path,
    snap.decks.b.analyzing,
    snap.decks.b.bpm,
    snap.decks.b.camelot,
    snap.decks.b.path,
  ]);

  const addPaths = useCallback((paths: string[]) => {
    setTracks((current) => mergeLibrary(current, tracksFromPaths(paths)));
    void enrich(paths, setTracks);
  }, []);

  const loadPath = useCallback(async (filePath: string, deck: DeckId, name?: string) => {
    const known = tracks.find((track) => track.path === filePath);
    setBusy(`Cargando ${name || known?.name || filePath.split("/").pop()}…`);
    try {
      await loadFromPath(filePath, deck, name || known?.name, {
        artist: known?.artist,
        bpm: known?.bpm,
      });
      const loaded = engine.snapshot().decks[deck];
      setTracks((current) =>
        mergeLibrary(current, [
          {
            id: filePath,
            path: filePath,
            name: loaded.title || fileName(filePath),
            artist: loaded.artist || known?.artist || "",
            bpm: loaded.bpm,
            duration: loaded.duration,
            cover: known?.cover,
          },
        ]),
      );
      setBusy(null);
    } catch (error) {
      setBusy(error instanceof Error ? error.message : "No se pudo cargar la pista");
      window.setTimeout(() => setBusy(null), 4200);
    }
  }, [tracks]);

  const loadTrack = useCallback(
    (track: LibraryTrack, deck: DeckId) => {
      void loadPath(track.path, deck, track.name);
    },
    [loadPath],
  );

  const pickFiles = useCallback(async () => {
    const api = desktop();
    if (!api) {
      setBusy("Reinicia la app para habilitar el diálogo de archivos");
      return;
    }
    const paths = await api.openTracks();
    addPaths(paths);
    if (paths[0]) void loadPath(paths[0], "a");
    if (paths[1]) void loadPath(paths[1], "b");
  }, [addPaths, loadPath]);

  // Callbacks estables para que los paneles memoizados (Library, Deck, MidiPanel)
  // no se re-rendericen en cada frame del bucle de reproducción.
  const handleDropTrack = useCallback(
    (path: string, deck: DeckId) => void loadPath(path, deck),
    [loadPath],
  );
  const handleDropFile = useCallback(
    (file: File, deck: DeckId) => {
      setBusy(`Cargando ${file.name}…`);
      void (async () => {
        try {
          const path = await loadFromFile(file, deck);
          addPaths([path]);
          setBusy(null);
        } catch (error) {
          setBusy(error instanceof Error ? error.message : "No se pudo cargar el archivo");
          window.setTimeout(() => setBusy(null), 4200);
        }
      })();
    },
    [addPaths],
  );
  const handleSeekA = useCallback((time: number) => engine.seek("a", time), []);
  const handleSeekB = useCallback((time: number) => engine.seek("b", time), []);
  const handlePreview = useCallback((track: LibraryTrack) => {
    if (engine.snapshot().preview.playing) engine.stopPreview();
    else void previewPath(track.path, track.name);
  }, []);
  const handleOpenFiles = useCallback(() => void pickFiles(), [pickFiles]);
  const handleOpenFolder = useCallback(async () => {
    const api = desktop();
    if (!api) return;
    addPaths(await api.openFolder());
  }, [addPaths]);

  const handleFolderTree = useCallback(
    (paths: string[], folderPath: string) => {
      addPaths(paths);
      setActiveFolder(folderPath);
      setFolderFilter(paths.length ? new Set(paths) : null);
    },
    [addPaths],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "?") {
        setHelpOpen((open) => !open);
        return;
      }
      // Ignora la auto-repetición del SO al mantener la tecla pulsada.
      if (event.repeat) return;
      if (event.code === "Space") {
        event.preventDefault();
        engine.toggle("a");
      }
      if (event.key === "q") engine.toggle("a");
      if (event.key === "w") engine.toggle("b");
      if (event.key === "a") engine.cue("a", true);
      if (event.key === "s") engine.cue("b", true);
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === "a") engine.cue("a", false);
      if (event.key === "s") engine.cue("b", false);
    };
    const onMove = (event: Event) => {
      const delta = (event as CustomEvent<number>).detail || 1;
      setSelected((index) => Math.min(tracks.length - 1, Math.max(0, index + delta)));
    };
    const onLoadSelected = (event: Event) => {
      const deck = (event as CustomEvent<DeckId>).detail;
      const track = tracks[selected];
      if (track) void loadPath(track.path, deck, track.name);
    };
    const onPreview = () => {
      const track = tracks[selected];
      if (!track) return;
      if (engine.snapshot().preview.playing) engine.stopPreview();
      else void previewPath(track.path, track.name);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("crhis:library-move", onMove);
    window.addEventListener("crhis:load-selected", onLoadSelected);
    window.addEventListener("crhis:preview-toggle", onPreview);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("crhis:library-move", onMove);
      window.removeEventListener("crhis:load-selected", onLoadSelected);
      window.removeEventListener("crhis:preview-toggle", onPreview);
    };
  }, [loadPath, selected, tracks]);

  const harmonic = areKeysCompatible(snap.decks.a.camelot, snap.decks.b.camelot);

  const [coverStore, setCoverStore] = useState<Record<string, string>>({});

  // Carga las carátulas persistentes (IndexedDB) de las pistas visibles + decks.
  useEffect(() => {
    const paths = new Set<string>();
    for (const t of tracks) paths.add(t.path);
    if (snap.decks.a.path) paths.add(snap.decks.a.path);
    if (snap.decks.b.path) paths.add(snap.decks.b.path);
    let cancelled = false;
    void (async () => {
      for (const p of paths) {
        if (coverStore[p]) continue;
        const url = await getCover(p);
        if (url && !cancelled) setCoverStore((c) => (c[p] ? c : { ...c, [p]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tracks, snap.decks.a.path, snap.decks.b.path]);

  const covers = useMemo(() => {
    const map = new Map<string, string>();
    for (const track of tracks) {
      if (track.cover) map.set(track.path, track.cover);
    }
    for (const [p, url] of Object.entries(coverStore)) map.set(p, url);
    return map;
  }, [tracks, coverStore]);

  const handleSetCoverUrl = useCallback((path: string, dataUrl: string) => {
    if (!path || !dataUrl) return;
    void setCover(path, dataUrl);
    setCoverStore((c) => ({ ...c, [path]: dataUrl }));
  }, []);

  const handleDropCover = useCallback(
    (path: string, file: File) => {
      if (!path) return;
      void fileToDataUrl(file).then((url) => handleSetCoverUrl(path, url)).catch(() => {});
    },
    [handleSetCoverUrl],
  );

  return (
    <div
      className={`app ${dropActive ? "drop-active" : ""}`}
      data-layout={prefs.layout}
      onDragOver={(event) => {
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropActive(false);
      }}
      onDrop={(event) => {
        // Los decks manejan (y detienen) su propio drop. Lo que llega aquí cayó
        // fuera de un deck → va a la biblioteca, sin cargar ningún plato.
        event.preventDefault();
        setDropActive(false);
        if (event.dataTransfer.getData("text/crhis-track")) return;
        const api = desktop();
        const paths: string[] = [];
        for (const file of event.dataTransfer.files) {
          const p = api?.pathForFile(file);
          if (p) paths.push(p);
        }
        if (paths.length) {
          addPaths(paths);
        } else if (event.dataTransfer.files.length) {
          setBusy("Suelta el archivo sobre un plato para cargarlo");
          window.setTimeout(() => setBusy(null), 3200);
        }
      }}
    >
      <TopBar
        status={
          busy ||
          (snap.preview.playing
            ? `Preview · ${snap.preview.title}`
            : midiState.devices.length
              ? midiState.devices.join(" · ")
              : "Conecta tu Numark u otra controladora MIDI")
        }
        statusOk={midiState.devices.length > 0}
        master={snap.mixer.master}
        onLoad={() => void pickFiles()}
        onSetup={() => setSetupOpen(true)}
        onHelp={() => setHelpOpen(true)}
      />

      <section className="waves">
        <Waveform
          deck={snap.decks.a}
          position={live.a.position}
          accent={deckAccent("a")}
          onSeek={handleSeekA}
        />
        <Waveform
          deck={snap.decks.b}
          position={live.b.position}
          accent={deckAccent("b")}
          onSeek={handleSeekB}
        />
      </section>

      <main className="booth">
        <Deck
          deck={snap.decks.a}
          position={live.a.position}
          cover={covers.get(snap.decks.a.path)}
          sampler={snap.sampler}
          harmonic={harmonic}
          onDropTrack={handleDropTrack}
          onDropFile={handleDropFile}
          onDropCover={handleDropCover}
        />
        <Mixer deckA={snap.decks.a} deckB={snap.decks.b} mixer={snap.mixer} />
        <Deck
          deck={snap.decks.b}
          position={live.b.position}
          cover={covers.get(snap.decks.b.path)}
          sampler={snap.sampler}
          harmonic={harmonic}
          onDropTrack={handleDropTrack}
          onDropFile={handleDropFile}
          onDropCover={handleDropCover}
        />
      </main>

      <div className="dock">
        <FolderTree onOpenFolder={handleFolderTree} activeFolder={activeFolder} />
        <Library
          tracks={tracks}
          covers={covers}
          folderFilter={folderFilter}
          selected={selected}
          previewTitle={snap.preview.playing ? snap.preview.title : undefined}
          onSelect={setSelected}
          onLoad={loadTrack}
          onPreview={handlePreview}
          onOpenFiles={handleOpenFiles}
          onOpenFolder={handleOpenFolder}
          onDropCover={handleDropCover}
          onClearFolder={() => {
            setFolderFilter(null);
            setActiveFolder(null);
          }}
        />
        <InfoPanel
          track={tracks[selected] ?? null}
          cover={tracks[selected] ? covers.get(tracks[selected].path) : undefined}
          onSetCover={handleSetCoverUrl}
          onLoad={loadTrack}
          onPreview={handlePreview}
        />
      </div>
      <Settings open={setupOpen} onClose={() => setSetupOpen(false)} />
      <Shortcuts open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

async function enrich(
  paths: string[],
  setTracks: Dispatch<SetStateAction<LibraryTrack[]>>,
) {
  for (const filePath of paths.slice(0, 400)) {
    try {
      const head = await readMeta(filePath);
      if (!head) continue;
      const meta = parseId3(head.buffer);
      if (meta.cover) void setCover(filePath, meta.cover);
      setTracks((current) =>
        mergeLibrary(current, [
          {
            id: filePath,
            path: filePath,
            name: meta.title || fileName(filePath),
            artist: meta.artist || "",
            album: meta.album ?? null,
            year: meta.year ?? null,
            genre: meta.genre ?? null,
            comment: meta.comment ?? null,
            bpm: current.find((t) => t.path === filePath)?.bpm ?? null,
            duration: current.find((t) => t.path === filePath)?.duration ?? 0,
            cover: meta.cover,
          },
        ]),
      );
    } catch {
      /* skip unreadable files */
    }
  }
}
