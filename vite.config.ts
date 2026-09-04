import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import path from "node:path";

const electronPlugins = process.env.CRHIS_NO_ELECTRON
  ? []
  : [
      electron([
        {
          entry: "electron/main.ts",
          onstart({ startup }) {
            const env = { ...process.env };
            delete env.ELECTRON_RUN_AS_NODE;
            void startup([".", "--no-sandbox"], { env });
          },
          vite: { build: { outDir: "dist-electron" } },
        },
        {
          entry: "electron/preload.ts",
          onstart({ reload }) {
            reload();
          },
          vite: { build: { outDir: "dist-electron" } },
        },
        {
          entry: "electron/video-preload.ts",
          onstart({ reload }) {
            reload();
          },
          vite: { build: { outDir: "dist-electron" } },
        },
      ]),
      renderer(),
    ];

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        cabina: path.resolve(__dirname, "cabina.html"),
      },
    },
  },
  plugins: [react(), ...electronPlugins],
});
