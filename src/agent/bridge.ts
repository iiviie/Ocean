// The agent bridge. This is the in-process stand-in for what the Rust MCP server
// will eventually drive. It exposes the SAME command bus + read selectors that
// the UI uses, so anything the agent does here renders in the UI immediately.
//
// Today it's reachable from the devtools console as `window.ocean` and from the
// in-app agent chat panel. Tomorrow the Tauri/MCP layer forwards tool calls into
// exactly these functions. Tool outputs are kept compact per PRD §7.
import { useStore } from "@/model/store";
import type { Command } from "@/model/commands";
import {
  canvasLayoutAt,
  boxesOverlap,
  projectDurationTicks,
} from "@/model/selectors";
import { round2, ticksToSeconds, secondsToTicks } from "@/model/time";

const s = () => useStore.getState();

/** A clip-mention name the agent and human share: @short-track-timecode. */

export const oceanAgent = {
  // ---- the single mutation entrypoint ----
  dispatch: (cmd: Command) => s().dispatch(cmd, "agent"),

  // ---- read / awareness tools (compact output) ----
  get_project() {
    const p = s().project;
    return {
      name: p.name,
      canvas: { w: p.canvas.width, h: p.canvas.height, fps: p.canvas.fps },
      duration: round2(ticksToSeconds(projectDurationTicks(p))),
      tracks: p.tracks.length,
      assets: p.mediaLibrary.length,
    };
  },

  /** Windowed timeline view (PRD §7) — never dumps the whole project. */
  get_timeline(opts?: { fromSec?: number; toSec?: number; trackIds?: string[] }) {
    const p = s().project;
    const from = opts?.fromSec != null ? secondsToTicks(opts.fromSec) : 0;
    const to = opts?.toSec != null ? secondsToTicks(opts.toSec) : Infinity;
    return p.tracks
      .filter((t) => !opts?.trackIds || opts.trackIds.includes(t.id))
      .map((t) => ({
        id: t.id,
        kind: t.kind,
        clips: t.clips
          .filter((c) => c.timelineEnd > from && c.timelineStart < to)
          .map((c) => ({
            id: c.id,
            in: round2(ticksToSeconds(c.timelineStart)),
            out: round2(ticksToSeconds(c.timelineEnd)),
            asset: c.assetId,
            ...(c.text ? { text: c.text.content } : {}),
          })),
      }));
  },

  /** Spatial awareness: object boxes + overlap warnings at a given time. */
  get_canvas_layout(atSec: number) {
    const p = s().project;
    const boxes = canvasLayoutAt(p, secondsToTicks(atSec));
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        if (boxesOverlap(boxes[i], boxes[j])) overlaps.push(`${boxes[i].clipId}~${boxes[j].clipId}`);
    return {
      canvas: { w: p.canvas.width, h: p.canvas.height },
      objects: boxes.map((b) => ({
        clip: b.clipId,
        kind: b.kind,
        cx: round2(b.centerX),
        cy: round2(b.centerY),
        w: round2(b.width),
        h: round2(b.height),
        z: b.zIndex,
      })),
      overlaps,
    };
  },

  /** Recent command log so the agent can see the effect of its own edits. */
  recent(n = 10) {
    return s()
      .log.slice(-n)
      .map((e) => ({ src: e.source, diff: e.diff, ...(e.error ? { error: e.error } : {}) }));
  },
};

declare global {
  interface Window {
    ocean: typeof oceanAgent;
  }
}

export function installAgentBridge(): void {
  window.ocean = oceanAgent;
  // eslint-disable-next-line no-console
  console.info("[ocean] agent bridge ready — try ocean.get_project() or ocean.dispatch({...})");
}
