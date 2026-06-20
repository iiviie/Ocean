import { useRef } from "react";
import { useStore } from "@/model/store";
import { projectDurationTicks } from "@/model/selectors";
import { ticksToSeconds, secondsToTicks } from "@/model/time";
import type { Clip, TrackKind } from "@/model/types";

const TRACK_COLOR: Record<TrackKind, string> = {
  video: "var(--video)",
  text: "var(--text-clip)",
  audio: "var(--audio)",
};

export function Timeline() {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.editor.zoom); // px per second
  const playhead = useStore((s) => s.editor.playheadTicks);
  const selected = useStore((s) => s.editor.selectedClipIds);
  const working = useStore((s) => s.editor.workingClipIds);
  const dispatch = useStore((s) => s.dispatch);
  const laneRef = useRef<HTMLDivElement>(null);

  const durSec = Math.max(12, ticksToSeconds(projectDurationTicks(project)) + 2);
  const laneWidth = durSec * zoom;
  const pxPerTick = zoom / 600;

  const ticks: number[] = [];
  const step = zoom < 20 ? 5 : zoom < 60 ? 2 : 1;
  for (let s = 0; s <= durSec; s += step) ticks.push(s);

  const seekFromEvent = (clientX: number) => {
    const lane = laneRef.current;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const x = clientX - rect.left + lane.scrollLeft;
    dispatch({ type: "set_playhead", atTicks: Math.max(0, secondsToTicks(x / zoom)) });
  };

  return (
    <section className="panel panel-timeline">
      <div className="timeline-toolbar">
        <span style={{ color: "var(--text-2)", fontSize: 11 }}>Timeline</span>
        <button className="ghost" onClick={() => dispatch({ type: "set_zoom", zoom: zoom / 1.4 })}>－</button>
        <button className="ghost" onClick={() => dispatch({ type: "set_zoom", zoom: zoom * 1.4 })}>＋</button>
        <button className="ghost" onClick={() => dispatch({ type: "add_track", kind: "video" })}>+Video</button>
        <button className="ghost" onClick={() => dispatch({ type: "add_track", kind: "text" })}>+Text</button>
        <button className="ghost" onClick={() => dispatch({ type: "add_track", kind: "audio" })}>+Audio</button>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--text-2)", fontSize: 11 }}>{Math.round(zoom)} px/s</span>
      </div>

      <div className="timeline-scroll">
        <div style={{ display: "flex", minWidth: 96 + laneWidth }}>
          <div style={{ width: 96, flex: "0 0 96px" }} />
          <div className="ruler" style={{ width: laneWidth, position: "relative" }}>
            {ticks.map((s) => (
              <div key={s} className="ruler-tick" style={{ left: s * zoom }}>
                {s}s
              </div>
            ))}
          </div>
        </div>

        {/* render top-most track first visually (reverse of z-order) */}
        {[...project.tracks].reverse().map((track) => (
          <div key={track.id} className="track-row">
            <div className="track-head">
              <div className="tname">{track.name}</div>
              <div className="tsub">{track.kind}</div>
            </div>
            <div
              className="track-lane"
              ref={track.id === project.tracks[0]?.id ? laneRef : undefined}
              onMouseDown={(e) => seekFromEvent(e.clientX)}
            >
              {track.clips.map((clip) => (
                <ClipView
                  key={clip.id}
                  clip={clip}
                  color={TRACK_COLOR[track.kind]}
                  pxPerTick={pxPerTick}
                  selected={selected.includes(clip.id)}
                  working={working.includes(clip.id)}
                  onSelect={() => dispatch({ type: "select_clips", clipIds: [clip.id] })}
                />
              ))}
            </div>
          </div>
        ))}

        {/* beat markers + playhead overlay across lanes */}
        <Overlay laneWidth={laneWidth} pxPerTick={pxPerTick} playhead={playhead} />
      </div>
    </section>
  );
}

function ClipView({
  clip,
  color,
  pxPerTick,
  selected,
  working,
  onSelect,
}: {
  clip: Clip;
  color: string;
  pxPerTick: number;
  selected: boolean;
  working: boolean;
  onSelect: () => void;
}) {
  const left = clip.timelineStart * pxPerTick;
  const width = (clip.timelineEnd - clip.timelineStart) * pxPerTick;
  return (
    <div
      className={`clip${selected ? " sel" : ""}${working ? " working" : ""}`}
      style={{ left, width, background: color }}
      onMouseDown={(e) => { e.stopPropagation(); onSelect(); }}
      title={`${clip.label ?? clip.id}`}
    >
      <span className="clabel">{clip.text ? clip.text.content : clip.label ?? clip.id}</span>
    </div>
  );
}

function Overlay({
  laneWidth,
  pxPerTick,
  playhead,
}: {
  laneWidth: number;
  pxPerTick: number;
  playhead: number;
}) {
  const markers = useStore((s) => s.project.markers);
  return (
    <div style={{ position: "absolute", top: 22, left: 96, width: laneWidth, bottom: 0, pointerEvents: "none" }}>
      {markers.map((m) => (
        <div key={m.id} className="beat-marker" style={{ left: m.atTicks * pxPerTick }} />
      ))}
      <div className="playhead" style={{ left: playhead * pxPerTick }} />
    </div>
  );
}
