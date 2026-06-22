import { useEffect } from "react";
import { useStore, createEmptyProject } from "@/model/store";
import { createSampleProject } from "@/model/sample";
import { Button } from "@/ui/components/Button";
import { MediaLibrary } from "./panels/MediaLibrary";
import { PreviewCanvas } from "./panels/PreviewCanvas";
import { Timeline } from "./panels/Timeline";
import { Properties } from "./panels/Inspector";
import { AgentChat } from "./panels/AgentChat";

export function Editor() {
  const name = useStore((s) => s.project.name);
  const loadProject = useStore((s) => s.loadProject);

  // Delete / Backspace removes the selected clip(s) — unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const { editor, dispatch } = useStore.getState();
      if (!editor.selectedClipIds.length) return;
      e.preventDefault();
      for (const id of [...editor.selectedClipIds]) {
        try {
          dispatch({ type: "delete_clip", clipId: id, ripple: false });
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* top bar */}
      <header className="flex h-10 flex-none items-center justify-between border-b border-border bg-background px-3">
        <div className="flex items-center gap-1.5">
          <div className="flex h-6 items-center gap-1.5 rounded-md bg-card px-2 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            Ocean
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-foreground">{name}</span>
          <span className="text-subtle">— Edited</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => loadProject(createSampleProject())}>
            Sample
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Start a new empty project? Unsaved changes will be lost.")) {
                const p = createEmptyProject();
                p.name = "Untitled";
                loadProject(p);
              }
            }}
          >
            New
          </Button>
          <Button variant="secondary" size="sm">
            Export
          </Button>
          <div className="grid size-6 place-items-center rounded-full bg-primary text-[11px] font-semibold text-white">O</div>
        </div>
      </header>

      {/* main row */}
      <div className="flex min-h-0 flex-1">
        <AgentChat />
        <MediaLibrary />
        <div className="min-w-0 flex-1 border-x border-border">
          <PreviewCanvas />
        </div>
        <Properties />
      </div>

      {/* timeline */}
      <div className="h-[252px] flex-none border-t border-border">
        <Timeline />
      </div>
    </div>
  );
}
