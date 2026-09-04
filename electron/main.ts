import { app, BrowserWindow, Menu, session, shell, dialog, ipcMain } from "electron";

app.disableHardwareAcceleration();
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

/** Endurecimiento: bloquea navegación fuera de la app, popups, y permisos que
 *  la app no necesita. Los enlaces http(s) se abren en el navegador del SO. */
function hardenContents(contents: Electron.WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    const dev = process.env.VITE_DEV_SERVER_URL;
    const allowed = url.startsWith("file:") || (dev && url.startsWith(dev));
    if (!allowed) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  if (!isDev) {
    contents.on("devtools-opened", () => contents.closeDevTools());
  }
}

const AUDIO_EXT = new Set([
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".m4a",
  ".ogg",
  ".aiff",
  ".aif",
  ".wma",
  // Video: se carga el audio de la pista (los visuales llegan en otra fase).
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
]);

let mainWin: BrowserWindow | null = null;

function loadRenderer(win: BrowserWindow) {
  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: true,
    backgroundColor: "#070708",
    title: "CRHIS — Cabina",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
      spellcheck: false,
      devTools: isDev,
    },
  });
  mainWin = win;
  hardenContents(win.webContents);

  win.webContents.on("console-message", (event) => {
    if (event.level === "error" || event.level === "warning") {
      console.log("[renderer]", event.message);
    }
  });

  let retries = 0;
  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    // El servidor de Vite puede no estar listo cuando Electron arranca: reintenta.
    if (code === -6 || code === -102 || code === -105 || code === -324) {
      if (retries++ < 40) {
        setTimeout(() => loadRenderer(win), 250);
        return;
      }
    }
    console.error("Fallo al cargar la cabina:", code, desc, url);
  });

  const reveal = () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  };
  win.once("ready-to-show", reveal);
  win.webContents.once("did-finish-load", reveal);
  // Red de seguridad por si ningún evento de "listo" llega (macOS en background).
  setTimeout(reveal, 3000);

  win.on("closed", () => {
    mainWin = null;
    if (videoWin && !videoWin.isDestroyed()) videoWin.close();
  });

  loadRenderer(win);
}

/* -------------------------------------------------------------------------- */
/*  Ventana de salida de video (estilo VirtualDJ)                             */
/* -------------------------------------------------------------------------- */

let videoWin: BrowserWindow | null = null;
let videoSrcUrls: { a: string | null; b: string | null } = { a: null, b: null };

function ensureVideoWindow(): BrowserWindow {
  if (videoWin && !videoWin.isDestroyed()) return videoWin;

  videoWin = new BrowserWindow({
    width: 960,
    height: 540,
    backgroundColor: "#000000",
    title: "CRHIS — Video",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "video-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,
    },
  });
  hardenContents(videoWin.webContents);

  videoWin.on("closed", () => {
    videoWin = null;
    videoSrcUrls = { a: null, b: null };
  });

  // Se carga SIEMPRE con loadFile (origen file://) — así la página puede
  // reproducir los `file://` de los clips aunque `webSecurity` esté activo
  // (con loadURL http:// del dev-server, Chromium bloquea el media file://).
  const videoHtml = isDev
    ? path.join(__dirname, "../public/video.html")
    : path.join(__dirname, "../dist/video.html");
  void videoWin.loadFile(videoHtml);

  return videoWin;
}

function sendToVideo(channel: string, payload: unknown) {
  const win = videoWin;
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    });
  } else {
    win.webContents.send(channel, payload);
  }
}

function toFileUrl(fp: unknown): string | null {
  return typeof fp === "string" && existsSync(fp) ? pathToFileURL(fp).href : null;
}

ipcMain.handle("video:show", (_event, payload: unknown) => {
  let aPath: unknown = null;
  let bPath: unknown = null;
  try {
    const parsed = JSON.parse(String(payload));
    aPath = parsed.a;
    bPath = parsed.b;
  } catch {
    aPath = payload; // compat: una sola ruta
  }
  const a = toFileUrl(aPath);
  const b = toFileUrl(bPath);
  if (!a && !b) return;
  const win = ensureVideoWindow();
  if (videoSrcUrls.a !== a || videoSrcUrls.b !== b) {
    videoSrcUrls = { a, b };
    sendToVideo("video:src", { a, b });
  }
  // Traer al frente de forma fiable (macOS a veces deja ventanas secundarias
  // atrás o en otro Space).
  if (!win.isVisible()) win.show();
  win.moveTop();
  win.focus();
});

ipcMain.handle("video:hide", () => {
  if (videoWin && !videoWin.isDestroyed() && videoWin.isVisible()) videoWin.hide();
  videoSrcUrls = { a: null, b: null };
});

ipcMain.on("video:sync", (_event, state: unknown) => {
  if (!videoWin || videoWin.isDestroyed() || !videoWin.isVisible()) return;
  videoWin.webContents.send("video:sync", state);
});

async function collectAudioFiles(folder: string, limit = 800): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string) {
    if (found.length >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  }

  await walk(folder);
  return found;
}

ipcMain.handle("dialog:open-tracks", async () => {
  const result = await dialog.showOpenDialog({
    title: "Cargar pistas",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Audio y video",
        extensions: [
          "mp3", "wav", "flac", "aac", "m4a", "ogg", "aiff", "aif", "wma",
          "mp4", "m4v", "mov", "webm", "mkv",
        ],
      },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:open-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Abrir carpeta de música",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return [];
  return collectAudioFiles(result.filePaths[0]);
});

ipcMain.handle("dialog:pick-image", async () => {
  const result = await dialog.showOpenDialog({
    title: "Elegir carátula",
    properties: ["openFile"],
    filters: [{ name: "Imagen", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const p = result.filePaths[0];
  const data = await fs.readFile(p);
  const ext = path.extname(p).toLowerCase().slice(1);
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
  return `data:${mime};base64,${data.toString("base64")}`;
});

/** Raíces habituales para el árbol de carpetas del explorador. */
ipcMain.handle("fs:roots", () => {
  const roots = [
    { name: "Inicio", path: app.getPath("home") },
    { name: "Música", path: app.getPath("music") },
    { name: "Descargas", path: app.getPath("downloads") },
    { name: "Escritorio", path: app.getPath("desktop") },
  ];
  return roots.filter((r) => existsSync(r.path));
});

/** Lista una carpeta: subcarpetas + archivos de audio/video directos. */
ipcMain.handle("fs:list-dir", async (_event, dir: unknown) => {
  if (typeof dir !== "string" || !existsSync(dir)) return { dirs: [], files: [] };
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { dirs: [], files: [] };
  }
  const dirs: { name: string; path: string }[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) dirs.push({ name: entry.name, path: full });
    else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, "es"));
  files.sort((a, b) => a.localeCompare(b, "es"));
  return { dirs, files, parent: path.dirname(dir) };
});

ipcMain.handle("fs:read-head", async (_event, filePath: string) => {
  if (typeof filePath !== "string" || !existsSync(filePath)) {
    throw new Error("Archivo no encontrado");
  }
  const handle = await fs.open(filePath, "r");
  const chunk = Buffer.alloc(512 * 1024);
  const { bytesRead } = await handle.read(chunk, 0, chunk.length, 0);
  await handle.close();
  return {
    name: path.basename(filePath),
    path: filePath,
    buffer: Uint8Array.from(chunk.subarray(0, bytesRead)),
  };
});

ipcMain.handle("fs:read-track", async (_event, filePath: string) => {
  if (typeof filePath !== "string" || !existsSync(filePath)) {
    throw new Error("Archivo no encontrado");
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXT.has(ext)) {
    throw new Error("Formato no soportado");
  }
  const data = await fs.readFile(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    buffer: Uint8Array.from(data),
  };
});

ipcMain.handle("rec:save", async (_event, data: unknown, name: unknown) => {
  let bytes: Uint8Array;
  if (data instanceof Uint8Array) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else return false;
  const suggested = typeof name === "string" ? name : `CRHIS-set-${Date.now()}.webm`;
  const res = await dialog.showSaveDialog({
    title: "Guardar grabación del set",
    defaultPath: path.join(app.getPath("music"), suggested),
    filters: [{ name: "Audio", extensions: ["webm"] }],
  });
  if (res.canceled || !res.filePath) return false;
  await fs.writeFile(res.filePath, bytes);
  return true;
});

// Bloquea segundas instancias (una sola cabina a la vez).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

app.whenReady().then(() => {
  // Content-Security-Policy en el renderer (además del <meta>). En dev se relaja
  // para permitir el HMR de Vite (eval + websocket).
  const csp = isDev
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: http://localhost:*; media-src 'self' blob: data: file:; img-src 'self' data: blob:;"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data: file:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none';";
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });

  // Deniega todo permiso que la app no necesita (cámara, micrófono del navegador,
  // geolocalización, notificaciones…). MIDI sí se permite.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const ok = permission === "midi" || permission === "midiSysex";
    console.log(`[perm] request "${permission}" → ${ok ? "concedido" : "denegado"}`);
    callback(ok);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    const ok = permission === "midi" || permission === "midiSysex";
    if (permission === "midi" || permission === "midiSysex") {
      console.log(`[perm] check "${permission}" → ${ok}`);
    }
    return ok;
  });

  if (!isDev) Menu.setApplicationMenu(null);

  // Asegura que la app se comporte como GUI de primer plano (evita que macOS la
  // deje como agente en segundo plano y la ventana no aparezca).
  if (process.platform === "darwin") {
    try {
      app.setActivationPolicy("regular");
      app.dock?.show();
    } catch {
      /* noop */
    }
  }
  createWindow();
  app.focus({ steal: true });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show();
      mainWin.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
