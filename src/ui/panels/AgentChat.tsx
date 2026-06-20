import { useEffect, useRef, useState } from "react";
import { useStore } from "@/model/store";
import { oceanAgent } from "@/agent/bridge";

// The agent panel shows the live command log (so the human SEES every edit the
// agent makes) and offers a tiny console to drive the same bridge the MCP server
// will use. This is a placeholder for the real chat-with-Claude UI; the point is
// to demonstrate the shared command bus end to end.
export function AgentChat() {
  const log = useStore((s) => s.log);
  const [input, setInput] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log.length]);

  const run = (expr: string) => {
    const trimmed = expr.trim();
    if (!trimmed) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const fn = new Function("ocean", `return (${trimmed});`);
      const out = fn(oceanAgent);
      if (out !== undefined) console.info("[ocean]", out);
    } catch (e) {
      console.error("[ocean]", e);
    }
    setInput("");
  };

  return (
    <section className="panel panel-inspector" style={{ borderTop: "1px solid var(--line-soft)" }}>
      <div className="panel-header">
        <span>Agent</span>
        <span style={{ color: "var(--text-2)", textTransform: "none", fontWeight: 400 }}>command log</span>
      </div>
      <div className="agent" style={{ minHeight: 0 }}>
        <div className="agent-log" ref={logRef}>
          {log.length === 0 && (
            <div style={{ color: "var(--text-2)", fontSize: 11 }}>
              Edits appear here. Try a starter below, or open devtools and call <code>ocean.get_project()</code>.
            </div>
          )}
          {log.map((e) => (
            <div key={e.seq} className={`agent-line${e.source === "agent" ? " agent-src" : ""}${e.error ? " err" : ""}`}>
              <span className="src">{e.source}</span> {e.error ? `✗ ${e.error}` : e.diff}
            </div>
          ))}
        </div>

        <div className="starters">
          <button onClick={() => oceanAgent.dispatch({ type: "add_marker", atTicks: useStore.getState().editor.playheadTicks, kind: "beat" })}>
            Add beat @playhead
          </button>
          <button onClick={() => {
            // demo: move the title to the lower third + recolor (agent-style edit)
            oceanAgent.dispatch({ type: "set_transform", clipId: "c3", patch: { centerY: 0.85 } });
            oceanAgent.dispatch({ type: "set_text", clipId: "c3", patch: { color: "#ffd23a" } });
          }}>
            Demo: restyle title
          </button>
          <button onClick={() => oceanAgent.dispatch({ type: "set_working", clipIds: ["c1", "c2"] })}>
            Flag working
          </button>
          <button onClick={() => oceanAgent.dispatch({ type: "set_working", clipIds: [] })}>
            Clear working
          </button>
        </div>

        <div className="agent-input">
          <input
            placeholder='ocean.dispatch({ type: "set_zoom", zoom: 80 })'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(input); }}
          />
          <button className="primary" onClick={() => run(input)}>Run</button>
        </div>
      </div>
    </section>
  );
}
