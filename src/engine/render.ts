// Frontend bridge to the native Rust compositor (Tauri command `render_frame`).
// Only active in the desktop app; in a plain browser there's no engine, so the
// preview falls back to the lightweight DOM compositor.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/model/store";
import { ticksToSeconds } from "@/model/time";

export const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Where asset:// URIs resolve in dev. Set VITE_MEDIA_ROOT to your test-media dir.
const MEDIA_ROOT = (import.meta.env.VITE_MEDIA_ROOT as string) ?? "";

/** Resolve a document URI to an absolute filesystem path (mirrors Rust resolve_uri). */
export function resolveAssetPath(uri: string): string {
  if (uri.startsWith("asset://")) return `${MEDIA_ROOT}/${uri.slice("asset://".length)}`;
  if (uri.startsWith("file://")) return uri.slice("file://".length);
  return uri;
}

export async function renderFrame(tSecs: number, maxDim = 720): Promise<string> {
  const project = useStore.getState().project;
  return invoke<string>("render_frame", {
    projectJson: JSON.stringify(project),
    tSecs,
    mediaRoot: MEDIA_ROOT,
    maxDim,
  });
}

/** Warm the decode cache ahead of the playhead so playback can pull frames fast. */
export async function prefetch(fromSec: number, toSec: number): Promise<number> {
  if (!inTauri) return 0;
  try {
    return await invoke<number>("prefetch", {
      projectJson: JSON.stringify(useStore.getState().project),
      fromSec,
      toSec,
      mediaRoot: MEDIA_ROOT,
    });
  } catch {
    return 0;
  }
}

/** Returns the latest real rendered frame for the current playhead/project.
 *  Debounced, and only the newest request wins (older renders are discarded). */
export function useRenderedFrame(): { src: string | null; loading: boolean; error: string | null } {
  const playhead = useStore((s) => s.editor.playheadTicks);
  const modifiedAt = useStore((s) => s.project.modifiedAt); // bumps on every edit
  const playing = useStore((s) => s.editor.playing);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  // Prefetch a window into the cache when playback starts so frames pull fast.
  useEffect(() => {
    if (!inTauri || !playing) return;
    const from = ticksToSeconds(useStore.getState().editor.playheadTicks);
    void prefetch(from, from + 3);
  }, [playing]);

  useEffect(() => {
    if (!inTauri) return;
    const tSecs = ticksToSeconds(playhead);
    const id = ++reqId.current;
    // While playing, render back-to-back (latest-wins) for preview-rate playback;
    // while paused/scrubbing, debounce so we don't render every intermediate value.
    const delay = playing ? 0 : 120;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const url = await renderFrame(tSecs, playing ? 540 : 720);
        if (id === reqId.current) {
          setSrc(url);
          setError(null);
        }
      } catch (e) {
        if (id === reqId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, delay);
    return () => clearTimeout(handle);
  }, [playhead, modifiedAt, playing]);

  return { src, loading, error };
}
