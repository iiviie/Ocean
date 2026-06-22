// The command bus. Every mutation — whether from a UI gesture or an MCP tool
// call — is expressed as one of these typed commands and applied here. This is
// the single mutation path that guarantees AI edits are reflected in the UI
// (PRD §6.2, §6.5). Commands are modeled as human gestures, not struct setters
// (PRD §8.1/§8.3 lesson).
import type {
  Clip,
  ClipStyle,
  ColorAdjust,
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
  | { type: "set_track"; trackId: string; patch: Partial<Pick<Track, "name" | "enabled" | "locked" | "opacity" | "volume">> }
  | { type: "move_track"; trackId: string; toIndex: number }
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
  | { type: "unlink_clip"; clipId: string }
  // ---- properties ----
  | { type: "set_transform"; clipId: string; patch: Partial<Transform> }
  | { type: "set_color"; clipId: string; patch: Partial<ColorAdjust> }
  | { type: "set_style"; clipId: string; patch: Partial<ClipStyle> }
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
  // ---- perception (analysis handles on assets) ----
  | { type: "set_asset_analysis"; assetId: string; patch: Partial<NonNullable<MediaAsset["analysis"]>> }
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

/** Does [aStart,aEnd) intersect [bStart,bEnd)? */
function rangesOverlap(aStart: Ticks, aEnd: Ticks, bStart: Ticks, bEnd: Ticks): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Would placing [start, start+dur) on `track` collide with an existing clip
 *  (ignoring `exceptId`)? Clips never overlap on a track (PRD: a layer is a
 *  single lane). */
function wouldOverlap(track: Track, start: Ticks, dur: Ticks, exceptId?: string): boolean {
  return track.clips.some((c) => c.id !== exceptId && rangesOverlap(start, start + dur, c.timelineStart, c.timelineEnd));
}

/** Timeline end of the nearest clip sitting to the LEFT of `clip` (0 if none) —
 *  the furthest its left edge may be trimmed without overlapping a neighbour. */
function neighborEnd(track: Track, clip: Clip): Ticks {
  let bound = 0;
  for (const o of track.clips) {
    if (o.id === clip.id) continue;
    if (o.timelineEnd <= clip.timelineStart) bound = Math.max(bound, o.timelineEnd);
  }
  return bound;
}

/** Timeline start of the nearest clip sitting to the RIGHT of `clip` (∞ if none)
 *  — the furthest its right edge may be trimmed without overlapping a neighbour. */
function neighborStart(track: Track, clip: Clip): Ticks {
  let bound = Infinity;
  for (const o of track.clips) {
    if (o.id === clip.id) continue;
    if (o.timelineStart >= clip.timelineEnd) bound = Math.min(bound, o.timelineStart);
  }
  return bound;
}

/** Clamp a desired start for moving `clip` within `track` so it butts up flush
 *  against the nearest neighbor in the direction of travel instead of
 *  overlapping it ("block / clamp to edge"). Relies on the no-overlap invariant:
 *  every other clip is wholly left or wholly right of `clip`'s current spot. */
function clampStartForMove(track: Track, clip: Clip, desired: Ticks): Ticks {
  const dur = clipDuration(clip);
  const orig = clip.timelineStart;
  let start = Math.max(0, desired);
  for (const o of track.clips) {
    if (o.id === clip.id) continue;
    if (start >= orig) {
      // moving right: can't pass a neighbor sitting to our right
      if (o.timelineStart >= orig && start + dur > o.timelineStart) start = Math.min(start, o.timelineStart - dur);
    } else {
      // moving left: can't pass a neighbor sitting to our left
      if (o.timelineEnd <= orig && start < o.timelineEnd) start = Math.max(start, o.timelineEnd);
    }
  }
  return Math.max(0, start);
}

/** Split `clip` at timeline `atTicks`, mutating it into the left half and
 *  returning a freshly-built right half (added to the track). Built explicitly
 *  because structuredClone() can't clone an Immer draft proxy. */
function splitOne(track: Track, clip: Clip, atTicks: Ticks, newId: string): Clip {
  const offset = atTicks - clip.timelineStart;
  const srcSplit = clip.sourceIn + Math.round(offset * clip.speed);
  const right: Clip = {
    id: newId,
    kind: clip.kind,
    assetId: clip.assetId,
    timelineStart: atTicks,
    timelineEnd: clip.timelineEnd,
    sourceIn: srcSplit,
    sourceOut: clip.sourceOut,
    speed: clip.speed,
    transform: { ...clip.transform },
    opacity: clip.opacity,
    opacityFadeIn: clip.opacityFadeIn,
    opacityFadeOut: clip.opacityFadeOut,
    volume: clip.volume,
    text: clip.text ? { ...clip.text } : undefined,
    keyframes: [],
    label: newId,
  };
  clip.timelineEnd = atTicks;
  clip.sourceOut = srcSplit;
  track.clips.push(right);
  sortClips(track);
  return right;
}

/** Find a video clip's linked audio partner (or vice-versa). */
function linkedPartner(project: Project, clip: Clip): { track: Track; clip: Clip; index: number } | null {
  return clip.linkedClipId ? findClip(project, clip.linkedClipId) : null;
}

/** The audio track that should sit directly beneath `videoTrack` in the timeline
 *  display (lower index = lower lane). Reuses the adjacent audio track if there
 *  is one, otherwise inserts a fresh audio lane right below the video lane so a
 *  video's sound always lands "right underneath it". */
function audioTrackBelow(project: Project, videoTrack: Track): Track {
  const vi = project.tracks.indexOf(videoTrack);
  const below = project.tracks[vi - 1];
  // Reuse the lane right below only if it's already a video's audio lane (holds
  // a linked clip) — never hijack a manual/music audio track.
  if (below && below.kind === "audio" && below.clips.some((c) => c.linkedClipId)) return below;
  const audioCount = project.tracks.filter((tr) => tr.kind === "audio").length;
  const track: Track = {
    id: nextId("t"),
    kind: "audio",
    name: `Audio ${audioCount + 1}`,
    enabled: true,
    locked: false,
    opacity: 1,
    volume: 1,
    clips: [],
  };
  project.tracks.splice(vi, 0, track); // insert below the video lane
  return track;
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
      // Audio lanes live at the bottom of the stack, video lanes on top
      // (index 0 = bottom lane). Keeps the "video over audio" layering invariant.
      if (cmd.kind === "audio") project.tracks.unshift(track);
      else project.tracks.push(track);
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
      const isText = !!cmd.text;
      if (isText && track.kind !== "video") throw new Error(`text clips live on video tracks, not ${track.kind}`);
      const id = cmd.clipId ?? nextId("c");
      const asset = cmd.assetId ? project.mediaLibrary.find((a) => a.id === cmd.assetId) : undefined;
      let duration = cmd.durationTicks;
      if (duration == null) {
        if (asset && asset.durationTicks > 0) duration = asset.durationTicks;
        else duration = isText ? 3 * 600 : 5 * 600; // sensible defaults
      }
      const start = Math.max(0, cmd.atTicks);
      if (wouldOverlap(track, start, duration)) throw new Error(`clip would overlap an existing clip on ${track.id} at ${t(start)}`);
      const clip: Clip = {
        id,
        kind: track.kind,
        assetId: cmd.assetId,
        timelineStart: start,
        timelineEnd: start + duration,
        sourceIn: 0,
        sourceOut: asset && asset.durationTicks > 0 ? Math.min(duration, asset.durationTicks) : duration,
        speed: 1,
        transform: defaultTransform(),
        opacity: 1,
        opacityFadeIn: 0,
        opacityFadeOut: 0,
        volume: 1,
        keyframes: [],
        text: isText ? { ...defaultTextProps(), ...cmd.text } : undefined,
        label: id,
      };
      track.clips.push(clip);
      sortClips(track);

      // A video with sound is split into a linked audio clip on the lane right
      // beneath it, so the waveform sits "right underneath" the video and the
      // two move/delete together (until unlinked). The video element is muted in
      // preview so audio plays from this clip only (no double-play).
      if (track.kind === "video" && asset && asset.kind === "video" && asset.hasAudio) {
        const audioTrack = audioTrackBelow(project, track);
        if (wouldOverlap(audioTrack, start, duration)) throw new Error(`linked audio would overlap on ${audioTrack.id} at ${t(start)}`);
        const audioId = nextId("c");
        clip.linkedClipId = audioId;
        audioTrack.clips.push({
          id: audioId,
          kind: "audio",
          assetId: cmd.assetId,
          timelineStart: start,
          timelineEnd: start + duration,
          sourceIn: clip.sourceIn,
          sourceOut: clip.sourceOut,
          speed: 1,
          transform: defaultTransform(),
          opacity: 1,
          opacityFadeIn: 0,
          opacityFadeOut: 0,
          volume: 1,
          keyframes: [],
          label: audioId,
          linkedClipId: id,
        });
        sortClips(audioTrack);
        return `added clip ${id} on ${track.id} at ${t(start)} (len ${t(duration)}) + linked audio ${audioId} on ${audioTrack.id}`;
      }
      return `added clip ${id} on ${track.id} at ${t(start)} (len ${t(duration)})`;
    }

    case "move_clip": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      const { track, clip } = found;
      const from = clip.timelineStart;

      // Cross-track move (agent only — the UI never sets toTrackId): place on the
      // target lane and reject if it would overlap. Linked clips don't follow
      // across lanes.
      if (cmd.toTrackId && cmd.toTrackId !== track.id) {
        const target = project.tracks.find((tr) => tr.id === cmd.toTrackId);
        if (!target) throw new Error(`track ${cmd.toTrackId} not found`);
        if (target.kind !== track.kind) throw new Error(`cannot move ${track.kind} clip to ${target.kind} track`);
        const dur = clipDuration(clip);
        const start = Math.max(0, cmd.toTicks);
        if (wouldOverlap(target, start, dur)) throw new Error(`clip would overlap on ${target.id} at ${t(start)}`);
        clip.timelineStart = start;
        clip.timelineEnd = start + dur;
        track.clips.splice(track.clips.indexOf(clip), 1);
        target.clips.push(clip);
        sortClips(target);
        return `moved ${clip.id} ${t(from)}→${t(start)} to ${target.id}`;
      }

      // In-lane move: clamp flush against neighbors. Linked clips travel by one
      // shared delta, clamped so neither partner overlaps on its own lane.
      const partner = linkedPartner(project, clip);
      const movers = partner ? [found, partner] : [found];
      let delta = Math.max(0, cmd.toTicks) - clip.timelineStart;
      for (const m of movers) {
        const allowed = clampStartForMove(m.track, m.clip, m.clip.timelineStart + delta) - m.clip.timelineStart;
        delta = delta >= 0 ? Math.min(delta, allowed) : Math.max(delta, allowed);
      }
      for (const m of movers) {
        const dur = clipDuration(m.clip);
        m.clip.timelineStart += delta;
        m.clip.timelineEnd = m.clip.timelineStart + dur;
        sortClips(m.track);
      }
      return `moved ${clip.id} ${t(from)}→${t(clip.timelineStart)}${partner ? ` (+linked ${partner.clip.id})` : ""}`;
    }

    case "trim_clip": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      const { clip } = found;
      // A still-linked partner (video⇄audio) trims in lockstep so the pair stays
      // aligned; unlink first to trim them independently.
      const partner = linkedPartner(project, clip);
      const set = partner ? [found, partner] : [found];

      // Neighbour bounds across the whole linked set (clips never overlap), and
      // the source-length cap: real media can only be extended up to its original
      // content. Text overlays (and stills) have no source, so they stretch freely.
      let leftBound = 0;
      let rightBound = Infinity;
      for (const m of set) {
        leftBound = Math.max(leftBound, neighborEnd(m.track, m.clip));
        rightBound = Math.min(rightBound, neighborStart(m.track, m.clip));
      }
      const asset = clip.assetId ? project.mediaLibrary.find((a) => a.id === clip.assetId) : undefined;
      const maxSourceOut = asset && asset.durationTicks > 0 ? asset.durationTicks : Infinity;

      // Left-edge trim: in-point and timeline start move together so the RIGHT
      // edge stays put. Clamp start ≥ 0 and the left neighbour, then back-solve
      // the in-point (which also can't go below the start of the source content).
      if (cmd.sourceIn != null) {
        const desiredIn = Math.max(0, Math.min(cmd.sourceIn, clip.sourceOut - 1));
        let newStart = clip.timelineStart + Math.round((desiredIn - clip.sourceIn) / clip.speed);
        newStart = Math.max(leftBound, newStart);
        let newIn = clip.sourceIn + Math.round((newStart - clip.timelineStart) * clip.speed);
        newIn = Math.max(0, Math.min(newIn, clip.sourceOut - 1));
        clip.sourceIn = newIn;
        clip.timelineStart = Math.max(0, newStart);
      }
      // Right-edge trim: out-point moves; timeline end follows (start fixed).
      // Clamp against the right neighbour AND the source length (no extending a
      // clip past the end of its real footage).
      if (cmd.sourceOut != null) {
        const desiredOut = Math.max(clip.sourceIn + 1, Math.min(cmd.sourceOut, maxSourceOut));
        let newEnd = clip.timelineStart + Math.round((desiredOut - clip.sourceIn) / clip.speed);
        newEnd = Math.min(rightBound, newEnd);
        const newOut = clip.sourceIn + Math.round((newEnd - clip.timelineStart) * clip.speed);
        clip.sourceOut = Math.max(clip.sourceIn + 1, Math.min(newOut, maxSourceOut));
      }
      clip.timelineEnd = clip.timelineStart + Math.round((clip.sourceOut - clip.sourceIn) / clip.speed);

      // Mirror the result onto the linked partner (same asset, same placement).
      if (partner) {
        partner.clip.sourceIn = clip.sourceIn;
        partner.clip.sourceOut = clip.sourceOut;
        partner.clip.timelineStart = clip.timelineStart;
        partner.clip.timelineEnd = clip.timelineEnd;
      }
      return `trimmed ${clip.id}${partner ? ` (+linked ${partner.clip.id})` : ""} → ${t(clip.timelineStart)}..${t(clip.timelineEnd)} (src ${t(clip.sourceIn)}→${t(clip.sourceOut)})`;
    }

    case "split_clip": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      const { track, clip } = found;
      if (cmd.atTicks <= clip.timelineStart || cmd.atTicks >= clip.timelineEnd)
        throw new Error(`split point ${t(cmd.atTicks)} is outside clip ${clip.id}`);
      const right = splitOne(track, clip, cmd.atTicks, cmd.newClipId ?? nextId("c"));

      // Split the linked partner at the same point so the two right-halves stay
      // a linked pair. If the point falls outside the partner, drop the link
      // rather than leave a dangling reference.
      const partner = linkedPartner(project, clip);
      if (partner) {
        if (cmd.atTicks > partner.clip.timelineStart && cmd.atTicks < partner.clip.timelineEnd) {
          const partnerRight = splitOne(partner.track, partner.clip, cmd.atTicks, nextId("c"));
          right.linkedClipId = partnerRight.id;
          partnerRight.linkedClipId = right.id;
          // clip ⇄ partner.clip links are preserved for the left halves
          return `split ${clip.id} + ${partner.clip.id} at ${t(cmd.atTicks)} → ${right.id} + ${partnerRight.id}`;
        }
        clip.linkedClipId = undefined;
        partner.clip.linkedClipId = undefined;
      }
      return `split ${clip.id} at ${t(cmd.atTicks)} → ${clip.id} + ${right.id}`;
    }

    case "delete_clip": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      // A linked pair (video + its audio) is deleted together.
      const partner = linkedPartner(project, found.clip);
      const targets = partner ? [found, partner] : [found];
      const removedIds: string[] = [];
      for (const { track, clip } of targets) {
        const index = track.clips.indexOf(clip);
        if (index < 0) continue;
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
        removedIds.push(clip.id);
      }
      editor.selectedClipIds = editor.selectedClipIds.filter((id) => !removedIds.includes(id));
      return `deleted ${removedIds.join(" + ")}${cmd.ripple ? " (ripple)" : ""}`;
    }

    case "unlink_clip": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      const partner = linkedPartner(project, found.clip);
      if (!partner) throw new Error(`clip ${cmd.clipId} is not linked`);
      found.clip.linkedClipId = undefined;
      partner.clip.linkedClipId = undefined;
      return `unlinked ${found.clip.id} ⇄ ${partner.clip.id}`;
    }

    case "set_transform": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      Object.assign(found.clip.transform, cmd.patch);
      const keys = Object.keys(cmd.patch).join(",");
      return `set transform[${keys}] on ${cmd.clipId}`;
    }

    case "set_color": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      found.clip.color = { ...found.clip.color, ...cmd.patch };
      return `set color[${Object.keys(cmd.patch).join(",")}] on ${cmd.clipId}`;
    }

    case "set_style": {
      const found = findClip(project, cmd.clipId);
      if (!found) throw new Error(`clip ${cmd.clipId} not found`);
      found.clip.style = { ...found.clip.style, ...cmd.patch };
      return `set style[${Object.keys(cmd.patch).join(",")}] on ${cmd.clipId}`;
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

    case "move_track": {
      const from = project.tracks.findIndex((tr) => tr.id === cmd.trackId);
      if (from < 0) throw new Error(`track ${cmd.trackId} not found`);
      const to = Math.max(0, Math.min(project.tracks.length - 1, Math.round(cmd.toIndex)));
      if (to === from) return `track ${cmd.trackId} already at ${from}`;
      const [tr] = project.tracks.splice(from, 1);
      project.tracks.splice(to, 0, tr);
      return `moved track ${cmd.trackId} ${from}→${to}`;
    }

    case "set_track": {
      const track = project.tracks.find((tr) => tr.id === cmd.trackId);
      if (!track) throw new Error(`track ${cmd.trackId} not found`);
      if (cmd.patch.name != null) track.name = cmd.patch.name;
      if (cmd.patch.enabled != null) track.enabled = cmd.patch.enabled;
      if (cmd.patch.locked != null) track.locked = cmd.patch.locked;
      if (cmd.patch.opacity != null) track.opacity = Math.max(0, Math.min(1, cmd.patch.opacity));
      if (cmd.patch.volume != null) track.volume = Math.max(0, Math.min(1, cmd.patch.volume));
      return `set track[${Object.keys(cmd.patch).join(",")}] on ${track.id}`;
    }

    case "set_canvas": {
      Object.assign(project.canvas, cmd.patch);
      return `set canvas ${project.canvas.width}x${project.canvas.height}@${project.canvas.fps}`;
    }

    case "set_asset_analysis": {
      const asset = project.mediaLibrary.find((a) => a.id === cmd.assetId);
      if (!asset) throw new Error(`asset ${cmd.assetId} not found`);
      asset.analysis = { ...asset.analysis, ...cmd.patch };
      return `set analysis[${Object.keys(cmd.patch).join(",")}] on ${cmd.assetId}`;
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
