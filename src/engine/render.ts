// Renderer-side bridge to the Electron native layer (preload `window.oceanNative`).
// Preview now composites native <video>/<img> in the renderer (see PreviewCanvas),
// so there's no per-frame IPC. This module just resolves media URLs and proxies
// import/probe to the main process.
export interface ProbeInfo {
  kind: string;
  width: number;
  height: number;
  durationSecs: number;
  hasAudio: boolean;
  fileIdentity?: { hash: string; size: number; mtime: number };
}

interface OceanNative {
  isElectron: boolean;
  ping(): Promise<string>;
  probeMedia(path: string): Promise<ProbeInfo>;
  importDialog(): Promise<({ path: string; name: string } & ProbeInfo) | null>;
}

declare global {
  interface Window {
    oceanNative?: OceanNative;
  }
}

export const native = (): OceanNative | undefined => window.oceanNative;
export const inElectron = typeof window !== "undefined" && !!window.oceanNative;

// Where asset:// URIs resolve in dev. Set VITE_MEDIA_ROOT to your test-media dir.
const MEDIA_ROOT = (import.meta.env.VITE_MEDIA_ROOT as string) ?? "";

/** Resolve a document URI to an absolute filesystem path (mirrors Rust resolve_uri). */
export function resolveAssetPath(uri: string): string {
  if (uri.startsWith("asset://")) return `${MEDIA_ROOT}/${uri.slice("asset://".length)}`;
  if (uri.startsWith("file://")) return uri.slice("file://".length);
  return uri;
}

/** A URL the renderer can load (<video>/<img>/<audio>). */
export function mediaUrl(uri: string): string {
  if (uri.startsWith("blob:") || uri.startsWith("data:") || uri.startsWith("http")) return uri;
  const path = resolveAssetPath(uri);
  if (inElectron) return `ocean-media://media${encodeURI(path)}`;
  // Browser dev fallback: not servable; return as-is (won't load local files).
  return path;
}

export async function probeMedia(path: string) {
  return native()?.probeMedia(path);
}

export async function importDialog() {
  return native()?.importDialog() ?? null;
}
