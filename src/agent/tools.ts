// The tool registry the UI executes. Both the in-app agent console and the MCP
// server (via the WebSocket bridge in sync.ts) call into these by name. Each
// tool runs THROUGH the command bus, so every agent edit re-renders the UI.
//
// Agents speak seconds; the model stores integer ticks (PRD §6.3/§7). These
// adapters convert at the boundary and keep outputs compact.
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/model/store";
import { oceanAgent } from "@/agent/bridge";
import { findClip } from "@/model/selectors";
import { nextId } from "@/model/ids";
import { round2, secondsToTicks, ticksToSeconds } from "@/model/time";
import { inTauri, renderFrame } from "@/engine/render";
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
      durationTicks: Math.round((info.durationSecs ?? 0) * 600),
      naturalWidth: info.width ?? 0,
      naturalHeight: info.height ?? 0,
      hasAudio: !!info.hasAudio,
    },
  });
  return { assetId, kind: info.kind, dur: round2(info.durationSecs ?? 0) };
}

/** UI import: open the native picker, probe, add to library. No-op in browser. */
export async function importViaDialog(): Promise<{ assetId: string } | null> {
  if (!inTauri) {
    alert("Importing your own media needs the desktop app — run `pnpm tauri:dev`.");
    return null;
  }
  const picked = await invoke<{ path: string; name: string } & ProbeResult | null>("import_dialog");
  if (!picked) return null;
  return addAsset(picked.path, picked.name, picked);
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
    description: "Spatial awareness at a time: each visible object's normalized box + overlap warnings. In the desktop app these are MEASURED from the real compositor (true geometry). Args: atSec.",
    run: async (a) => {
      const atSec = (a.atSec as number) ?? 0;
      if (inTauri) {
        return invoke("layout_at", {
          projectJson: JSON.stringify(useStore.getState().project),
          tSecs: atSec,
        });
      }
      return oceanAgent.get_canvas_layout(atSec); // browser estimate fallback
    },
  },
  capture_frame: {
    name: "capture_frame",
    description: "Render and SEE the actual composited frame at a time (downscaled). Costs image tokens — use sparingly to verify, not to browse. Args: atSec, maxDim? (default 512). Desktop app only.",
    run: async (a) => {
      if (!inTauri) throw new Error("capture_frame needs the desktop app (pnpm tauri:dev)");
      const image = await renderFrame((a.atSec as number) ?? 0, (a.maxDim as number) ?? 512);
      return { image, atSec: (a.atSec as number) ?? 0 };
    },
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
      if (!inTauri) throw new Error("import needs the desktop app (pnpm tauri:dev)");
      const path = a.path as string;
      const info = await invoke<{ kind: string; width: number; height: number; durationSecs: number; hasAudio: boolean }>("probe_media", { path });
      return addAsset(path, path.split("/").pop() ?? path, info);
    },
  },

  // ---------- structure ----------
  add_track: {
    name: "add_track",
    description: "Add a track. Args: kind ('video'|'audio'|'text'), name?. Returns { trackId }.",
    run: (a) => {
      const trackId = nextId("t");
      const diff = dispatch({ type: "add_track", kind: a.kind as "video" | "audio" | "text", name: a.name as string, trackId });
      return { trackId, diff };
    },
  },
  remove_track: { name: "remove_track", description: "Remove a track by id. Args: trackId.", run: (a) => ({ diff: dispatch({ type: "remove_track", trackId: a.trackId as string }) }) },

  // ---------- clip gestures ----------
  add_clip: {
    name: "add_clip",
    description: "Place a clip on a track. Args: trackId, assetId?, atSec, durationSec?, text? (for text tracks). Returns { clipId }.",
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
  delete_clip: { name: "delete_clip", description: "Delete a clip. Args: clipId, ripple? (close the gap).", run: (a) => ({ diff: dispatch({ type: "delete_clip", clipId: a.clipId as string, ripple: a.ripple as boolean }) }) },

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
    description: "Edit a text clip. Args: clipId, content?, fontName?, fontSize?, color?, align?.",
    run: (a) => {
      const patch: Record<string, unknown> = {};
      for (const k of ["content", "fontName", "fontSize", "color", "align"]) if (a[k] != null) patch[k] = a[k];
      return { diff: dispatch({ type: "set_text", clipId: a.clipId as string, patch }) };
    },
  },
  set_opacity: { name: "set_opacity", description: "Set clip opacity 0..1. Args: clipId, opacity.", run: (a) => ({ diff: dispatch({ type: "set_opacity", clipId: a.clipId as string, opacity: a.opacity as number }) }) },
  set_fade: { name: "set_fade", description: "Set opacity fades. Args: clipId, fadeInSec?, fadeOutSec?.", run: (a) => ({ diff: dispatch({ type: "set_fade", clipId: a.clipId as string, fadeInTicks: a.fadeInSec != null ? sec(a.fadeInSec as number) : undefined, fadeOutTicks: a.fadeOutSec != null ? sec(a.fadeOutSec as number) : undefined }) }) },
  set_volume: { name: "set_volume", description: "Set clip volume 0..1. Args: clipId, volume.", run: (a) => ({ diff: dispatch({ type: "set_volume", clipId: a.clipId as string, volume: a.volume as number }) }) },
  set_speed: { name: "set_speed", description: "Retime a clip. Args: clipId, speed (e.g. 2 = 2x).", run: (a) => ({ diff: dispatch({ type: "set_speed", clipId: a.clipId as string, speed: a.speed as number }) }) },

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
