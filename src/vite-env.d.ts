/// <reference types="vite/client" />

interface CrhisApi {
  openTracks: () => Promise<string[]>;
  openFolder: () => Promise<string[]>;
  readHead: (filePath: string) => Promise<{
    name: string;
    path: string;
    buffer: ArrayBuffer | Uint8Array | { type: "Buffer"; data: number[] };
  }>;
  readTrack: (filePath: string) => Promise<{
    name: string;
    path: string;
    buffer: ArrayBuffer | Uint8Array | { type: "Buffer"; data: number[] };
  }>;
  pathForFile: (file: File) => string;
  pickImage?: () => Promise<string | null>;
  fsRoots?: () => Promise<{ name: string; path: string }[]>;
  fsListDir?: (dir: string) => Promise<{
    dirs: { name: string; path: string }[];
    files: string[];
    parent?: string;
  }>;
  recorder?: {
    save: (data: ArrayBuffer, name: string) => Promise<boolean>;
  };
  video?: {
    show: (path: string) => Promise<void>;
    hide: () => Promise<void>;
    sync: (state: { time: number; rate: number; paused: boolean }) => void;
  };
}

declare global {
  interface Window {
    crhis?: CrhisApi;
  }
}

export {};
