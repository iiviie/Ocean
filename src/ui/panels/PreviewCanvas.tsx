import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@/model/store";
import { clipsAt, projectDurationTicks } from "@/model/selectors";
import { formatTimecode } from "@/model/time";
import type { Clip } from "@/model/types";
import { inTauri, useRenderedFrame } from "@/engine/render";
import { useAudioPlayback } from "@/engine/audio";

// A lightweight DOM compositor for preview. It renders whatever the document
// says is visible at the playhead, so any AI edit (transform, text, opacity)
// is immediately visible. The real WebGL/WebGPU + FFmpeg path lands later and
// must match this layout per the render contract (PRD §6.4).
export function PreviewCanvas() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.editor.playheadTicks);
  const playing = useStore((s) => s.editor.playing);
  const dispatch = useStore((s) => s.dispatch);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const { width: cw, height: ch } = project.canvas;

  // fit the canvas into the available area
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const aw = el.clientWidth - 28;
      const ah = el.clientHeight - 28;
      const scale = Math.min(aw / cw, ah / ch);
      setStage({ w: Math.max(0, cw * scale), h: Math.max(0, ch * scale) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cw, ch]);

  // Playback clock. Reads the LATEST playhead from the store each frame (no stale
  // closure) and advances by real elapsed time. Uses tickPlayhead so it doesn't
  // flood the command log at 60fps. Stops at the end of the project.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const { editor, project: p, tickPlayhead, dispatch } = useStore.getState();
      const end = projectDurationTicks(p);
      const next = editor.playheadTicks + Math.round(dt * 600);
      if (end > 0 && next >= end) {
        tickPlayhead(end);
        dispatch({ type: "set_playing", playing: false }, "system");
        return;
      }
      tickPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const visible = clipsAt(project, playhead).filter((v) => v.track.kind !== "audio");
  const { src, loading, error } = useRenderedFrame();
  useAudioPlayback();

  return (
    <section className="panel panel-preview">
      <div className="panel-header">
        <span>Preview</span>
        <span style={{ color: "var(--text-2)", textTransform: "none", fontWeight: 400 }}>
          {cw}×{ch} · {project.canvas.fps}fps
          {inTauri ? (loading ? " · rendering…" : " · engine") : " · preview (web)"}
        </span>
      </div>
      <div className="preview-wrap" ref={wrapRef}>
        <div
          className="preview-stage"
          style={{ width: stage.w, height: stage.h, background: project.canvas.backgroundColor }}
        >
          {inTauri ? (
            // Real native-rendered frame from the Rust compositor.
            <>
              {src && (
                <img
                  src={src}
                  alt="frame"
                  style={{ width: "100%", height: "100%", display: "block", opacity: loading ? 0.6 : 1, transition: "opacity .12s" }}
                />
              )}
              {!src && !error && <div style={{ color: "var(--text-2)", margin: "auto" }}>rendering…</div>}
              {error && <div style={{ color: "var(--danger)", margin: "auto", padding: 12, fontSize: 11 }}>{error}</div>}
            </>
          ) : (
            // Browser fallback: lightweight DOM compositor.
            visible.map(({ clip }) => (
              <PreviewObject key={clip.id} clip={clip} stageW={stage.w} stageH={stage.h} canvasW={cw} />
            ))
          )}
          <div className="preview-safe" />
        </div>
      </div>
      <div className="transport">
        <button className="ghost" onClick={() => dispatch({ type: "set_playhead", atTicks: 0 })}>⏮</button>
        <button className="primary" onClick={() => dispatch({ type: "set_playing", playing: !playing })}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <span className="timecode">{formatTimecode(playhead)}</span>
      </div>
    </section>
  );
}

function PreviewObject({
  clip,
  stageW,
  stageH,
  canvasW,
}: {
  clip: Clip;
  stageW: number;
  stageH: number;
  canvasW: number;
}) {
  const asset = useStore((s) => s.project.mediaLibrary.find((a) => a.id === clip.assetId));
  const playhead = useStore((s) => s.editor.playheadTicks);
  const tr = clip.transform;

  // fade computation
  const into = playhead - clip.timelineStart;
  const toEnd = clip.timelineEnd - playhead;
  let op = clip.opacity;
  if (clip.opacityFadeIn > 0 && into < clip.opacityFadeIn) op *= Math.max(0, into / clip.opacityFadeIn);
  if (clip.opacityFadeOut > 0 && toEnd < clip.opacityFadeOut) op *= Math.max(0, toEnd / clip.opacityFadeOut);

  const scaleToStage = stageW / canvasW;
  const transform = `translate(-50%, -50%) rotate(${tr.rotation}deg) scaleX(${tr.flipH ? -1 : 1}) scaleY(${tr.flipV ? -1 : 1})`;

  if (clip.text) {
    return (
      <div
        className="preview-obj"
        style={{
          left: `${tr.centerX * 100}%`,
          top: `${tr.centerY * 100}%`,
          transform,
          opacity: op,
          color: clip.text.color,
          fontFamily: clip.text.fontName,
          fontSize: clip.text.fontSize * scaleToStage * tr.scale,
          lineHeight: clip.text.lineHeight,
          textAlign: clip.text.align,
          fontWeight: 800,
          whiteSpace: "pre",
          textShadow: "0 2px 12px rgba(0,0,0,.5)",
        }}
      >
        {clip.text.content}
      </div>
    );
  }

  // media object — placeholder fill (real decode renders frames later)
  const natW = asset?.naturalWidth ?? canvasW;
  const natH = asset?.naturalHeight ?? stageH;
  const fit = Math.min(stageW / natW, stageH / natH);
  const w = natW * fit * tr.scale;
  const h = natH * fit * tr.scale;
  const hue = (clip.id.charCodeAt(clip.id.length - 1) * 47) % 360;

  return (
    <div
      className="preview-obj"
      style={{
        left: `${tr.centerX * 100}%`,
        top: `${tr.centerY * 100}%`,
        width: w,
        height: h,
        transform,
        opacity: op,
        background: `linear-gradient(135deg, hsl(${hue} 45% 28%), hsl(${(hue + 40) % 360} 45% 18%))`,
        color: "rgba(255,255,255,.7)",
        fontSize: 12,
      }}
    >
      {asset?.name ?? clip.id}
    </div>
  );
}
