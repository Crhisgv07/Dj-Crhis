import { contextBridge, ipcRenderer } from "electron";

/** Puente mínimo para la ventana de salida de video: sólo expone dos callbacks
 *  de entrada. Sin `nodeIntegration`, con `contextIsolation`. */
contextBridge.exposeInMainWorld("crhisVideo", {
  onSrc: (cb: (sources: { a: string | null; b: string | null }) => void) => {
    ipcRenderer.on("video:src", (_event, sources) => cb(sources));
  },
  onSync: (cb: (program: unknown) => void) => {
    ipcRenderer.on("video:sync", (_event, program) => cb(program));
  },
});
