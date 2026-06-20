// The command bus. Every mutation — whether from a UI gesture or an MCP tool
// call — is expressed as one of these typed commands and applied here. This is
// the single mutation path that guarantees AI edits are reflected in the UI
// (PRD §6.2, §6.5). Commands are modeled as human gestures, not struct setters
// (PRD §8.1/§8.3 lesson).
import type {
  Clip,
  EditorState,
  MediaAsset,
  Project,
  TextProps,
  Track,
  TrackKind,
  Transform,
} from "./types";
import { defaultTextProps, defaultTransform } from "./types";
import { nextId } from "./ids";
import type { Ticks } from "./time";
import { formatTimecode, round2, ticksToSeconds } from "./time";

export type Command =
  // ---- library / structure ----
  | { type: "import_media"; asset: Omit<MediaAsset, "id">; assetId?: string }
  | { type: "add_track"; kind: TrackKind; name?: string; trackId?: string }
  | { type: "remove_track"; trackId: string }
  // ---- clip gestures ----
  | {
      type: "add_clip";
      trackId: string;
      assetId?: string;
      atTicks: Ticks;
      durationTicks?: Ticks;
      clipId?: string;
      text?: Partial<TextProps>;
    }
  | { type: "move_clip"; clipId: string; toTicks: Ticks; toTrackId?: string }
  | { type: "trim_clip"; clipId: string; sourceIn?: Ticks; sourceOut?: Ticks }
  | { type: "split_clip"; clipId: string; atTicks: Ticks; newClipId?: string }
  | { type: "delete_clip"; clipId: string; ripple?: boolean }
  // ---- properties ----
  | { type: "set_transform"; clipId: string; patch: Partial<Transform> }
  | { type: "set_opacity"; clipId: string; opacity: number }
  | { type: "set_fade"; clipId: string; fadeInTicks?: Ticks; fadeOutTicks?: Ticks }
  | { type: "set_volume"; clipId: string; volume: number }
  | { type: "set_speed"; clipId: string; speed: number }
  | { type: "set_text"; clipId: string; patch: Partial<TextProps> }
  // ---- markers (beats etc.) ----
  | { type: "add_marker"; atTicks: Ticks; kind?: "beat" | "downbeat" | "chapter" | "generic"; label?: string; markerId?: string }
  | { type: "clear_markers"; kind?: "beat" | "downbeat" | "chapter" | "generic" }
  // ---- canvas ----
  | { type: "set_canvas"; patch: Partial<Project["canvas"]> }
  // ---- ephemeral editor state (not part of the saved doc) ----
  | { type: "set_playhead"; atTicks: Ticks }
  | { type: "set_playing"; playing: boolean }
  | { type: "select_clips"; clipIds: string[] }
  | { type: "select_asset"; assetId?: string }
  | { type: "set_range"; range?: { startTicks: Ticks; endTicks: Ticks } }
  | { type: "set_zoom"; zoom: number }
  | { type: "set_working"; clipIds: string[] };

export interface ApplyContext {
  project: Project;
  editor: EditorState;
}

export type CommandSource = "ui" | "agent" | "system";

// ----- helpers -----

function findClip(project: Project, clipId: string): { track: Track; clip: Clip; index: number } | null {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index], index };
  }
  return null;
}

function sortClips(track: Track): void {
  track.clips.sort((a, b) => a.timelineStart - b.timelineStart);
}

function clipDuration(c: Clip): Ticks {
  return c.timelineEnd - c.timelineStart;
}

/** Compact, agent-friendly description of what changed (PRD §7 diff reporting). */
export type Diff = string;

const t = (ticks: Ticks) => `${round2(ticksToSeconds(ticks))}s`;

// ----- applier (mutates drafts in place; returns a compact diff) -----

export function applyCommand(ctx: ApplyContext, cmd: Command): Diff {
  const { project, editor } = ctx;
  project.modifiedAt = Date.now();

  switch (cmd.type) {
    case "import_media": {
      const id = cmd.assetId ?? nextId("a");
      project.mediaLibrary.push({ ...cmd.asset, id });
      return `imported ${cmd.asset.kind} ${id} (${cmd.asset.name})`;
    }

    case "add_track": {
      const id = cmd.trackId ?? nextId("t");
      const sameKind = project.tracks.filter((tr) => tr.kind === cmd.kind).length;
      const track: Track = {
        id,
        kind: cmd.kind,
        name: cmd.name ?? `${cmd.kind[0].toUpperCase()}${cmd.kind.slice(1)} ${sameKind + 1}`,
        enabled: true,
        locked: false,
        opacity: 1,
        volume: 1,
        clips: [],
      };
      project.tracks.push(track);
      return `added ${cmd.kind} track ${id}`;
    }

    case "remove_track": {
      const i = project.tracks.findIndex((tr) => tr.id === cmd.trackId);
      if (i < 0) throw new Error(`track ${cmd.trackId} not found`);
      const n = project.tracks[i].clips.length;
      project.tracks.splice(i, 1);
      return `removed track ${cmd.trackId} (${n} clips)`;
    }

    case "add_clip": {
      const track = project.tracks.find((tr) => tr.id === cmd.trackId);
      if (!track) throw new Error(`track ${cmd.trackId} not found`);
      const id = cmd.clipId ?? nextId("c");
      const asset = cmd.assetId ? project.mediaLibrary.find((a) => a.id === cmd.assetId) : undefined;
      let duration = cmd.durationTicks;
      if (duration == null) {
        if (asset && asset.durationTicks > 0) duration = asset.durationTicks;
        else duration = track.kind === "text" ? 3 * 600 : 5 * 600; // sensible defaults
      }
      const clip: Clip = {
        id,
        kind: track.kind,
        assetId: cmd.assetId,
        timelineStart: cmd.atTicks,
        timelineEnd: cmd.atTicks + duration,
        sourceIn: 0,
        sourceOut: asset && asset.durationTicks > 0 ? Math.min(duration, asset.durationTicks) : duration,
        speed: 1,
        transform: defaultTransform(),
        opacity: 1,
        opacityFadeIn: 0,
        opacityFadeOut: 0,
        volume: 1,
        keyframes: [],
        text: track.kind === "text" ? { ...defaultTextProps(), ...cmd.text } : undefined,
        label: id,
      };
      track.clips.push(clip);
      sortClips(track);
      return `added clip ${id} on ${track.id} at ${t(cmd.atTicks)} (len ${t(duration)})`;
    }

    case "move_clip": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      const { track, clip } = found;
      const dur = clipDuration(clip);
      const from = clip.timelineStart;
      clip.timelineStart = Math.max(0, cmd.toTicks);
      clip.timelineEnd = clip.timelineStart + dur;
      let dest = track;
      if (cmd.toTrackId && cmd.toTrackId !== track.id) {
        const target = project.tracks.find((tr) => tr.id === cmd.toTrackId);
        if (!target) throw new Error(`track ${cmd.toTrackId} not found`);
        if (target.kind !== track.kind) throw new Error(`cannot move ${track.kind} clip to ${target.kind} track`);
        track.clips.splice(track.clips.indexOf(clip), 1);
        target.clips.push(clip);
        dest = target;
      }
      sortClips(dest);
      return `moved ${clip.id} ${t(from)}→${t(clip.timelineStart)}${dest !== track ? ` to ${dest.id}` : ""}`;
    }

    case "trim_clip": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      const { clip } = found;
      if (cmd.sourceIn != null) clip.sourceIn = Math.max(0, cmd.sourceIn);
      if (cmd.sourceOut != null) clip.sourceOut = Math.max(clip.sourceIn + 1, cmd.sourceOut);
      // keep timeline length in sync with trimmed source length (speed = 1 path)
      const srcLen = Math.round((clip.sourceOut - clip.sourceIn) / clip.speed);
      clip.timelineEnd = clip.timelineStart + srcLen;
      return `trimmed ${clip.id} source ${t(clip.sourceIn)}→${t(clip.sourceOut)}`;
    }

    case "split_clip": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      const { track, clip } = found;
      if (cmd.atTicks <= clip.timelineStart || cmd.atTicks >= clip.timelineEnd)
        throw new Error(`split point ${t(cmd.atTicks)} is outside clip ${clip.id}`);
      const offset = cmd.atTicks - clip.timelineStart;
      const srcSplit = clip.sourceIn + Math.round(offset * clip.speed);
      const right: Clip = {
        ...structuredClone(clip),
        id: cmd.newClipId ?? nextId("c"),
        timelineStart: cmd.atTicks,
        sourceIn: srcSplit,
        keyframes: [],
      };
      right.label = right.id;
      clip.timelineEnd = cmd.atTicks;
      clip.sourceOut = srcSplit;
      track.clips.push(right);
      sortClips(track);
      return `split ${clip.id} at ${t(cmd.atTicks)} → ${clip.id} + ${right.id}`;
    }

    case "delete_clip": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      const { track, clip, index } = found;
      const dur = clipDuration(clip);
      track.clips.splice(index, 1);
      if (cmd.ripple) {
        for (const c of track.clips) {
          if (c.timelineStart >= clip.timelineEnd) {
            c.timelineStart -= dur;
            c.timelineEnd -= dur;
          }
        }
      }
      editor.selectedClipIds = editor.selectedClipIds.filter((id) => id !== clip.id);
      return `deleted ${clip.id}${cmd.ripple ? " (ripple)" : ""}`;
    }

    case "set_transform": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      Object.assign(found.clip.transform, cmd.patch);
      const keys = Object.keys(cmd.patch).join(",");
      return `set transform[${keys}] on ${cmd.clipId}`;
    }

    case "set_opacity": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      found.clip.opacity = Math.max(0, Math.min(1, cmd.opacity));
      return `set opacity ${round2(found.clip.opacity)} on ${cmd.clipId}`;
    }

    case "set_fade": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      if (cmd.fadeInTicks != null) found.clip.opacityFadeIn = Math.max(0, cmd.fadeInTicks);
      if (cmd.fadeOutTicks != null) found.clip.opacityFadeOut = Math.max(0, cmd.fadeOutTicks);
      return `set fade on ${cmd.clipId}`;
    }

    case "set_volume": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      found.clip.volume = Math.max(0, Math.min(1, cmd.volume));
      return `set volume ${round2(found.clip.volume)} on ${cmd.clipId}`;
    }

    case "set_speed": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      const { clip } = found;
      clip.speed = Math.max(0.1, cmd.speed);
      const srcLen = Math.round((clip.sourceOut - clip.sourceIn) / clip.speed);
      clip.timelineEnd = clip.timelineStart + srcLen;
      return `set speed ${round2(clip.speed)}x on ${cmd.clipId}`;
    }

    case "set_text": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      if (!found.clip.text) throw new Error(`clip ${cmd.clipId} is not a text clip`);
      Object.assign(found.clip.text, cmd.patch);
      return `set text on ${cmd.clipId}`;
    }

    case "add_marker": {
      const id = cmd.markerId ?? nextId("m");
      project.markers.push({ id, atTicks: cmd.atTicks, kind: cmd.kind ?? "generic", label: cmd.label });
      return `marker ${cmd.kind ?? "generic"} @ ${formatTimecode(cmd.atTicks)}`;
    }

    case "clear_markers": {
      const before = project.markers.length;
      project.markers = cmd.kind ? project.markers.filter((m) => m.kind !== cmd.kind) : [];
      return `cleared ${before - project.markers.length} markers`;
    }

    case "set_canvas": {
      Object.assign(project.canvas, cmd.patch);
      return `set canvas ${project.canvas.width}x${project.canvas.height}@${project.canvas.fps}`;
    }

    // ----- ephemeral editor state -----
    case "set_playhead":
      editor.playheadTicks = Math.max(0, cmd.atTicks);
      return `playhead → ${t(editor.playheadTicks)}`;
    case "set_playing":
      editor.playing = cmd.playing;
      return cmd.playing ? "play" : "pause";
    case "select_clips":
      editor.selectedClipIds = cmd.clipIds;
      return `selected ${cmd.clipIds.length} clip(s)`;
    case "select_asset":
      editor.selectedAssetId = cmd.assetId;
      return `selected asset ${cmd.assetId ?? "none"}`;
    case "set_range":
      editor.rangeSelection = cmd.range;
      return cmd.range ? `range ${t(cmd.range.startTicks)}–${t(cmd.range.endTicks)}` : "cleared range";
    case "set_zoom":
      editor.zoom = Math.max(2, Math.min(400, cmd.zoom));
      return `zoom ${Math.round(editor.zoom)}px/s`;
    case "set_working":
      editor.workingClipIds = cmd.clipIds;
      return `working: ${cmd.clipIds.length}`;
  }
}
