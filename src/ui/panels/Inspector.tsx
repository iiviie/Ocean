import { Scissors, Trash2, FlipHorizontal2, FlipVertical2, Film, Music, Image as ImageIcon, Type } from "lucide-react";
import { useStore } from "@/model/store";
import { findClip, projectDurationTicks } from "@/model/selectors";
import { round2, ticksToSeconds, secondsToTicks } from "@/model/time";
import type { BlendMode, FilterPreset, TextAlign, TextProps, Clip } from "@/model/types";
import { Slider } from "@/ui/components/Slider";
import { Button } from "@/ui/components/Button";
import { cn } from "@/ui/lib/cn";

const BLEND_MODES: BlendMode[] = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "add"];
const FILTERS: FilterPreset[] = ["none", "grayscale", "sepia", "invert", "vintage"];
const ALIGNS: TextAlign[] = ["left", "center", "right"];

function clipKind(c: Clip): { label: string; icon: typeof Film } {
  if (c.text) return { label: "Text", icon: Type };
  if (c.kind === "audio") return { label: "Audio", icon: Music };
  if (c.assetId) return { label: "Video", icon: Film };
  return { label: "Clip", icon: ImageIcon };
}

export function Properties() {
  const project = useStore((s) => s.project);
  const selectedIds = useStore((s) => s.editor.selectedClipIds);
  const dispatch = useStore((s) => s.dispatch);
  const sel = selectedIds[0] ? findClip(project, selectedIds[0]) : null;

  if (!sel) return <ProjectInspector />;

  const clip = sel.clip;
  const { label, icon: Icon } = clipKind(clip);
  const isText = !!clip.text;
  const isAudio = clip.kind === "audio";
  const isVisual = !isAudio;
  const hasMedia = !!clip.assetId;
  const setText = (patch: Partial<TextProps>) => dispatch({ type: "set_text", clipId: clip.id, patch });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {/* selection header */}
      <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2.5">
        <div className={cn("grid size-7 flex-none place-items-center rounded-md", isText ? "bg-textclip/20 text-textclip" : isAudio ? "bg-audio/20 text-audio" : "bg-video/20 text-video")}>
          <Icon size={15} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">{clip.label ?? clip.id}</div>
          <div className="text-[11px] tabular-nums text-subtle">
            {round2(ticksToSeconds(clip.timelineStart))}s → {round2(ticksToSeconds(clip.timelineEnd))}s · {label}
          </div>
        </div>
      </div>

      {/* TEXT / TYPOGRAPHY */}
      {isText && clip.text && (
        <Section title="Text">
          <textarea
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/60"
            value={clip.text.content}
            onChange={(e) => setText({ content: e.target.value })}
          />
          <Control label={`Size · ${clip.text.fontSize}px`}>
            <Slider min={12} max={300} step={1} value={clip.text.fontSize} onChange={(v) => setText({ fontSize: v })} />
          </Control>
          <ColorRow label="Color" value={clip.text.color} onChange={(v) => setText({ color: v })} />
          <Control label={`Weight · ${clip.text.fontWeight ?? 800}`}>
            <Slider min={100} max={900} step={100} value={clip.text.fontWeight ?? 800} onChange={(v) => setText({ fontWeight: v })} />
          </Control>
          <Row>
            <SegmentedAlign value={clip.text.align} onChange={(v) => setText({ align: v })} />
            <Toggle active={!!clip.text.italic} onClick={() => setText({ italic: !clip.text!.italic })} title="Italic">
              <span className="font-serif italic">I</span>
            </Toggle>
          </Row>
          <Control label={`Letter spacing · ${clip.text.letterSpacing ?? 0}px`}>
            <Slider min={-10} max={40} step={1} value={clip.text.letterSpacing ?? 0} onChange={(v) => setText({ letterSpacing: v })} />
          </Control>
          <Control label={`Line height · ${round2(clip.text.lineHeight)}`}>
            <Slider min={0.8} max={2.5} step={0.05} value={clip.text.lineHeight} onChange={(v) => setText({ lineHeight: v })} />
          </Control>
          <ColorRow label="Plate" value={clip.text.backgroundColor ?? "#00000000"} onChange={(v) => setText({ backgroundColor: v })} allowClear onClear={() => setText({ backgroundColor: undefined })} />
          <ColorRow label="Outline" value={clip.text.strokeColor ?? "#000000"} onChange={(v) => setText({ strokeColor: v })} />
          <Control label={`Outline width · ${clip.text.strokeWidth ?? 0}px`}>
            <Slider min={0} max={20} step={1} value={clip.text.strokeWidth ?? 0} onChange={(v) => setText({ strokeWidth: v })} />
          </Control>
        </Section>
      )}

      {/* TRANSFORM */}
      {isVisual && (
        <Section title="Transform">
          <Control label="Position X / Y">
            <div className="flex gap-1.5">
              <NumInput value={round2(clip.transform.centerX)} onChange={(v) => dispatch({ type: "set_transform", clipId: clip.id, patch: { centerX: v } })} />
              <NumInput value={round2(clip.transform.centerY)} onChange={(v) => dispatch({ type: "set_transform", clipId: clip.id, patch: { centerY: v } })} />
            </div>
          </Control>
          <Control label={`Scale · ${round2(clip.transform.scale)}×`}>
            <Slider min={0.1} max={4} value={clip.transform.scale} onChange={(v) => dispatch({ type: "set_transform", clipId: clip.id, patch: { scale: v } })} />
          </Control>
          <Control label={`Rotation · ${Math.round(clip.transform.rotation)}°`}>
            <Slider min={-180} max={180} step={1} value={clip.transform.rotation} onChange={(v) => dispatch({ type: "set_transform", clipId: clip.id, patch: { rotation: v } })} />
          </Control>
          <Row>
            <Toggle active={clip.transform.flipH} onClick={() => dispatch({ type: "set_transform", clipId: clip.id, patch: { flipH: !clip.transform.flipH } })} title="Flip horizontal">
              <FlipHorizontal2 size={14} />
            </Toggle>
            <Toggle active={clip.transform.flipV} onClick={() => dispatch({ type: "set_transform", clipId: clip.id, patch: { flipV: !clip.transform.flipV } })} title="Flip vertical">
              <FlipVertical2 size={14} />
            </Toggle>
          </Row>
        </Section>
      )}

      {/* APPEARANCE */}
      {isVisual && (
        <Section title="Appearance">
          <Control label={`Opacity · ${Math.round(clip.opacity * 100)}%`}>
            <Slider min={0} max={1} value={clip.opacity} onChange={(v) => dispatch({ type: "set_opacity", clipId: clip.id, opacity: v })} />
          </Control>
          <FadeControls clip={clip} />
          <Control label="Blend mode">
            <Select value={clip.style?.blendMode ?? "normal"} options={BLEND_MODES} onChange={(v) => dispatch({ type: "set_style", clipId: clip.id, patch: { blendMode: v as BlendMode } })} />
          </Control>
          <Control label={`Corner radius · ${Math.round((clip.style?.cornerRadius ?? 0) * 100)}%`}>
            <Slider min={0} max={1} value={clip.style?.cornerRadius ?? 0} onChange={(v) => dispatch({ type: "set_style", clipId: clip.id, patch: { cornerRadius: v } })} />
          </Control>
          <ColorRow label="Border" value={clip.style?.borderColor ?? "#ffffff"} onChange={(v) => dispatch({ type: "set_style", clipId: clip.id, patch: { borderColor: v } })} />
          <Control label={`Border width · ${clip.style?.borderWidth ?? 0}px`}>
            <Slider min={0} max={40} step={1} value={clip.style?.borderWidth ?? 0} onChange={(v) => dispatch({ type: "set_style", clipId: clip.id, patch: { borderWidth: v } })} />
          </Control>
          <Row between>
            <span className="text-[12px] text-subtle">Drop shadow</span>
            <Toggle active={!!clip.style?.shadow} onClick={() => dispatch({ type: "set_style", clipId: clip.id, patch: { shadow: !clip.style?.shadow } })} title="Drop shadow">
              <span className="text-[10px] font-semibold">{clip.style?.shadow ? "ON" : "OFF"}</span>
            </Toggle>
          </Row>
        </Section>
      )}

      {/* COLOR (video / image) */}
      {isVisual && hasMedia && (
        <Section title="Color">
          <Control label={`Brightness · ${round2(clip.color?.brightness ?? 0)}`}>
            <Slider min={-1} max={1} step={0.01} value={clip.color?.brightness ?? 0} onChange={(v) => dispatch({ type: "set_color", clipId: clip.id, patch: { brightness: v } })} />
          </Control>
          <Control label={`Contrast · ${round2(clip.color?.contrast ?? 0)}`}>
            <Slider min={-1} max={1} step={0.01} value={clip.color?.contrast ?? 0} onChange={(v) => dispatch({ type: "set_color", clipId: clip.id, patch: { contrast: v } })} />
          </Control>
          <Control label={`Saturation · ${round2(clip.color?.saturation ?? 1)}`}>
            <Slider min={0} max={2} step={0.01} value={clip.color?.saturation ?? 1} onChange={(v) => dispatch({ type: "set_color", clipId: clip.id, patch: { saturation: v } })} />
          </Control>
          <Control label={`Hue · ${Math.round(clip.color?.hue ?? 0)}°`}>
            <Slider min={-180} max={180} step={1} value={clip.color?.hue ?? 0} onChange={(v) => dispatch({ type: "set_color", clipId: clip.id, patch: { hue: v } })} />
          </Control>
          <Control label="Look">
            <Select value={clip.color?.filter ?? "none"} options={FILTERS} onChange={(v) => dispatch({ type: "set_color", clipId: clip.id, patch: { filter: v as FilterPreset } })} />
          </Control>
        </Section>
      )}

      {/* AUDIO */}
      {!isText && (
        <Section title="Audio">
          <Control label={`Volume · ${Math.round(clip.volume * 100)}%`}>
            <Slider min={0} max={1} value={clip.volume} onChange={(v) => dispatch({ type: "set_volume", clipId: clip.id, volume: v })} />
          </Control>
          {isAudio && <FadeControls clip={clip} />}
        </Section>
      )}

      {/* SPEED */}
      {hasMedia && (
        <Section title="Speed">
          <Control label={`${round2(clip.speed)}×`}>
            <Slider min={0.25} max={4} step={0.05} value={clip.speed} onChange={(v) => dispatch({ type: "set_speed", clipId: clip.id, speed: v })} />
          </Control>
        </Section>
      )}

      <div className="mt-auto flex gap-1.5 border-t border-border-soft p-3">
        <Button size="sm" variant="secondary" className="flex-1" onClick={() => dispatch({ type: "split_clip", clipId: clip.id, atTicks: useStore.getState().editor.playheadTicks })}>
          <Scissors size={13} /> Split
        </Button>
        <Button size="sm" variant="destructive" className="flex-1" onClick={() => dispatch({ type: "delete_clip", clipId: clip.id, ripple: true })}>
          <Trash2 size={13} /> Delete
        </Button>
      </div>
    </div>
  );
}

/** Fade in/out — one envelope drives visual opacity AND audio volume (set_fade). */
function FadeControls({ clip }: { clip: Clip }) {
  const dispatch = useStore((s) => s.dispatch);
  const inS = round2(ticksToSeconds(clip.opacityFadeIn));
  const outS = round2(ticksToSeconds(clip.opacityFadeOut));
  return (
    <Control label={`Fade in / out · ${inS}s / ${outS}s`}>
      <div className="flex gap-1.5">
        <Slider min={0} max={3} step={0.05} value={inS} onChange={(v) => dispatch({ type: "set_fade", clipId: clip.id, fadeInTicks: secondsToTicks(v) })} />
        <Slider min={0} max={3} step={0.05} value={outS} onChange={(v) => dispatch({ type: "set_fade", clipId: clip.id, fadeOutTicks: secondsToTicks(v) })} />
      </div>
    </Control>
  );
}

function ProjectInspector() {
  const project = useStore((s) => s.project);
  const dispatch = useStore((s) => s.dispatch);
  const { width, height, fps, backgroundColor } = project.canvas;
  const g = gcd(width, height) || 1;
  const durSec = ticksToSeconds(projectDurationTicks(project));
  const durStr = `${Math.floor(durSec / 60)}:${String(Math.floor(durSec % 60)).padStart(2, "0")}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="px-3 py-3 text-[12px] text-subtle">Nothing selected — showing the project.</div>
      <Section title="Project">
        <KeyVal k="Name" v={project.name} />
        <KeyVal k="Tracks" v={project.tracks.length} />
        <KeyVal k="Assets" v={project.mediaLibrary.length} />
        <KeyVal k="Duration" v={durStr} />
      </Section>
      <Section title="Canvas">
        <KeyVal k="Resolution" v={`${width} × ${height}`} />
        <KeyVal k="Aspect" v={`${width / g}:${height / g}`} />
        <Control label="Frame rate">
          <Select value={String(fps)} options={["24", "25", "30", "50", "60"]} onChange={(v) => dispatch({ type: "set_canvas", patch: { fps: Number(v) } })} />
        </Control>
        <ColorRow label="Background" value={backgroundColor} onChange={(v) => dispatch({ type: "set_canvas", patch: { backgroundColor: v } })} />
      </Section>
    </div>
  );
}

// ---- primitives ----
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-soft px-3 py-3">
      <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">{title}</div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] tabular-nums text-subtle">{label}</div>
      {children}
    </div>
  );
}

function Row({ children, between }: { children: React.ReactNode; between?: boolean }) {
  return <div className={cn("flex items-center gap-1.5", between && "justify-between")}>{children}</div>;
}

function KeyVal({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-subtle">{k}</span>
      <span className="truncate text-right text-muted-foreground tabular-nums">{v}</span>
    </div>
  );
}

const numInput = "h-7 w-full rounded-md border border-border bg-muted px-2 text-xs tabular-nums text-foreground outline-none focus:border-primary/60";

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input className={numInput} type="number" step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />;
}

function Select({ value, options, onChange }: { value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-full rounded-md border border-border bg-muted px-2 text-xs capitalize text-foreground outline-none focus:border-primary/60">
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Toggle({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className={cn("grid h-7 min-w-7 place-items-center rounded-md border px-2 text-xs", active ? "border-primary bg-primary/15 text-foreground" : "border-border bg-muted text-subtle hover:text-foreground")}>
      {children}
    </button>
  );
}

function SegmentedAlign({ value, onChange }: { value: TextAlign; onChange: (v: TextAlign) => void }) {
  return (
    <div className="flex flex-1 overflow-hidden rounded-md border border-border">
      {ALIGNS.map((a) => (
        <button key={a} onClick={() => onChange(a)} className={cn("flex-1 py-1 text-[11px] capitalize", value === a ? "bg-primary/20 text-foreground" : "bg-muted text-subtle hover:text-foreground")}>
          {a}
        </button>
      ))}
    </div>
  );
}

function ColorRow({ label, value, onChange, allowClear, onClear }: { label: string; value: string; onChange: (v: string) => void; allowClear?: boolean; onClear?: () => void }) {
  // strip alpha-only sentinel so the native picker shows a sane swatch
  const v = value && value.length >= 7 ? value.slice(0, 7) : "#000000";
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-subtle">{label}</span>
      <div className="flex items-center gap-1.5">
        {allowClear && <button onClick={onClear} className="text-[10px] text-subtle hover:text-foreground">clear</button>}
        <input type="color" className="h-6 w-10 cursor-pointer rounded border border-border bg-muted" value={v} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
