// Preload: safe native API exposed to the renderer.
import { contextBridge, ipcRenderer } from "electron";

export interface ProbeInfo {
  kind: string;
  width: number;
  height: number;
  durationSecs: number;
  hasAudio: boolean;
  fileIdentity?: { hash: string; size: number; mtime: number };
}

const oceanNative = {
  isElectron: true,
  ping: (): Promise<string> => ipcRenderer.invoke("ping"),
  probeMedia: (path: string): Promise<ProbeInfo> => ipcRenderer.invoke("probe-media", path),
  importDialog: (): Promise<({ path: string; name: string } & ProbeInfo) | null> =>
    ipcRenderer.invoke("import-dialog"),
  // ---- perception analysis ----
  analyzeMedia: (hash: string, path: string, kinds: string[], opts: { durationSec: number }): Promise<Record<string, string>> =>
    ipcRenderer.invoke("analyze-media", hash, path, kinds, opts),
  analysisStatus: (hash: string, kinds: string[]): Promise<Record<string, string>> =>
    ipcRenderer.invoke("analysis-status", hash, kinds),
  readAnalysis: (hash: string, kind: string): Promise<unknown | null> =>
    ipcRenderer.invoke("read-analysis", hash, kind),
};

contextBridge.exposeInMainWorld("oceanNative", oceanNative);

export type OceanNative = typeof oceanNative;
