import { useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign } from "lucide-react";
import { useStore } from "@/model/store";
import { oceanAgent } from "@/agent/bridge";
import { cn } from "@/ui/lib/cn";

// Left column: the agent conversation. Messages stream here and edits the agent
// makes show inline; the input drives the in-process bridge (and mirrors what an
// MCP client like Claude Code does).
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
    <aside className="flex w-[300px] flex-none flex-col bg-card">
      <div ref={logRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {log.length === 0 && (
          <div className="space-y-3 text-[13px] leading-relaxed text-muted-foreground">
            <p className="text-foreground">Tell me what to make.</p>
            <p>I can cut on the beat, place clips, add captions, balance audio — just describe it.</p>
            <p className="text-subtle">Every edit I make appears in the timeline and preview live.</p>
          </div>
        )}
        {log.map((e) => (
          <div key={e.seq} className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">{e.source}</span>
            <div
              className={cn(
                "self-start rounded-xl px-3 py-2 text-[12.5px] leading-snug",
                e.error ? "bg-destructive/10 text-destructive" : e.source === "agent" ? "bg-accent-soft text-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {e.error ? `✗ ${e.error}` : e.diff}
            </div>
          </div>
        ))}
      </div>

      <div className="flex-none p-3">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-muted px-3 py-2 focus-within:border-primary/60">
          <AtSign size={15} className="mb-0.5 text-subtle" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle"
            placeholder="Ask, or type @ to reference media"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(input); }}
          />
          <button
            onClick={() => run(input)}
            className="grid size-6 flex-none place-items-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            disabled={!input.trim()}
            title="Send"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
