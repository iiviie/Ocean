// Audio playback in the webview. For each audible clip (audio tracks + video
// clips whose source has audio) we keep an <audio> element, played through
// Tauri's asset protocol and synced to the playhead. A light reconcile loop
// (not per-frame) starts/stops/seeks elements and corrects drift.
//
// This is the pragmatic audio path: the heavy A/V work (sample-accurate mixing,
// a shared audio clock driving video) is a later milestone. Best-effort and
// defensive — failures here never break the video preview.
import { useEffect, useRef } from "react";
import { useStore } from "@/model/store";
import { ticksToSeconds } from "@/model/time";
import { fadeGain } from "@/model/fades";
import { inElectron, mediaUrl } from "@/engine/render";
import type { Project } from "@/model/types";

interface Audible {
  clipId: string;
  path: string;
  startTicks: number;
  endTicks: number;
  sourceInTicks: number;
  speed: number;
  vol: number;
  fadeIn: number;
  fadeOut: number;
}

function collectAudible(project: Project): Audible[] {
  const out: Audible[] = [];
  for (const track of project.tracks) {
    if (!track.enabled) continue;
    // Only audio tracks here — video clips carry their own audio via the
    // <video> elements in the preview, so including them would double-play.
    if (track.kind !== "audio") continue;
    for (const clip of track.clips) {
      if (!clip.assetId) continue;
      const asset = project.mediaLibrary.find((a) => a.id === clip.assetId);
      if (!asset || asset.missing) continue;
      out.push({
        clipId: clip.id,
        path: mediaUrl(asset.uri),
        startTicks: clip.timelineStart,
        endTicks: clip.timelineEnd,
        sourceInTicks: clip.sourceIn,
        speed: clip.speed || 1,
        vol: Math.max(0, Math.min(1, (clip.volume ?? 1) * (track.volume ?? 1))),
        fadeIn: clip.opacityFadeIn,
        fadeOut: clip.opacityFadeOut,
      });
    }
  }
  return out;
}

export function useAudioPlayback(): void {
  const els = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    if (!inElectron) return;
    const elements = els.current;

    const reconcile = () => {
      const { project, editor } = useStore.getState();
      const { playing, playheadTicks: t } = editor;
      const audible = collectAudible(project);
      const seen = new Set<string>();

      for (const c of audible) {
        seen.add(c.clipId);
        let el = elements.get(c.clipId);
        if (!el) {
          el = new Audio();
          el.preload = "auto";
          el.src = c.path;
          elements.set(c.clipId, el);
        }
        el.volume = c.vol * fadeGain(t, c.startTicks, c.endTicks, c.fadeIn, c.fadeOut);
        el.playbackRate = c.speed;
        const active = playing && t >= c.startTicks && t < c.endTicks;
        if (active) {
          const expected = ticksToSeconds(c.sourceInTicks + Math.round((t - c.startTicks) * c.speed));
          if (Math.abs(el.currentTime - expected) > 0.3) el.currentTime = expected;
          if (el.paused) el.play().catch(() => {});
        } else if (!el.paused) {
          el.pause();
        }
      }

      for (const [id, el] of elements) {
        if (!seen.has(id)) {
          el.pause();
          elements.delete(id);
        }
      }
    };

    reconcile();
    const iv = window.setInterval(reconcile, 200);
    return () => {
      window.clearInterval(iv);
      for (const el of elements.values()) el.pause();
      elements.clear();
    };
  }, []);
}
