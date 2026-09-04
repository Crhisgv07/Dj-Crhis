import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("crhis", {
  openTracks: () => ipcRenderer.invoke("dialog:open-tracks") as Promise<string[]>,
  openFolder: () => ipcRenderer.invoke("dialog:open-folder") as Promise<string[]>,
  pickImage: () => ipcRenderer.invoke("dialog:pick-image") as Promise<string | null>,
  fsRoots: () =>
    ipcRenderer.invoke("fs:roots") as Promise<{ name: string; path: string }[]>,
  fsListDir: (dir: string) =>
    ipcRenderer.invoke("fs:list-dir", dir) as Promise<{
      dirs: { name: string; path: string }[];
      files: string[];
      parent?: string;
    }>,
  readHead: (filePath: string) =>
    ipcRenderer.invoke("fs:read-head", filePath) as Promise<{
      name: string;
      path: string;
      buffer: ArrayBuffer;
    }>,
  readTrack: (filePath: string) =>
    ipcRenderer.invoke("fs:read-track", filePath) as Promise<{
      name: string;
      path: string;
      buffer: ArrayBuffer;
    }>,
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  // Guardar la grabación del set en disco.
  recorder: {
    save: (data: ArrayBuffer, name: string) =>
      ipcRenderer.invoke("rec:save", data, name) as Promise<boolean>,
  },
  // Ventana de salida de video (estilo VirtualDJ).
  video: {
    show: (path: string) => ipcRenderer.invoke("video:show", path) as Promise<void>,
    hide: () => ipcRenderer.invoke("video:hide") as Promise<void>,
    sync: (state: { time: number; rate: number; paused: boolean }) =>
      ipcRenderer.send("video:sync", state),
  },
});
