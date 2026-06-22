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
  analyzeMedia(hash: string, path: string, kinds: string[], opts: { durationSec: number }): Promise<Record<string, string>>;
  analysisStatus(hash: string, kinds: string[]): Promise<Record<string, string>>;
  readAnalysis(hash: string, kind: string): Promise<unknown | null>;
  extractFrame(path: string, atSec: number, maxPx: number): Promise<string>;
  // ---- project files ----
  projectPickNew(defaultName: string): Promise<string | null>;
  projectOpen(): Promise<{ path: string; json: string } | null>;
  projectRead(dir: string): Promise<string | null>;
  projectSave(dir: string, json: string): Promise<boolean>;
  // ---- export ----
  exportVideo(spec: ExportSpec): Promise<ExportResult>;
  exportPick(defaultName: string): Promise<string | null>;
  onExportProgress(cb: (p: ExportProgress) => void): () => void;
}

/** What the renderer hands the main process to encode the timeline to a file. */
export interface ExportSpec {
  /** The full project document (already JSON-safe). */
  project: unknown;
  /** Output resolution (defaults to the canvas size if omitted). */
  width: number;
  height: number;
  fps: number;
  /** Absolute output file path (chosen via exportPick). */
  outPath: string;
}

export interface ExportProgress {
  /** 0..1 of the timeline encoded, or -1 when unknown. */
  progress: number;
  /** ffmpeg's current output timecode in seconds. */
  timeSec?: number;
}

export interface ExportResult {
  ok: boolean;
  outPath?: string;
  error?: string;
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

// ---- perception analysis bridge (desktop only) ----
export async function analyzeMedia(hash: string, path: string, kinds: string[], durationSec: number) {
  return native()?.analyzeMedia(hash, path, kinds, { durationSec }) ?? null;
}

export async function analysisStatus(hash: string, kinds: string[]) {
  return native()?.analysisStatus(hash, kinds) ?? null;
}

export async function readAnalysis(hash: string, kind: string) {
  return native()?.readAnalysis(hash, kind) ?? null;
}

export async function extractFrame(path: string, atSec: number, maxPx = 512) {
  return native()?.extractFrame(path, atSec, maxPx) ?? null;
}

// ---- project files (desktop only) ----
export async function projectPickNew(defaultName: string) {
  return native()?.projectPickNew(defaultName) ?? null;
}
export async function projectOpen() {
  return native()?.projectOpen() ?? null;
}
export async function projectRead(dir: string) {
  return native()?.projectRead(dir) ?? null;
}
export async function projectSave(dir: string, json: string) {
  return native()?.projectSave(dir, json) ?? false;
}

// ---- export (desktop only) ----
export async function exportPick(defaultName: string) {
  return native()?.exportPick(defaultName) ?? null;
}
export async function exportVideo(spec: ExportSpec): Promise<ExportResult> {
  return native()?.exportVideo(spec) ?? { ok: false, error: "export requires the desktop app" };
}
export function onExportProgress(cb: (p: ExportProgress) => void): () => void {
  return native()?.onExportProgress(cb) ?? (() => {});
}
