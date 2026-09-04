export type LibraryTrack = {
  id: string;
  name: string;
  artist: string;
  path: string;
  bpm: number | null;
  duration: number;
  key?: string | null;
  camelot?: string | null;
  album?: string | null;
  year?: string | null;
  genre?: string | null;
  comment?: string | null;
  playCount?: number;
  cover?: string;
};

const KEY = "crhis.library.v2";
const LEGACY = "crhis.library.v1";

export function loadLibrary(): LibraryTrack[] {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<LibraryTrack> & { path: string }>;
    return parsed.map((track) => ({
      id: track.id || track.path,
      name: track.name || fileName(track.path),
      artist: track.artist || "",
      path: track.path,
      bpm: track.bpm ?? null,
      duration: track.duration ?? 0,
      key: track.key ?? null,
      camelot: track.camelot ?? null,
      album: track.album ?? null,
      year: track.year ?? null,
      genre: track.genre ?? null,
      comment: track.comment ?? null,
      playCount: track.playCount ?? 0,
    }));
  } catch {
    return [];
  }
}

export function saveLibrary(tracks: LibraryTrack[]) {
  const slim = tracks.map(({ cover: _cover, ...rest }) => rest);
  localStorage.setItem(KEY, JSON.stringify(slim));
}

export function tracksFromPaths(paths: string[]): LibraryTrack[] {
  return paths.map((filePath) => ({
    id: filePath,
    name: fileName(filePath),
    artist: "",
    path: filePath,
    bpm: null,
    duration: 0,
  }));
}

export function mergeLibrary(current: LibraryTrack[], incoming: LibraryTrack[]) {
  const map = new Map(current.map((t) => [t.path, t]));
  for (const track of incoming) {
    const prev = map.get(track.path);
    map.set(
      track.path,
      prev
        ? {
            ...prev,
            ...track,
            cover: track.cover || prev.cover,
            // No pisar metadatos ya analizados con valores vacíos.
            bpm: track.bpm ?? prev.bpm,
            key: track.key ?? prev.key,
            camelot: track.camelot ?? prev.camelot,
            album: track.album ?? prev.album,
            year: track.year ?? prev.year,
            genre: track.genre ?? prev.genre,
            comment: track.comment ?? prev.comment,
            playCount: track.playCount ?? prev.playCount,
            duration: track.duration || prev.duration,
          }
        : track,
    );
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function fileName(filePath: string) {
  return filePath.split("/").pop()?.replace(/\.[^.]+$/, "") || filePath;
}

export function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
