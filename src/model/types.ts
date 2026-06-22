// Ocean document model — the single source of truth (PRD §6.3).
// Both the UI and (later) the MCP server are clients of the store that holds this.
import type { Ticks } from "./time";

export type MediaKind = "video" | "image" | "audio" | "lottie";
// Only two layer kinds: video (carries visuals — media + text overlays) and
// audio. Text is no longer its own track; a text clip is just a clip with
// `text` set living on a video track (PRD §6.3 — layers, not clip taxonomies).
export type TrackKind = "video" | "audio";

/** Identity used as a cache key for analysis artifacts (PRD §8.4). */
export interface FileIdentity {
  hash: string; // content hash (sha256 truncated) — placeholder until Rust core wires real hashing
  size: number;
  mtime: number;
}

export interface ColorInfo {
  primaries?: string; // e.g. "bt709"
  transfer?: string;
  range?: "full" | "limited";
  /** Whether the source carries straight (un-premultiplied) alpha. */
  straightAlpha?: boolean;
}

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  uri: string; // file:// or blob: or asset:// — resolved by the media resolver
  fileIdentity?: FileIdentity;
  durationTicks: Ticks; // 0 for still images
  naturalWidth: number;
  naturalHeight: number;
  hasAudio: boolean;
  colorInfo?: ColorInfo;
  /** Lazy, cached analysis handles (resolved by tools, not stored inline).
   *  Each ref is the fileIdentity hash that keys the out-of-band analysis cache;
   *  the heavy artifact (shots/transcript/beats) never lives in the document.
   *  See PERCEPTION_LAYER §1. */
  analysis?: {
    shotsRef?: string;
    transcriptRef?: string;
    beatsRef?: string;
    storyboardRef?: string;
    analyzedAt?: number; // epoch ms of the most recent analysis write
  };
  missing?: boolean; // surfaced in UI rather than failing silently (PRD §5.3)
}

/** Center-anchored transform; scale is decoupled from position (PRD §6.3 lesson).
 *  centerX/centerY are normalized 0..1 of the canvas so the agent reasons about
 *  layout independently of pixel resolution (PRD §7). */
export interface Transform {
  centerX: number; // 0..1 (0.5 = centered)
  centerY: number; // 0..1
  scale: number; // 1 = natural fit
  rotation: number; // degrees
  flipH: boolean;
  flipV: boolean;
}

export const defaultTransform = (): Transform => ({
  centerX: 0.5,
  centerY: 0.5,
  scale: 1,
  rotation: 0,
  flipH: false,
  flipV: false,
});

/** Named one-shot color "looks" — higher conversational value for an agent than
 *  raw sliders (PROPERTY_MODEL §2.4 / appendix). */
export type FilterPreset = "none" | "grayscale" | "sepia" | "invert" | "vintage";

/** Color correction for video/image clips. All fields optional; absent = neutral. */
export interface ColorAdjust {
  brightness?: number; // -1..1, 0 = none
  contrast?: number; // -1..1, 0 = none
  saturation?: number; // 0..2, 1 = none
  hue?: number; // degrees, -180..180
  filter?: FilterPreset;
}

export type TextAlign = "left" | "center" | "right";

export interface TextProps {
  content: string;
  fontName: string;
  fontSize: number; // px in canvas space
  color: string;
  align: TextAlign;
  lineHeight: number;
}

export const defaultTextProps = (content = "Text"): TextProps => ({
  content,
  fontName: "Inter",
  fontSize: 64,
  color: "#ffffff",
  align: "center",
  lineHeight: 1.2,
});

export type KeyframeProp =
  | "centerX"
  | "centerY"
  | "scale"
  | "rotation"
  | "opacity";

export interface Keyframe {
  id: string;
  prop: KeyframeProp;
  atTicks: Ticks; // relative to clip timelineStart
  value: number;
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

export interface Clip {
  id: string;
  kind: TrackKind; // matches its track kind
  assetId?: string; // text clips have none
  // timeline placement (integer ticks)
  timelineStart: Ticks;
  timelineEnd: Ticks;
  // source range for trims (media clips)
  sourceIn: Ticks;
  sourceOut: Ticks;
  speed: number; // 1 = normal
  transform: Transform;
  color?: ColorAdjust; // color correction (video/image); absent = neutral
  opacity: number; // 0..1
  opacityFadeIn: Ticks;
  opacityFadeOut: Ticks;
  volume: number; // 0..1 (audio/video)
  text?: TextProps;
  keyframes: Keyframe[];
  label?: string; // short human/agent mention name
  /** When a video clip carries audio, its sound is split onto a linked audio
   *  clip directly beneath it. Both clips point at each other and move/delete
   *  together until unlinked (right-click → Unlink). */
  linkedClipId?: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  enabled: boolean;
  locked: boolean;
  opacity: number; // 0..1, track-level
  volume: number; // 0..1, track-level
  clips: Clip[];
}

export interface Marker {
  id: string;
  atTicks: Ticks;
  kind: "beat" | "downbeat" | "chapter" | "generic";
  label?: string;
}

export interface Canvas {
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  canvas: Canvas;
  sampleRate: number; // audio
  mediaLibrary: MediaAsset[];
  tracks: Track[]; // index 0 = bottom layer
  markers: Marker[];
}

/** Ephemeral UI/agent state that is NOT part of the saved document but still
 *  lives in the same store so AI selection/playhead changes are visible. */
export interface EditorState {
  playheadTicks: Ticks;
  playing: boolean;
  selectedClipIds: string[];
  selectedAssetId?: string;
  /** Time range selection on the timeline (agent-referenceable). */
  rangeSelection?: { startTicks: Ticks; endTicks: Ticks };
  zoom: number; // pixels per second in the timeline
  /** Clips currently being mutated by the agent → show working overlay. */
  workingClipIds: string[];
}
