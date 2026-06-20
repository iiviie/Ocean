import { useStore } from "@/model/store";
import { findClip } from "@/model/selectors";
import { round2, ticksToSeconds } from "@/model/time";

export function Inspector() {
  const project = useStore((s) => s.project);
  const selectedIds = useStore((s) => s.editor.selectedClipIds);
  const dispatch = useStore((s) => s.dispatch);

  const sel = selectedIds[0] ? findClip(project, selectedIds[0]) : null;

  return (
    <section className="panel panel-inspector">
      <div className="panel-header">
        <span>Inspector</span>
        {sel && <span style={{ color: "var(--text-2)", textTransform: "none", fontWeight: 400 }}>{sel.clip.id}</span>}
      </div>
      <div className="panel-body">
        {!sel ? (
          <div className="inspector-empty">Select a clip to edit its properties.</div>
        ) : (
          <>
            <div className="field">
              <label>Timing</label>
              <div style={{ color: "var(--text-1)", fontSize: 12 }}>
                {round2(ticksToSeconds(sel.clip.timelineStart))}s → {round2(ticksToSeconds(sel.clip.timelineEnd))}s
                {" "}({round2(ticksToSeconds(sel.clip.timelineEnd - sel.clip.timelineStart))}s)
              </div>
            </div>

            {sel.clip.text && (
              <>
                <div className="field">
                  <label>Text</label>
                  <textarea
                    rows={2}
                    style={{ width: "100%" }}
                    value={sel.clip.text.content}
                    onChange={(e) => dispatch({ type: "set_text", clipId: sel.clip.id, patch: { content: e.target.value } })}
                  />
                </div>
                <div className="field">
                  <label>Font size: {sel.clip.text.fontSize}px</label>
                  <input
                    type="range" min={12} max={300}
                    value={sel.clip.text.fontSize}
                    onChange={(e) => dispatch({ type: "set_text", clipId: sel.clip.id, patch: { fontSize: Number(e.target.value) } })}
                  />
                </div>
                <div className="field">
                  <label>Color</label>
                  <input
                    type="color"
                    value={sel.clip.text.color}
                    onChange={(e) => dispatch({ type: "set_text", clipId: sel.clip.id, patch: { color: e.target.value } })}
                  />
                </div>
              </>
            )}

            <div className="field">
              <label>Position X / Y</label>
              <div className="row">
                <input className="num" type="number" step={0.01} min={0} max={1}
                  value={round2(sel.clip.transform.centerX)}
                  onChange={(e) => dispatch({ type: "set_transform", clipId: sel.clip.id, patch: { centerX: Number(e.target.value) } })} />
                <input className="num" type="number" step={0.01} min={0} max={1}
                  value={round2(sel.clip.transform.centerY)}
                  onChange={(e) => dispatch({ type: "set_transform", clipId: sel.clip.id, patch: { centerY: Number(e.target.value) } })} />
              </div>
            </div>

            <div className="field">
              <label>Scale: {round2(sel.clip.transform.scale)}×</label>
              <input type="range" min={0.1} max={4} step={0.01}
                value={sel.clip.transform.scale}
                onChange={(e) => dispatch({ type: "set_transform", clipId: sel.clip.id, patch: { scale: Number(e.target.value) } })} />
            </div>

            <div className="field">
              <label>Rotation: {Math.round(sel.clip.transform.rotation)}°</label>
              <input type="range" min={-180} max={180} step={1}
                value={sel.clip.transform.rotation}
                onChange={(e) => dispatch({ type: "set_transform", clipId: sel.clip.id, patch: { rotation: Number(e.target.value) } })} />
            </div>

            <div className="field">
              <label>Opacity: {round2(sel.clip.opacity)}</label>
              <input type="range" min={0} max={1} step={0.01}
                value={sel.clip.opacity}
                onChange={(e) => dispatch({ type: "set_opacity", clipId: sel.clip.id, opacity: Number(e.target.value) })} />
            </div>

            {sel.track.kind !== "text" && (
              <div className="field">
                <label>Volume: {round2(sel.clip.volume)}</label>
                <input type="range" min={0} max={1} step={0.01}
                  value={sel.clip.volume}
                  onChange={(e) => dispatch({ type: "set_volume", clipId: sel.clip.id, volume: Number(e.target.value) })} />
              </div>
            )}

            <div className="field">
              <div className="row">
                <button onClick={() => dispatch({ type: "split_clip", clipId: sel.clip.id, atTicks: useStore.getState().editor.playheadTicks })}>
                  Split at playhead
                </button>
                <button onClick={() => dispatch({ type: "delete_clip", clipId: sel.clip.id, ripple: true })}>
                  Ripple delete
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
