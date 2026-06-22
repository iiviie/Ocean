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
  extractFrame: (path: string, atSec: number, maxPx: number): Promise<string> =>
    ipcRenderer.invoke("extract-frame", path, atSec, maxPx),
  // ---- project files ----
  projectPickNew: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke("project-pick-new", defaultName),
  projectOpen: (): Promise<{ path: string; json: string } | null> =>
    ipcRenderer.invoke("project-open"),
  projectRead: (dir: string): Promise<string | null> =>
    ipcRenderer.invoke("project-read", dir),
  projectSave: (dir: string, json: string): Promise<boolean> =>
    ipcRenderer.invoke("project-save", dir, json),
  // ---- export ----
  exportPick: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke("export-pick", defaultName),
  exportVideo: (spec: unknown): Promise<{ ok: boolean; outPath?: string; error?: string }> =>
    ipcRenderer.invoke("export-video", spec),
  onExportProgress: (cb: (p: { progress: number; timeSec?: number }) => void): (() => void) => {
    const listener = (_e: unknown, p: { progress: number; timeSec?: number }) => cb(p);
    ipcRenderer.on("export-progress", listener);
    return () => ipcRenderer.removeListener("export-progress", listener);
  },
};

contextBridge.exposeInMainWorld("oceanNative", oceanNative);

export type OceanNative = typeof oceanNative;
