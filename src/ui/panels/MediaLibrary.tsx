import { Film, Image as ImageIcon, Music, Sparkles, Import, AlertTriangle } from "lucide-react";
import { useStore } from "@/model/store";
import type { MediaKind, TrackKind } from "@/model/types";
import { formatTimecodeFrames } from "@/model/time";
import { nextId } from "@/model/ids";
import { importViaDialog } from "@/agent/tools";
import { cn } from "@/ui/lib/cn";

const KIND_ICON: Record<MediaKind, typeof Film> = { video: Film, image: ImageIcon, audio: Music, lottie: Sparkles };

/** Add an asset to a sensible track at the playhead (creating the track if
 *  needed). Same commands the agent's add_clip/add_track tools use. */
function addToTimeline(assetId: string): void {
  const { project, editor, dispatch } = useStore.getState();
  const asset = project.mediaLibrary.find((a) => a.id === assetId);
  if (!asset) return;
  const wantKind: TrackKind = asset.kind === "audio" ? "audio" : "video";
  let trackId = project.tracks.find((t) => t.kind === wantKind)?.id;
  if (!trackId) {
    trackId = nextId("t");
    dispatch({ type: "add_track", kind: wantKind, trackId });
  }
  dispatch({ type: "add_clip", trackId, assetId, atTicks: editor.playheadTicks, clipId: nextId("c") });
}

export function MediaLibrary() {
  const assets = useStore((s) => s.project.mediaLibrary);
  const fps = useStore((s) => s.project.canvas.fps);
  const selected = useStore((s) => s.editor.selectedAssetId);
  const dispatch = useStore((s) => s.dispatch);

  return (
    <aside className="flex w-[232px] flex-none flex-col border-l border-border bg-card">
      <div className="flex flex-none items-center justify-between px-3 py-2.5">
        <button className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => void importViaDialog()}>
          <Import size={13} /> Import media
        </button>
        <span className="text-[11px] text-subtle">{assets.length}</span>
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-auto px-3 pb-3">
        {assets.map((a) => {
          const Icon = a.missing ? AlertTriangle : KIND_ICON[a.kind];
          return (
            <button
              key={a.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-ocean-asset", a.id);
                e.dataTransfer.setData("text/plain", a.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => dispatch({ type: "select_asset", assetId: a.id })}
              onDoubleClick={() => addToTimeline(a.id)}
              className="group flex flex-col gap-1 text-left"
              title={`${a.name} — double-click or drag to add`}
            >
              <div
                className={cn(
                  "relative aspect-video overflow-hidden rounded-md bg-gradient-to-br from-secondary to-muted ring-1 transition",
                  selected === a.id ? "ring-primary" : "ring-border group-hover:ring-accent",
                )}
              >
                <div className="grid h-full place-items-center">
                  <Icon size={20} className={a.missing ? "text-beat" : "text-subtle"} />
                </div>
                {a.durationTicks > 0 && (
                  <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-[9px] tabular-nums text-white/90">
                    {formatTimecodeFrames(a.durationTicks, fps).slice(3)}
                  </span>
                )}
              </div>
              <span className="truncate text-[11px] text-muted-foreground">{a.name}</span>
            </button>
          );
        })}
        {assets.length === 0 && <p className="col-span-2 text-[11px] text-subtle">No media — click Import.</p>}
      </div>
    </aside>
  );
}
