/** Formatos que tratamos como "video": se abre la ventana de salida y el deck
 *  reproduce mediante un elemento <video> en vez de un AudioBuffer. */
const VIDEO_EXT = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".ogv"]);

export function extname(path: string): string {
  const match = /\.[^./\\]+$/.exec(path.toLowerCase());
  return match ? match[0] : "";
}

export function isVideoPath(path: string): boolean {
  return VIDEO_EXT.has(extname(path));
}

/** MIME aproximado para construir el Blob del <video>. Chromium ignora el tipo
 *  si puede olfatear el contenedor, así que basta con una pista razonable. */
export function mimeForPath(path: string): string {
  switch (extname(path)) {
    case ".mp4":
    case ".m4v":
    case ".mov":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".ogv":
      return "video/ogg";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    default:
      return "video/mp4";
  }
}
