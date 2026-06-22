import { useEffect, useRef, useState } from "react";
import { MousePointer2, Scissors, Type, ZoomIn, ZoomOut, Plus, Link2Off, Trash2 } from "lucide-react";
import { useStore } from "@/model/store";
import { freeStartFor, projectDurationTicks } from "@/model/selectors";
import { ticksToSeconds, secondsToTicks, formatTimecodeFrames } from "@/model/time";
import { nextId } from "@/model/ids";
import type { Clip, Track, TrackKind } from "@/model/types";
import { cn } from "@/ui/lib/cn";

// Clip color: text overlays read as text regardless of their (video) lane.
function clipBg(clip: Clip): string {
  if (clip.text) return "bg-textclip/85";
  return clip.kind === "audio" ? "bg-audio/85" : "bg-video/85";
}

function trackTag(tracks: Track[], track: Track): string {
  const prefix = track.kind === "video" ? "V" : "A";
  return `${prefix}${tracks.filter((t) => t.kind === track.kind).indexOf(track) + 1}`;
}

const LABEL_W = 56;

export function Timeline() {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.editor.zoom);
  const fps = project.canvas.fps;
  const playhead = useStore((s) => s.editor.playheadTicks);
  const selected = useStore((s) => s.editor.selectedClipIds);
  const working = useStore((s) => s.editor.workingClipIds);
  const dispatch = useStore((s) => s.dispatch);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; clip: Clip } | null>(null);

  // Dismiss the context menu on any outside click / escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  const durSec = Math.max(20, ticksToSeconds(projectDurationTicks(project)) + 4);
  const laneWidth = durSec * zoom;
  const pxPerTick = zoom / 600;

  const step = zoom < 12 ? 10 : zoom < 30 ? 5 : zoom < 80 ? 2 : 1;
  const ticks: number[] = [];
  for (let s = 0; s <= durSec; s += step) ticks.push(s);

  // Seek/scrub: map an x coordinate (relative to the track content area) to time.
  const seekToClientX = (clientX: number) => {
    const el = trackAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - LABEL_W; // time origin starts after the label column
    dispatch({ type: "set_playhead", atTicks: Math.max(0, secondsToTicks(x / zoom)) });
  };

  // Click + drag anywhere on the ruler / empty timeline to scrub the playhead.
  const beginScrub = (e: React.MouseEvent) => {
    seekToClientX(e.clientX);
    const move = (ev: MouseEvent) => seekToClientX(ev.clientX);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ---- tool actions (also available as MCP tools: split_clip / add_clip) ----
  const splitSelected = () => {
    const { editor, project: p } = useStore.getState();
    const id = editor.selectedClipIds[0];
    if (!id) return;
    let clip: Clip | undefined;
    for (const t of p.tracks) clip = clip ?? t.clips.find((c) => c.id === id);
    if (!clip || editor.playheadTicks <= clip.timelineStart || editor.playheadTicks >= clip.timelineEnd) return;
    dispatch({ type: "split_clip", clipId: id, atTicks: editor.playheadTicks, newClipId: nextId("c") });
  };
  const addText = () => {
    const { project: p, editor } = useStore.getState();
    // Text lives on a video lane now — use the topmost video track, or make one.
    let tId = [...p.tracks].reverse().find((t) => t.kind === "video")?.id;
    if (!tId) {
      tId = nextId("t");
      dispatch({ type: "add_track", kind: "video", trackId: tId });
    }
    const track = useStore.getState().project.tracks.find((t) => t.id === tId)!;
    const at = freeStartFor(track, editor.playheadTicks, 3 * 600);
    dispatch({ type: "add_clip", trackId: tId, atTicks: at, clipId: nextId("c"), text: { content: "Text" } });
  };

  return (
    <div className="flex h-full flex-col bg-card">
      {/* tool row */}
      <div className="flex h-9 flex-none items-center gap-1 border-b border-border-soft px-2">
        <ToolBtn active title="Select"><MousePointer2 size={14} /></ToolBtn>
        <ToolBtn title="Split selected clip at playhead" onClick={splitSelected}><Scissors size={14} /></ToolBtn>
        <ToolBtn title="Add text at playhead" onClick={addText}><Type size={14} /></ToolBtn>
        <div className="mx-1 h-4 w-px bg-border" />
        {(["video", "audio"] as TrackKind[]).map((k) => (
          <button key={k} className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => dispatch({ type: "add_track", kind: k })}>
            <Plus size={12} /> {k}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <ToolBtn title="Zoom out" onClick={() => dispatch({ type: "set_zoom", zoom: zoom / 1.4 })}><ZoomOut size={14} /></ToolBtn>
          <ToolBtn title="Zoom in" onClick={() => dispatch({ type: "set_zoom", zoom: zoom * 1.4 })}><ZoomIn size={14} /></ToolBtn>
        </div>
      </div>

      {/* scroll area */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        {/* ruler — click/drag to scrub */}
        <div className="flex min-w-max">
          <div className="flex-none" style={{ width: LABEL_W }} />
          <div className="sticky top-0 z-30 h-7 cursor-ew-resize bg-surface-2" style={{ width: laneWidth }} onMouseDown={beginScrub}>
            {ticks.map((s) => (
              <div key={s} className="pointer-events-none absolute top-0 h-full border-l border-border pl-1 text-[9px] leading-7 tabular-nums text-subtle" style={{ left: s * zoom }}>
                {formatTimecodeFrames(secondsToTicks(s), fps)}
              </div>
            ))}
          </div>
        </div>

        {/* tracks */}
        <div ref={trackAreaRef} className="relative">
          {[...project.tracks].reverse().map((track) => (
            <div key={track.id} className="flex h-[42px] items-stretch border-b border-border-soft">
              <div className="sticky left-0 z-20 flex flex-none items-center border-r border-border-soft bg-surface-2 px-2" style={{ width: LABEL_W }}>
                <span className="text-[11px] font-semibold text-muted-foreground">{trackTag(project.tracks, track)}</span>
              </div>
              <div
                className="relative flex-1"
                onMouseDown={beginScrub}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const assetId = e.dataTransfer.getData("application/x-ocean-asset") || e.dataTransfer.getData("text/plain");
                  if (!assetId) return;
                  const asset = project.mediaLibrary.find((a) => a.id === assetId);
                  if (!asset || (track.kind === "audio") !== (asset.kind === "audio")) return;
                  const rect = trackAreaRef.current!.getBoundingClientRect();
                  const at = Math.max(0, secondsToTicks((e.clientX - rect.left - LABEL_W) / zoom));
                  const dur = asset.durationTicks > 0 ? asset.durationTicks : 5 * 600;
                  // Snap into the next free slot so a drop never overlaps a clip.
                  dispatch({ type: "add_clip", trackId: track.id, assetId, atTicks: freeStartFor(track, at, dur), clipId: nextId("c") });
                }}
              >
                {track.clips.map((clip) => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    bg={clipBg(clip)}
                    pxPerTick={pxPerTick}
                    selected={selected.includes(clip.id)}
                    working={working.includes(clip.id)}
                    onSelect={() => dispatch({ type: "select_clips", clipIds: [clip.id] })}
                    onContext={(e) => {
                      dispatch({ type: "select_clips", clipIds: [clip.id] });
                      setMenu({ x: e.clientX, y: e.clientY, clip });
                    }}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* markers + playhead overlay (sits over tracks, not the labels) */}
          <div className="pointer-events-none absolute inset-y-0 z-10" style={{ left: LABEL_W, width: laneWidth }}>
            {project.markers.map((m) => (
              <div key={m.id} className="absolute inset-y-0 w-px bg-beat/70" style={{ left: m.atTicks * pxPerTick }} />
            ))}
            <div className="absolute inset-y-0 z-20 w-px bg-playhead" style={{ left: playhead * pxPerTick }} />
          </div>
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-40 overflow-hidden rounded-md border border-border bg-popover py-1 text-[12px] shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuItem
            onClick={() => {
              const at = useStore.getState().editor.playheadTicks;
              if (at > menu.clip.timelineStart && at < menu.clip.timelineEnd)
                dispatch({ type: "split_clip", clipId: menu.clip.id, atTicks: at });
              setMenu(null);
            }}
          >
            <Scissors size={13} /> Split at playhead
          </MenuItem>
          {menu.clip.linkedClipId && (
            <MenuItem
              onClick={() => {
                dispatch({ type: "unlink_clip", clipId: menu.clip.id });
                setMenu(null);
              }}
            >
              <Link2Off size={13} /> Unlink audio
            </MenuItem>
          )}
          <MenuItem
            destructive
            onClick={() => {
              dispatch({ type: "delete_clip", clipId: menu.clip.id, ripple: false });
              setMenu(null);
            }}
          >
            <Trash2 size={13} /> Delete{menu.clip.linkedClipId ? " (both)" : ""}
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, destructive }: { children: React.ReactNode; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent",
        destructive ? "text-destructive" : "text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ToolBtn({ children, active, title, onClick }: { children: React.ReactNode; active?: boolean; title: string; onClick?: () => void }) {
  return (
    <button title={title} onClick={onClick} className={cn("grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground", active && "bg-accent text-foreground")}>
      {children}
    </button>
  );
}

function ClipView({ clip, bg, pxPerTick, selected, working, onSelect, onContext }: { clip: Clip; bg: string; pxPerTick: number; selected: boolean; working: boolean; onSelect: () => void; onContext: (e: React.MouseEvent) => void }) {
  // Drag the clip body to move it along the timeline (move_clip — also an MCP
  // tool). A small threshold distinguishes a click (select) from a drag.
  const onBodyDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const origStart = clip.timelineStart;
    let dragging = false;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!dragging && Math.abs(dx) < 3) return;
      dragging = true;
      const toTicks = Math.max(0, origStart + Math.round(dx / pxPerTick));
      try {
        useStore.getState().dispatch({ type: "move_clip", clipId: clip.id, toTicks }, "ui");
      } catch {
        /* ignore */
      }
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const trimEdge = (side: "in" | "out") => (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    const startX = e.clientX;
    const origIn = clip.sourceIn;
    const origOut = clip.sourceOut;
    const move = (ev: MouseEvent) => {
      const dTicks = Math.round(((ev.clientX - startX) / pxPerTick) * clip.speed);
      try {
        if (side === "in") useStore.getState().dispatch({ type: "trim_clip", clipId: clip.id, sourceIn: origIn + dTicks }, "ui");
        else useStore.getState().dispatch({ type: "trim_clip", clipId: clip.id, sourceOut: origOut + dTicks }, "ui");
      } catch {
        /* ignore */
      }
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      className={cn(
        "group absolute inset-y-1 flex cursor-grab items-center overflow-hidden rounded px-2 text-[11px] font-medium text-white/95 active:cursor-grabbing",
        bg,
        selected ? "ring-2 ring-white/80" : "ring-1 ring-white/10",
        working && "animate-pulse",
      )}
      style={{ left: clip.timelineStart * pxPerTick, width: Math.max(2, (clip.timelineEnd - clip.timelineStart) * pxPerTick) }}
      onMouseDown={onBodyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContext(e);
      }}
      title={clip.label ?? clip.id}
    >
      <span className="pointer-events-none truncate">{clip.text ? clip.text.content : clip.label ?? clip.id}</span>
      {/* trim handles (media clips) */}
      {clip.assetId && (
        <>
          <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100" onMouseDown={trimEdge("in")} />
          <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100" onMouseDown={trimEdge("out")} />
        </>
      )}
    </div>
  );
}
