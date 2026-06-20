// Derived/read views over the document. These power both the UI and the AI
// "awareness" tools (PRD §8.2): spatial layout, temporal layout, etc.
import type { Clip, Project, Track } from "./types";
import type { Ticks } from "./time";

export function projectDurationTicks(project: Project): Ticks {
  let max = 0;
  for (const tr of project.tracks)
    for (const c of tr.clips) max = Math.max(max, c.timelineEnd);
  return max;
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function clipsAt(project: Project, atTicks: Ticks): { track: Track; clip: Clip }[] {
  const out: { track: Track; clip: Clip }[] = [];
  for (const track of project.tracks) {
    if (!track.enabled) continue;
    for (const clip of track.clips) {
      if (atTicks >= clip.timelineStart && atTicks < clip.timelineEnd) out.push({ track, clip });
    }
  }
  return out;
}

/** Bounding box of a clip on the canvas, in normalized 0..1 coords. Powers
 *  spatial awareness (get_canvas_layout) so the AI knows object size/overlap. */
export interface LayoutBox {
  clipId: string;
  kind: string;
  centerX: number;
  centerY: number;
  width: number; // normalized
  height: number; // normalized
  rotation: number;
  zIndex: number;
}

export function canvasLayoutAt(project: Project, atTicks: Ticks): LayoutBox[] {
  const { width: cw, height: ch } = project.canvas;
  const boxes: LayoutBox[] = [];
  project.tracks.forEach((track, trackIndex) => {
    if (track.kind === "audio" || !track.enabled) return;
    for (const clip of track.clips) {
      if (atTicks < clip.timelineStart || atTicks >= clip.timelineEnd) continue;
      const asset = project.mediaLibrary.find((a) => a.id === clip.assetId);
      let natW = asset?.naturalWidth ?? cw;
      let natH = asset?.naturalHeight ?? ch;
      if (clip.text) {
        // rough text box estimate from font size + content length
        const lines = clip.text.content.split("\n");
        const longest = Math.max(1, ...lines.map((l) => l.length));
        natW = longest * clip.text.fontSize * 0.55;
        natH = lines.length * clip.text.fontSize * clip.text.lineHeight;
      }
      // "fit" scale so natural media fills canvas, then user scale on top
      const fit = clip.text ? 1 : Math.min(cw / natW, ch / natH);
      const w = (natW * fit * clip.transform.scale) / cw;
      const h = (natH * fit * clip.transform.scale) / ch;
      boxes.push({
        clipId: clip.id,
        kind: clip.kind,
        centerX: clip.transform.centerX,
        centerY: clip.transform.centerY,
        width: Math.min(2, w),
        height: Math.min(2, h),
        rotation: clip.transform.rotation,
        zIndex: trackIndex,
      });
    }
  });
  return boxes.sort((a, b) => a.zIndex - b.zIndex);
}

/** Do two normalized boxes overlap? Used to warn the AI about occlusion. */
export function boxesOverlap(a: LayoutBox, b: LayoutBox): boolean {
  return (
    Math.abs(a.centerX - b.centerX) * 2 < a.width + b.width &&
    Math.abs(a.centerY - b.centerY) * 2 < a.height + b.height
  );
}
