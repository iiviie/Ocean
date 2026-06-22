import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "electron/main.ts") } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "electron/preload.ts") },
        // Force CommonJS .js — most reliable for Electron preload scripts.
        output: { format: "cjs", entryFileNames: "index.js" },
      },
    },
  },
  renderer: {
    root: ".",
    base: "./", // relative asset paths so the built app loads under file://
    resolve: { alias: { "@": resolve(__dirname, "src") } },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "index.html") } },
    },
  },
});
