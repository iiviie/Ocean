import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack } from "lucide-react";
import { useStore } from "@/model/store";
import { clipsAt, projectDurationTicks } from "@/model/selectors";
import { formatTimecodeFrames, ticksToSeconds } from "@/model/time";
import { fadeGain } from "@/model/fades";
import type { Clip, ColorAdjust, MediaAsset } from "@/model/types";
import { mediaUrl, inElectron } from "@/engine/render";
import { useAudioPlayback } from "@/engine/audio";
import { Button } from "@/ui/components/Button";

const gcdv = (a: number, b: number): number => (b === 0 ? a : gcdv(b, a % b));

// Named filter "looks" → CSS filter fragments.
const FILTER_PRESETS: Record<string, string> = {
  grayscale: "grayscale(1)",
  sepia: "sepia(0.8)",
  invert: "invert(1)",
  vintage: "sepia(0.35) contrast(1.1) brightness(1.05) saturate(1.25)",
};

/** Build a CSS `filter` string from a clip's color correction (video/image). */
function colorFilter(c?: ColorAdjust): string | undefined {
  if (!c) return undefined;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const parts: string[] = [];
  if (c.brightness != null) parts.push(`brightness(${(1 + clamp(c.brightness, -1, 1)).toFixed(3)})`);
  if (c.contrast != null) parts.push(`contrast(${(1 + clamp(c.contrast, -1, 1)).toFixed(3)})`);
  if (c.saturation != null) parts.push(`saturate(${clamp(c.saturation, 0, 2).toFixed(3)})`);
  if (c.hue != null) parts.push(`hue-rotate(${Math.round(c.hue)}deg)`);
  if (c.filter && c.filter !== "none" && FILTER_PRESETS[c.filter]) parts.push(FILTER_PRESETS[c.filter]);
  return parts.length ? parts.join(" ") : undefined;
}

// Smooth preview: native <video>/<img> + text composited in the renderer with
// GPU-accelerated CSS transforms. The browser decodes video natively, so
// playback is real-time with no per-frame IPC.
export function PreviewCanvas() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.editor.playheadTicks);
  const playing = useStore((s) => s.editor.playing);
  const dispatch = useStore((s) => s.dispatch);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const { width: cw, height: ch } = project.canvas;

  useAudioPlayback();

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const aw = el.clientWidth - 32;
      const ah = el.clientHeight - 32;
      const scale = Math.min(aw / cw, ah / ch);
      setStage({ w: Math.max(0, cw * scale), h: Math.max(0, ch * scale) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cw, ch]);

  // Playback clock: advance the playhead in real time; stop at the end.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const { editor, project: p, tickPlayhead, dispatch: d } = useStore.getState();
      const end = projectDurationTicks(p);
      const next = editor.playheadTicks + Math.round(dt * 600);
      if (end > 0 && next >= end) {
        tickPlayhead(end);
        d({ type: "set_playing", playing: false }, "system");
        return;
      }
      tickPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const visible = clipsAt(project, playhead).filter((v) => v.track.kind !== "audio");

  return (
    <section className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex h-9 flex-none items-center justify-between border-b border-border-soft px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Preview</span>
        <span className="text-[11px] text-subtle">
          {cw}×{ch} · {project.canvas.fps}fps {inElectron ? "" : "· web (no media)"}
        </span>
      </header>

      <div ref={wrapRef} className="flex min-h-0 flex-1 items-center justify-center bg-background p-4">
        <div
          className="relative overflow-hidden shadow-2xl ring-1 ring-black/40"
          style={{ width: stage.w, height: stage.h, background: project.canvas.backgroundColor }}
        >
          {visible.map(({ clip }) => (
            <PreviewObject key={clip.id} clip={clip} stageW={stage.w} stageH={stage.h} canvasW={cw} />
          ))}
          {/* safe-area guide */}
          <div className="pointer-events-none absolute inset-[5%] border border-dashed border-white/15" />
        </div>
      </div>

      <div className="flex h-12 flex-none items-center gap-3 border-t border-border-soft px-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => dispatch({ type: "set_playhead", atTicks: 0 })}>
            <SkipBack size={15} />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => dispatch({ type: "set_playing", playing: !playing })}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </Button>
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatTimecodeFrames(playhead, project.canvas.fps)}
          <span className="text-subtle"> / {formatTimecodeFrames(projectDurationTicks(project), project.canvas.fps)}</span>
        </span>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-subtle">
          {[`${cw / (gcdv(cw, ch) || 1)}:${ch / (gcdv(cw, ch) || 1)}`, `${project.canvas.fps}`, "Fit"].map((chip) => (
            <span key={chip} className="rounded border border-border bg-muted px-1.5 py-0.5">
              {chip}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function PreviewObject({ clip, stageW, stageH, canvasW }: { clip: Clip; stageW: number; stageH: number; canvasW: number }) {
  const asset = useStore((s) => s.project.mediaLibrary.find((a) => a.id === clip.assetId));
  const playhead = useStore((s) => s.editor.playheadTicks);
  const tr = clip.transform;

  // fade envelope → opacity for visual clips
  const op = clip.opacity * fadeGain(playhead, clip.timelineStart, clip.timelineEnd, clip.opacityFadeIn, clip.opacityFadeOut);

  const flip = `scaleX(${tr.flipH ? -1 : 1}) scaleY(${tr.flipV ? -1 : 1})`;
  const base = {
    position: "absolute" as const,
    left: `${tr.centerX * 100}%`,
    top: `${tr.centerY * 100}%`,
    transform: `translate(-50%, -50%) rotate(${tr.rotation}deg) ${flip}`,
    opacity: op,
  };

  if (clip.text) {
    const t = clip.text;
    const px = stageW / canvasW * tr.scale; // canvas-px → stage-px for text metrics
    return (
      <div
        style={{
          ...base,
          color: t.color,
          fontFamily: t.fontName,
          fontSize: t.fontSize * px,
          lineHeight: t.lineHeight,
          textAlign: t.align,
          fontWeight: t.fontWeight ?? 800,
          fontStyle: t.italic ? "italic" : "normal",
          letterSpacing: t.letterSpacing != null ? t.letterSpacing * px : undefined,
          backgroundColor: t.backgroundColor,
          padding: t.backgroundColor ? `${0.12 * t.fontSize * px}px ${0.3 * t.fontSize * px}px` : undefined,
          WebkitTextStroke: t.strokeWidth ? `${t.strokeWidth * px}px ${t.strokeColor ?? "#000"}` : undefined,
          whiteSpace: "pre",
          textShadow: "0 2px 14px rgba(0,0,0,.55)",
        }}
      >
        {t.content}
      </div>
    );
  }

  if (!asset) return null;
  const natW = asset.naturalWidth || canvasW;
  const natH = asset.naturalHeight || stageH;
  const fit = Math.min(stageW / natW, stageH / natH);
  const w = natW * fit * tr.scale;
  const h = natH * fit * tr.scale;

  const filter = colorFilter(clip.color);
  const st = clip.style;
  const blend = st?.blendMode && st.blendMode !== "normal" ? (st.blendMode === "add" ? "plus-lighter" : st.blendMode) : undefined;
  const appearance: React.CSSProperties = st
    ? {
        mixBlendMode: blend as React.CSSProperties["mixBlendMode"],
        borderRadius: st.cornerRadius ? `${Math.max(0, Math.min(1, st.cornerRadius)) * 50}%` : undefined,
        border: st.borderWidth ? `${st.borderWidth * (stageW / canvasW)}px solid ${st.borderColor ?? "#fff"}` : undefined,
        boxShadow: st.shadow ? "0 8px 30px rgba(0,0,0,0.5)" : undefined,
      }
    : {};
  const mediaStyle = { ...base, width: w, height: h, objectFit: "cover" as const, filter, ...appearance };
  if (asset.kind === "image") {
    return <img src={mediaUrl(asset.uri)} alt="" style={mediaStyle} draggable={false} />;
  }
  return <PreviewVideo clip={clip} asset={asset} style={mediaStyle} />;
}

function PreviewVideo({ clip, asset, style }: { clip: Clip; asset: MediaAsset; style: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  const playing = useStore((s) => s.editor.playing);
  const playhead = useStore((s) => s.editor.playheadTicks);

  // Keep the <video> synced to the playhead. While playing it runs on its own
  // clock (browser decode) and we only correct drift; while paused we seek.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const desired = ticksToSeconds(clip.sourceIn + Math.round((playhead - clip.timelineStart) * clip.speed));
    v.playbackRate = clip.speed || 1;
    // When the clip's audio is split onto a linked audio clip, that clip plays
    // the sound — mute the video element to avoid double-play.
    v.muted = !!clip.linkedClipId;
    // A video clip playing its own sound honors the same fade envelope as audio clips.
    v.volume = Math.max(0, Math.min(1, clip.volume * fadeGain(playhead, clip.timelineStart, clip.timelineEnd, clip.opacityFadeIn, clip.opacityFadeOut)));
    if (playing) {
      if (Math.abs(v.currentTime - desired) > 0.25) v.currentTime = desired;
      if (v.paused) void v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - desired) > 0.04) v.currentTime = desired;
    }
  }, [playing, playhead, clip.sourceIn, clip.timelineStart, clip.speed, clip.volume]);

  return <video ref={ref} src={mediaUrl(asset.uri)} style={style} muted={!!clip.linkedClipId} playsInline preload="auto" />;
}
