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
};

contextBridge.exposeInMainWorld("oceanNative", oceanNative);

export type OceanNative = typeof oceanNative;
