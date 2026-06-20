import { useStore } from "@/model/store";
import type { MediaKind } from "@/model/types";
import { round2, ticksToSeconds } from "@/model/time";
import { importViaDialog } from "@/agent/tools";

const KIND_ICON: Record<MediaKind, string> = {
  video: "🎬",
  image: "🖼️",
  audio: "🎵",
  lottie: "✨",
};

const KIND_COLOR: Record<MediaKind, string> = {
  video: "var(--video)",
  image: "#8a8f9e",
  audio: "var(--audio)",
  lottie: "var(--text-clip)",
};

export function MediaLibrary() {
  const assets = useStore((s) => s.project.mediaLibrary);
  const selected = useStore((s) => s.editor.selectedAssetId);
  const dispatch = useStore((s) => s.dispatch);

  return (
    <section className="panel panel-media">
      <div className="panel-header">
        <span>Media</span>
        <button className="ghost" title="Import media (file picker → FFmpeg probe)" onClick={() => void importViaDialog()}>＋</button>
      </div>
      <div className="panel-body">
        <div className="media-grid">
          {assets.map((a) => (
            <div
              key={a.id}
              className={`media-tile${selected === a.id ? " sel" : ""}`}
              draggable
              onClick={() => dispatch({ type: "select_asset", assetId: a.id })}
            >
              <div className="media-thumb">{a.missing ? "⚠️" : KIND_ICON[a.kind]}</div>
              <div className="media-meta">
                <div className="name" title={a.name}>{a.name}</div>
                <div className="sub">
                  <span className="kind-pill" style={{ background: KIND_COLOR[a.kind], color: "#0b0c10" }}>
                    {a.kind}
                  </span>{" "}
                  {a.durationTicks > 0 ? `${round2(ticksToSeconds(a.durationTicks))}s` : "still"}
                </div>
              </div>
            </div>
          ))}
          {assets.length === 0 && (
            <div style={{ color: "var(--text-2)", padding: 8, gridColumn: "1 / -1" }}>
              No media yet. Import will probe via FFmpeg in the core.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
