import { Scissors, Trash2 } from "lucide-react";
import { useStore } from "@/model/store";
import { findClip, projectDurationTicks } from "@/model/selectors";
import { round2, ticksToSeconds } from "@/model/time";
import { Slider } from "@/ui/components/Slider";
import { Button } from "@/ui/components/Button";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-soft px-3 py-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-subtle">{label}</span>
      <span className="truncate text-right text-muted-foreground">{value}</span>
    </div>
  );
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const numInput = "h-7 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary/60";

export function Properties() {
  const project = useStore((s) => s.project);
  const selectedIds = useStore((s) => s.editor.selectedClipIds);
  const dispatch = useStore((s) => s.dispatch);
  const sel = selectedIds[0] ? findClip(project, selectedIds[0]) : null;

  const { width, height, fps } = project.canvas;
  const g = gcd(width, height) || 1;
  const durSec = ticksToSeconds(projectDurationTicks(project));
  const durStr = `${Math.floor(durSec / 60)}:${String(Math.floor(durSec % 60)).padStart(2, "0")}`;

  return (
    <aside className="flex w-[236px] flex-none flex-col bg-card">
      <header className="flex h-9 flex-none items-center border-b border-border-soft px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Timeline</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <Section title="Project">
          <Row label="Name" value={project.name} />
          <Row label="Tracks" value={project.tracks.length} />
          <Row label="Assets" value={project.mediaLibrary.length} />
        </Section>
        <Section title="Format">
          <Row label="Resolution" value={`${width} × ${height}`} />
          <Row label="Frame Rate" value={`${fps} fps`} />
          <Row label="Aspect Ratio" value={`${width / g}:${height / g}`} />
          <Row label="Duration" value={durStr} />
        </Section>

        {sel && (
          <>
            <Section title={`Clip · ${sel.clip.id}`}>
              <Row
                label="Range"
                value={`${round2(ticksToSeconds(sel.clip.timelineStart))}s → ${round2(ticksToSeconds(sel.clip.timelineEnd))}s`}
              />
            </Section>

            {sel.clip.text && (
              <div className="space-y-3 border-b border-border-soft px-3 py-3">
                <textarea
                  rows={2}
                  className="w-full resize-none rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/60"
                  value={sel.clip.text.content}
                  onChange={(e) => dispatch({ type: "set_text", clipId: sel.clip.id, patch: { content: e.target.value } })}
                />
                <Control label={`Font size · ${sel.clip.text.fontSize}px`}>
                  <Slider min={12} max={300} step={1} value={sel.clip.text.fontSize} onChange={(v) => dispatch({ type: "set_text", clipId: sel.clip.id, patch: { fontSize: v } })} />
                </Control>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-subtle">Color</span>
                  <input type="color" className="h-6 w-10 cursor-pointer rounded border border-border bg-muted" value={sel.clip.text.color} onChange={(e) => dispatch({ type: "set_text", clipId: sel.clip.id, patch: { color: e.target.value } })} />
                </div>
              </div>
            )}

            <div className="space-y-3 border-b border-border-soft px-3 py-3">
              <Control label="Position X / Y">
                <div className="flex gap-1.5">
                  <input className={numInput} type="number" step={0.01} value={round2(sel.clip.transform.centerX)} onChange={(e) => dispatch({ type: "set_transform", clipId: sel.clip.id, patch: { centerX: Number(e.target.value) } })} />
                  <input className={numInput} type="number" step={0.01} value={round2(sel.clip.transform.centerY)} onChange={(e) => dispatch({ type: "set_transform", clipId: sel.clip.id, patch: { centerY: Number(e.target.value) } })} />
                </div>
              </Control>
              <Control label={`Scale · ${round2(sel.clip.transform.scale)}×`}>
                <Slider min={0.1} max={4} value={sel.clip.transform.scale} onChange={(v) => dispatch({ type: "set_transform", clipId: sel.clip.id, patch: { scale: v } })} />
              </Control>
              <Control label={`Rotation · ${Math.round(sel.clip.transform.rotation)}°`}>
                <Slider min={-180} max={180} step={1} value={sel.clip.transform.rotation} onChange={(v) => dispatch({ type: "set_transform", clipId: sel.clip.id, patch: { rotation: v } })} />
              </Control>
              <Control label={`Opacity · ${round2(sel.clip.opacity)}`}>
                <Slider min={0} max={1} value={sel.clip.opacity} onChange={(v) => dispatch({ type: "set_opacity", clipId: sel.clip.id, opacity: v })} />
              </Control>
              {!sel.clip.text && (
                <Control label={`Volume · ${round2(sel.clip.volume)}`}>
                  <Slider min={0} max={1} value={sel.clip.volume} onChange={(v) => dispatch({ type: "set_volume", clipId: sel.clip.id, volume: v })} />
                </Control>
              )}
            </div>

            <div className="flex gap-1.5 p-3">
              <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "split_clip", clipId: sel.clip.id, atTicks: useStore.getState().editor.playheadTicks })}>
                <Scissors size={13} /> Split
              </Button>
              <Button size="sm" variant="destructive" onClick={() => dispatch({ type: "delete_clip", clipId: sel.clip.id, ripple: true })}>
                <Trash2 size={13} /> Delete
              </Button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] text-subtle">{label}</div>
      {children}
    </div>
  );
}
