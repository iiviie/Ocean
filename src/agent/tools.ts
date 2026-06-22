// The tool registry the UI executes. Both the in-app agent console and the MCP
// server (via the WebSocket bridge in sync.ts) call into these by name. Each
// tool runs THROUGH the command bus, so every agent edit re-renders the UI.
//
// Agents speak seconds; the model stores integer ticks (PRD §6.3/§7). These
// adapters convert at the boundary and keep outputs compact.
import { useStore } from "@/model/store";
import { oceanAgent } from "@/agent/bridge";
import { findClip } from "@/model/selectors";
import { nextId } from "@/model/ids";
import { round2, secondsToTicks, ticksToSeconds } from "@/model/time";
import { inElectron, probeMedia, importDialog, resolveAssetPath, analyzeMedia, analysisStatus, readAnalysis } from "@/engine/render";
import type { Command } from "@/model/commands";

const dispatch = (cmd: Command) => useStore.getState().dispatch(cmd, "agent");
const sec = secondsToTicks;

export interface ToolDef {
  name: string;
  description: string;
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

function requireClip(clipId: string) {
  const found = findClip(useStore.getState().project, clipId);
  if (!found) throw new Error(`clip ${clipId} not found`);
  return found;
}

interface ProbeResult {
  kind: string;
  width: number;
  height: number;
  durationSecs: number;
  hasAudio: boolean;
  fileIdentity?: { hash: string; size: number; mtime: number };
}

/** Add a probed asset to the library; returns its new id. Shared by the UI
 *  import button and the import_media agent tool. */
function addAsset(uri: string, name: string, info: ProbeResult) {
  const assetId = nextId("a");
  dispatch({
    type: "import_media",
    assetId,
    asset: {
      kind: (info.kind as "video" | "image" | "audio" | "lottie") ?? "video",
      name,
      uri, // absolute path resolves directly in the compositor
      fileIdentity: info.fileIdentity, // cache key for analysis artifacts (perception layer)
      durationTicks: Math.round((info.durationSecs ?? 0) * 600),
      naturalWidth: info.width ?? 0,
      naturalHeight: info.height ?? 0,
      hasAudio: !!info.hasAudio,
    },
  });
  return { assetId, kind: info.kind, dur: round2(info.durationSecs ?? 0) };
}

/** UI import: native picker in Electron; <input type=file> + object URL in the browser. */
export async function importViaDialog(): Promise<{ assetId: string } | null> {
  if (inElectron) {
    const picked = await importDialog();
    if (!picked) return null;
    return addAsset(picked.path, picked.name, picked);
  }
  const file = await pickFileBrowser();
  if (!file) return null;
  const info = await probeBrowser(file);
  return addAsset(info.url, file.name, info); // uri = blob: URL, loadable by <video>/<img>
}

function pickFileBrowser(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,image/*,audio/*";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Probe a picked File client-side (dimensions + duration) and make a blob URL. */
function probeBrowser(file: File): Promise<{ url: string } & ProbeResult> {
  const url = URL.createObjectURL(file);
  const kind = file.type.startsWith("image") ? "image" : file.type.startsWith("audio") ? "audio" : "video";
  return new Promise((resolve) => {
    const done = (width: number, height: number, durationSecs: number, hasAudio: boolean) =>
      resolve({ url, kind, width, height, durationSecs, hasAudio });
    if (kind === "image") {
      const img = new Image();
      img.onload = () => done(img.naturalWidth, img.naturalHeight, 0, false);
      img.onerror = () => done(0, 0, 0, false);
      img.src = url;
    } else {
      const el = document.createElement(kind === "audio" ? "audio" : "video") as HTMLVideoElement;
      el.preload = "metadata";
      el.onloadedmetadata = () => done(el.videoWidth || 0, el.videoHeight || 0, el.duration || 0, true);
      el.onerror = () => done(0, 0, 0, true);
      el.src = url;
    }
  });
}

interface ShotsData {
  durationSec: number;
  shotCount: number;
  shots: { idx: number; startSec: number; endSec: number; durSec: number }[];
}

/** Resolve an asset to its analysis context: the fileIdentity cache key, the
 *  real filesystem path, and its duration in seconds. */
function analysisCtx(assetId: string) {
  const asset = useStore.getState().project.mediaLibrary.find((a) => a.id === assetId);
  if (!asset) throw new Error(`asset ${assetId} not found`);
  const hash = asset.fileIdentity?.hash;
  if (!hash) throw new Error(`asset ${assetId} has no fileIdentity — re-import it in the desktop app`);
  return { asset, hash, path: resolveAssetPath(asset.uri), durationSec: ticksToSeconds(asset.durationTicks) };
}

export const tools: Record<string, ToolDef> = {
  // ---------- reads / awareness ----------
  get_project: { name: "get_project", description: "Project facts: canvas, fps, duration, track/asset counts.", run: () => oceanAgent.get_project() },
  list_media: {
    name: "list_media",
    description: "List media library assets (id, kind, name, duration).",
    run: () =>
      useStore.getState().project.mediaLibrary.map((a) => ({
        id: a.id, kind: a.kind, name: a.name,
        dur: round2(ticksToSeconds(a.durationTicks)),
        w: a.naturalWidth, h: a.naturalHeight, hasAudio: a.hasAudio,
        ...(a.missing ? { missing: true } : {}),
      })),
  },
  get_timeline: {
    name: "get_timeline",
    description: "Windowed timeline view. Args: fromSec?, toSec?, trackIds?[]. Never dumps the whole project.",
    run: (a) => oceanAgent.get_timeline({ fromSec: a.fromSec as number, toSec: a.toSec as number, trackIds: a.trackIds as string[] }),
  },
  get_canvas_layout: {
    name: "get_canvas_layout",
    description: "Spatial awareness at a time: each visible object's normalized box + overlap warnings. Args: atSec.",
    run: (a) => oceanAgent.get_canvas_layout((a.atSec as number) ?? 0),
  },
  get_selection: {
    name: "get_selection",
    description: "What the human currently has selected (clip ids, asset, range, playhead).",
    run: () => {
      const e = useStore.getState().editor;
      return {
        clips: e.selectedClipIds, asset: e.selectedAssetId,
        playhead: round2(ticksToSeconds(e.playheadTicks)),
        range: e.rangeSelection
          ? { from: round2(ticksToSeconds(e.rangeSelection.startTicks)), to: round2(ticksToSeconds(e.rangeSelection.endTicks)) }
          : null,
      };
    },
  },
  recent: { name: "recent", description: "Recent command log so you can see the effect of your own edits. Args: n?.", run: (a) => oceanAgent.recent((a.n as number) ?? 10) },

  // ---------- import ----------
  import_media: {
    name: "import_media",
    description: "Import a media file (absolute path) into the library; probes real metadata. Returns { assetId, kind, dur }. Desktop app only.",
    run: async (a) => {
      if (!inElectron) throw new Error("import needs the desktop app (pnpm dev)");
      const path = a.path as string;
      const info = await probeMedia(path);
      if (!info) throw new Error("probe failed");
      return addAsset(path, path.split("/").pop() ?? path, info);
    },
  },

  // ---------- perception (media → text) ----------
  analyze_media: {
    name: "analyze_media",
    description: "Kick off perception analysis for an asset (async, non-blocking). Args: assetId, kinds? (default ['shots']). Returns per-kind status; then poll get_analysis_status or read with get_shots. Desktop app only.",
    run: async (a) => {
      if (!inElectron) throw new Error("analysis needs the desktop app (pnpm dev)");
      const { hash, path, durationSec } = analysisCtx(a.assetId as string);
      const kinds = (a.kinds as string[] | undefined)?.length ? (a.kinds as string[]) : ["shots"];
      return { assetId: a.assetId, status: await analyzeMedia(hash, path, kinds, durationSec) };
    },
  },
  get_analysis_status: {
    name: "get_analysis_status",
    description: "Per-kind analysis status for an asset: ready | pending | none | unsupported. Args: assetId, kinds? (default ['shots']).",
    run: async (a) => {
      if (!inElectron) throw new Error("analysis needs the desktop app");
      const { hash } = analysisCtx(a.assetId as string);
      const kinds = (a.kinds as string[] | undefined)?.length ? (a.kinds as string[]) : ["shots"];
      return { assetId: a.assetId, status: await analysisStatus(hash, kinds) };
    },
  },
  get_shots: {
    name: "get_shots",
    description: "Windowed shot list for a video asset (idx, start, end, dur in seconds). Args: assetId, fromSec?, toSec?. If not analyzed yet returns { status }; call analyze_media first.",
    run: async (a) => {
      if (!inElectron) throw new Error("analysis needs the desktop app");
      const { asset, hash } = analysisCtx(a.assetId as string);
      const data = (await readAnalysis(hash, "shots")) as ShotsData | null;
      if (!data) {
        const status = await analysisStatus(hash, ["shots"]);
        return { assetId: a.assetId, status: status?.shots ?? "none" };
      }
      // Reflect the cached analysis onto the asset (idempotent, via the bus).
      if (asset.analysis?.shotsRef !== hash) {
        dispatch({ type: "set_asset_analysis", assetId: asset.id, patch: { shotsRef: hash, analyzedAt: Date.now() } });
      }
      const from = (a.fromSec as number) ?? 0;
      const to = a.toSec != null ? (a.toSec as number) : Infinity;
      const win = data.shots.filter((s) => s.endSec > from && s.startSec < to);
      const CAP = 60;
      const shots = win.slice(0, CAP).map((s) => ({ i: s.idx, start: s.startSec, end: s.endSec, dur: s.durSec }));
      return {
        assetId: a.assetId,
        durationSec: data.durationSec,
        total: data.shots.length,
        shots,
        ...(win.length > CAP ? { truncated: true, hint: "narrow fromSec/toSec" } : {}),
      };
    },
  },

  // ---------- structure ----------
  add_track: {
    name: "add_track",
    description: "Add a track/layer. Args: kind ('video'|'audio'), name?. Text overlays live on video tracks — no separate text track. Returns { trackId }.",
    run: (a) => {
      const trackId = nextId("t");
      const diff = dispatch({ type: "add_track", kind: a.kind as "video" | "audio", name: a.name as string, trackId });
      return { trackId, diff };
    },
  },
  remove_track: { name: "remove_track", description: "Remove a track by id. Args: trackId.", run: (a) => ({ diff: dispatch({ type: "remove_track", trackId: a.trackId as string }) }) },
  set_track: {
    name: "set_track",
    description: "Set track/lane properties. Args: trackId, name?, enabled? (false hides a video lane / mutes an audio lane), locked?, opacity? (0..1, video lanes), volume? (0..1, audio lanes).",
    run: (a) => {
      const patch: Record<string, unknown> = {};
      for (const k of ["name", "enabled", "locked", "opacity", "volume"]) if (a[k] != null) patch[k] = a[k];
      return { diff: dispatch({ type: "set_track", trackId: a.trackId as string, patch }) };
    },
  },

  // ---------- clip gestures ----------
  add_clip: {
    name: "add_clip",
    description: "Place a clip on a track. Args: trackId, assetId?, atSec, durationSec?, text? (text clips go on video tracks). Dropping a video with audio auto-creates a linked audio clip on the lane beneath. Returns { clipId }.",
    run: (a) => {
      const clipId = nextId("c");
      const diff = dispatch({
        type: "add_clip", trackId: a.trackId as string, assetId: a.assetId as string,
        atTicks: sec((a.atSec as number) ?? 0),
        durationTicks: a.durationSec != null ? sec(a.durationSec as number) : undefined,
        clipId, text: a.text ? { content: a.text as string } : undefined,
      });
      return { clipId, diff };
    },
  },
  move_clip: { name: "move_clip", description: "Move a clip. Args: clipId, toSec, toTrackId?.", run: (a) => ({ diff: dispatch({ type: "move_clip", clipId: a.clipId as string, toTicks: sec(a.toSec as number), toTrackId: a.toTrackId as string }) }) },
  trim_clip: { name: "trim_clip", description: "Trim a clip's source range. Args: clipId, sourceInSec?, sourceOutSec?.", run: (a) => ({ diff: dispatch({ type: "trim_clip", clipId: a.clipId as string, sourceIn: a.sourceInSec != null ? sec(a.sourceInSec as number) : undefined, sourceOut: a.sourceOutSec != null ? sec(a.sourceOutSec as number) : undefined }) }) },
  split_clip: {
    name: "split_clip",
    description: "Split (razor) a clip at a time. Args: clipId, atSec. Returns { newClipId }.",
    run: (a) => {
      const newClipId = nextId("c");
      const diff = dispatch({ type: "split_clip", clipId: a.clipId as string, atTicks: sec(a.atSec as number), newClipId });
      return { newClipId, diff };
    },
  },
  delete_clip: { name: "delete_clip", description: "Delete a clip (and its linked audio/video partner, if any). Args: clipId, ripple? (close the gap).", run: (a) => ({ diff: dispatch({ type: "delete_clip", clipId: a.clipId as string, ripple: a.ripple as boolean }) }) },
  unlink_clip: { name: "unlink_clip", description: "Unlink a video clip from its auto-created audio clip so they move independently. Args: clipId.", run: (a) => ({ diff: dispatch({ type: "unlink_clip", clipId: a.clipId as string }) }) },

  // ---------- properties ----------
  set_transform: {
    name: "set_transform",
    description: "Set clip transform (center-anchored, normalized 0..1). Args: clipId, centerX?, centerY?, scale?, rotation?, flipH?, flipV?.",
    run: (a) => {
      requireClip(a.clipId as string);
      const patch: Record<string, unknown> = {};
      for (const k of ["centerX", "centerY", "scale", "rotation", "flipH", "flipV"]) if (a[k] != null) patch[k] = a[k];
      return { diff: dispatch({ type: "set_transform", clipId: a.clipId as string, patch }) };
    },
  },
  set_text: {
    name: "set_text",
    description: "Edit a text clip. Args: clipId, content?, fontName?, fontSize?, color?, align?, lineHeight?.",
    run: (a) => {
      const patch: Record<string, unknown> = {};
      for (const k of ["content", "fontName", "fontSize", "color", "align", "lineHeight"]) if (a[k] != null) patch[k] = a[k];
      return { diff: dispatch({ type: "set_text", clipId: a.clipId as string, patch }) };
    },
  },
  set_opacity: { name: "set_opacity", description: "Set clip opacity 0..1. Args: clipId, opacity.", run: (a) => ({ diff: dispatch({ type: "set_opacity", clipId: a.clipId as string, opacity: a.opacity as number }) }) },
  set_fade: { name: "set_fade", description: "Set opacity fades. Args: clipId, fadeInSec?, fadeOutSec?.", run: (a) => ({ diff: dispatch({ type: "set_fade", clipId: a.clipId as string, fadeInTicks: a.fadeInSec != null ? sec(a.fadeInSec as number) : undefined, fadeOutTicks: a.fadeOutSec != null ? sec(a.fadeOutSec as number) : undefined }) }) },
  set_volume: { name: "set_volume", description: "Set clip volume 0..1. Args: clipId, volume.", run: (a) => ({ diff: dispatch({ type: "set_volume", clipId: a.clipId as string, volume: a.volume as number }) }) },
  set_speed: { name: "set_speed", description: "Retime a clip. Args: clipId, speed (e.g. 2 = 2x).", run: (a) => ({ diff: dispatch({ type: "set_speed", clipId: a.clipId as string, speed: a.speed as number }) }) },

  // ---------- canvas ----------
  set_canvas: {
    name: "set_canvas",
    description: "Set canvas/output settings. Args: width?, height? (px), fps? (24|25|30|60), backgroundColor? (hex).",
    run: (a) => {
      const patch: Record<string, unknown> = {};
      for (const k of ["width", "height", "fps", "backgroundColor"]) if (a[k] != null) patch[k] = a[k];
      return { diff: dispatch({ type: "set_canvas", patch }) };
    },
  },

  // ---------- markers / playhead ----------
  add_marker: { name: "add_marker", description: "Add a timeline marker (e.g. a beat). Args: atSec, kind? ('beat'|'downbeat'|'chapter'|'generic'), label?.", run: (a) => ({ diff: dispatch({ type: "add_marker", atTicks: sec(a.atSec as number), kind: a.kind as "beat", label: a.label as string }) }) },
  clear_markers: { name: "clear_markers", description: "Clear markers. Args: kind? (omit to clear all).", run: (a) => ({ diff: dispatch({ type: "clear_markers", kind: a.kind as "beat" }) }) },
  set_playhead: { name: "set_playhead", description: "Move the playhead. Args: atSec.", run: (a) => ({ diff: dispatch({ type: "set_playhead", atTicks: sec(a.atSec as number) }) }) },
  select_clips: { name: "select_clips", description: "Select clips in the UI. Args: clipIds[].", run: (a) => ({ diff: dispatch({ type: "select_clips", clipIds: (a.clipIds as string[]) ?? [] }) }) },
};

export async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = tools[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.run(args ?? {});
}
