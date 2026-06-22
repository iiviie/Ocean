import { useEffect, useRef, useState } from "react";
import { MousePointer2, Scissors, Type, ZoomIn, ZoomOut, Plus, Link2Off, Trash2, Lock, LockOpen, Eye, EyeOff, Volume2, VolumeX, GripVertical } from "lucide-react";
import { useStore } from "@/model/store";
import { freeStartFor, projectDurationTicks } from "@/model/selectors";
import { ticksToSeconds, secondsToTicks, formatTimecodeFrames } from "@/model/time";
import { nextId } from "@/model/ids";
import type { Clip, Track, TrackKind } from "@/model/types";
import { cn } from "@/ui/lib/cn";

// Clip color: text overlays read as text regardless of their (video) lane.
function clipBg(clip: Clip): string {
  if (clip.text) return "bg-textclip";
  return clip.kind === "audio" ? "bg-audio" : "bg-video";
}

function trackTag(tracks: Track[], track: Track): string {
  const prefix = track.kind === "video" ? "V" : "A";
  return `${prefix}${tracks.filter((t) => t.kind === track.kind).indexOf(track) + 1}`;
}

const HEADER_W = 104;
const TRACK_H = 44;

type Hint = { x: number; y: number; text: string } | null;

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
  const [hint, setHint] = useState<Hint>(null);

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
  const ruler: number[] = [];
  for (let s = 0; s <= durSec; s += step) ruler.push(s);

  const display = [...project.tracks].reverse(); // top of the stack rendered first
  const nTracks = project.tracks.length;

  // Map a clientY to a display row index (0 = top), then to a track / array index.
  const rowAtY = (clientY: number): number => {
    const el = trackAreaRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(Math.max(0, nTracks - 1), Math.floor((clientY - rect.top) / TRACK_H)));
  };
  const trackAtY = (clientY: number): Track | null => display[rowAtY(clientY)] ?? null;

  // Seek/scrub: map an x coordinate (relative to the track content area) to time.
  const seekToClientX = (clientX: number) => {
    const el = trackAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - HEADER_W; // time origin starts after the header column
    dispatch({ type: "set_playhead", atTicks: Math.max(0, secondsToTicks(x / zoom)) });
  };
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

  // ---- tool actions (also available as MCP tools) ----
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
    let tId = [...p.tracks].reverse().find((t) => t.kind === "video")?.id;
    if (!tId) {
      tId = nextId("t");
      dispatch({ type: "add_track", kind: "video", trackId: tId });
    }
    const track = useStore.getState().project.tracks.find((t) => t.id === tId)!;
    const at = freeStartFor(track, editor.playheadTicks, 3 * 600);
    dispatch({ type: "add_clip", trackId: tId, atTicks: at, clipId: nextId("c"), text: { content: "Text" } });
  };

  // Drag a track header to reorder the layer (also the move_track MCP tool).
  const beginReorder = (track: Track) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev: MouseEvent) => {
      const toIndex = nTracks - 1 - rowAtY(ev.clientY);
      setHint({ x: ev.clientX, y: ev.clientY, text: `${trackTag(project.tracks, track)} → layer ${toIndex}` });
    };
    const up = (ev: MouseEvent) => {
      const toIndex = nTracks - 1 - rowAtY(ev.clientY);
      try {
        dispatch({ type: "move_track", trackId: track.id, toIndex });
      } catch {
        /* ignore */
      }
      setHint(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
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
          <button key={k} className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => dispatch({ type: "add_track", kind: k })}>
            <Plus size={12} /> {k}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <ToolBtn title="Zoom out" onClick={() => dispatch({ type: "set_zoom", zoom: zoom / 1.4 })}><ZoomOut size={14} /></ToolBtn>
          <ToolBtn title="Zoom in" onClick={() => dispatch({ type: "set_zoom", zoom: zoom * 1.4 })}><ZoomIn size={14} /></ToolBtn>
        </div>
      </div>

      {/* scroll area */}
      <div className="relative min-h-0 flex-1 overflow-auto bg-background">
        {/* ruler — click/drag to scrub */}
        <div className="flex min-w-max">
          <div className="sticky left-0 z-30 flex-none border-r border-border bg-secondary" style={{ width: HEADER_W }} />
          <div className="sticky top-0 z-20 h-7 cursor-ew-resize bg-secondary" style={{ width: laneWidth }} onMouseDown={beginScrub}>
            {ruler.map((s) => (
              <div key={s} className="pointer-events-none absolute top-0 h-full border-l border-border pl-1 text-[9px] leading-7 tabular-nums text-subtle" style={{ left: s * zoom }}>
                {formatTimecodeFrames(secondsToTicks(s), fps)}
              </div>
            ))}
          </div>
        </div>

        {/* tracks */}
        <div ref={trackAreaRef} className="relative min-w-max">
          {display.map((track) => (
            <div key={track.id} className={cn("flex items-stretch border-b border-border-soft", !track.enabled && "opacity-50")} style={{ height: TRACK_H }}>
              {/* header column */}
              <div className="sticky left-0 z-20 flex flex-none items-center gap-1 border-r border-border bg-secondary px-1.5" style={{ width: HEADER_W }}>
                <button title="Drag to reorder layer" onMouseDown={beginReorder(track)} className="cursor-grab text-subtle hover:text-foreground active:cursor-grabbing">
                  <GripVertical size={13} />
                </button>
                <span className={cn("w-5 text-[11px] font-semibold", track.kind === "video" ? "text-video" : "text-audio")}>{trackTag(project.tracks, track)}</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <HeaderBtn title={track.locked ? "Unlock" : "Lock"} active={track.locked} onClick={() => dispatch({ type: "set_track", trackId: track.id, patch: { locked: !track.locked } })}>
                    {track.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                  </HeaderBtn>
                  <HeaderBtn title={track.enabled ? (track.kind === "audio" ? "Mute" : "Hide") : "Enable"} active={!track.enabled} onClick={() => dispatch({ type: "set_track", trackId: track.id, patch: { enabled: !track.enabled } })}>
                    {track.kind === "audio"
                      ? track.enabled ? <Volume2 size={12} /> : <VolumeX size={12} />
                      : track.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                  </HeaderBtn>
                </div>
              </div>
              {/* lane */}
              <div
                className={cn("relative flex-1", track.kind === "audio" ? "bg-audio/5" : "bg-video/5")}
                style={{ width: laneWidth }}
                onMouseDown={beginScrub}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (track.locked) return;
                  const assetId = e.dataTransfer.getData("application/x-ocean-asset") || e.dataTransfer.getData("text/plain");
                  if (!assetId) return;
                  const asset = project.mediaLibrary.find((a) => a.id === assetId);
                  if (!asset || (track.kind === "audio") !== (asset.kind === "audio")) return;
                  const rect = trackAreaRef.current!.getBoundingClientRect();
                  const at = Math.max(0, secondsToTicks((e.clientX - rect.left - HEADER_W) / zoom));
                  const dur = asset.durationTicks > 0 ? asset.durationTicks : 5 * 600;
                  dispatch({ type: "add_clip", trackId: track.id, assetId, atTicks: freeStartFor(track, at, dur), clipId: nextId("c") });
                }}
              >
                {track.clips.map((clip) => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    bg={clipBg(clip)}
                    pxPerTick={pxPerTick}
                    fps={fps}
                    locked={track.locked}
                    selected={selected.includes(clip.id)}
                    working={working.includes(clip.id)}
                    trackAtY={trackAtY}
                    setHint={setHint}
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

          {/* markers + playhead overlay (over lanes, not the header column) */}
          <div className="pointer-events-none absolute inset-y-0 z-10" style={{ left: HEADER_W, width: laneWidth }}>
            {project.markers.map((m) => (
              <div key={m.id} className="absolute inset-y-0 w-px bg-beat/70" style={{ left: m.atTicks * pxPerTick }} />
            ))}
            <div className="absolute inset-y-0 z-20 w-px bg-playhead" style={{ left: playhead * pxPerTick }} />
          </div>
        </div>
      </div>

      {/* live drag-preview tooltip */}
      {hint && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[140%] rounded-sm bg-popover px-2 py-1 font-mono text-[11px] tabular-nums text-foreground shadow-xl ring-1 ring-border"
          style={{ left: hint.x, top: hint.y }}
        >
          {hint.text}
        </div>
      )}

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

function HeaderBtn({ children, active, title, onClick }: { children: React.ReactNode; active?: boolean; title: string; onClick?: () => void }) {
  return (
    <button title={title} onClick={onClick} className={cn("grid size-5 place-items-center rounded-sm text-subtle hover:bg-accent hover:text-foreground", active && "text-foreground")}>
      {children}
    </button>
  );
}

function ToolBtn({ children, active, title, onClick }: { children: React.ReactNode; active?: boolean; title: string; onClick?: () => void }) {
  return (
    <button title={title} onClick={onClick} className={cn("grid size-7 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground", active && "bg-accent text-foreground")}>
      {children}
    </button>
  );
}

function ClipView({
  clip, bg, pxPerTick, fps, locked, selected, working, trackAtY, setHint, onSelect, onContext,
}: {
  clip: Clip;
  bg: string;
  pxPerTick: number;
  fps: number;
  locked: boolean;
  selected: boolean;
  working: boolean;
  trackAtY: (clientY: number) => Track | null;
  setHint: (h: Hint) => void;
  onSelect: () => void;
  onContext: (e: React.MouseEvent) => void;
}) {
  // Drag the body to move along the timeline AND vertically to another same-kind
  // lane (move_clip — also an MCP tool). A small threshold distinguishes a click.
  const onBodyDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    if (locked) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origStart = clip.timelineStart;
    let dragging = false;
    const move = (ev: MouseEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
      dragging = true;
      const toTicks = Math.max(0, origStart + Math.round((ev.clientX - startX) / pxPerTick));
      const target = trackAtY(ev.clientY);
      const toTrackId = target && target.kind === clip.kind ? target.id : undefined; // move_clip ignores same-track
      try {
        useStore.getState().dispatch({ type: "move_clip", clipId: clip.id, toTicks, toTrackId }, "ui");
      } catch {
        /* overlap/kind guard */
      }
      setHint({ x: ev.clientX, y: ev.clientY, text: formatTimecodeFrames(toTicks, fps) });
    };
    const up = () => {
      setHint(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const trimEdge = (side: "in" | "out") => (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    if (locked) return;
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
      // preview the resulting clip duration
      const cur = useStore.getState().project.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
      if (cur) setHint({ x: ev.clientX, y: ev.clientY, text: formatTimecodeFrames(cur.timelineEnd - cur.timelineStart, fps) });
    };
    const up = () => {
      setHint(null);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      className={cn(
        "group absolute inset-y-[3px] flex items-center overflow-hidden px-2 text-[11px] font-medium text-white/95",
        bg,
        locked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing",
        selected ? "z-10 ring-2 ring-white" : "ring-1 ring-black/30",
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
      {/* trim handles (media clips, unlocked) */}
      {clip.assetId && !locked && (
        <>
          <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40" onMouseDown={trimEdge("in")} />
          <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40" onMouseDown={trimEdge("out")} />
        </>
      )}
    </div>
  );
}
