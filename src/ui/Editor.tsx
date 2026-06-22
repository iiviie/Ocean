import { useEffect, useRef, useState } from "react";
import { ChevronDown, FilePlus2, FolderOpen, Save, XCircle, Download, PanelLeft, Check } from "lucide-react";
import { useStore } from "@/model/store";
import { useAppState } from "@/model/appState";
import { usePanels, type PanelId } from "@/ui/layout/panels";
import { openProject, saveProject, closeProject } from "@/model/projectFile";
import { inElectron } from "@/engine/render";
import { Button } from "@/ui/components/Button";
import { SidePanel } from "@/ui/layout/SidePanel";
import { MediaLibrary } from "./panels/MediaLibrary";
import { PreviewCanvas } from "./panels/PreviewCanvas";
import { Timeline } from "./panels/Timeline";
import { Properties } from "./panels/Inspector";
import { AgentChat } from "./panels/AgentChat";
import { Welcome } from "./panels/Welcome";
import { NewProjectDialog } from "./panels/NewProjectDialog";
import { ExportDialog } from "./panels/ExportDialog";
import { cn } from "@/ui/lib/cn";

export function Editor() {
  const view = useAppState((s) => s.view);
  if (view === "welcome") return <Welcome />;
  return <EditorShell />;
}

function EditorShell() {
  const name = useStore((s) => s.project.name);
  const canvas = useStore((s) => s.project.canvas);
  const status = useAppState((s) => s.status);
  const projectPath = useAppState((s) => s.projectPath);
  const open = usePanels((s) => s.open);
  const [showNew, setShowNew] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Delete / Backspace removes selected clip(s); ⌘/Ctrl-S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject();
        return;
      }
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
      <header className="flex h-10 flex-none items-center justify-between border-b border-border bg-background px-2">
        <div className="flex items-center gap-1">
          <ProjectMenu onNew={() => setShowNew(true)} />
          <ViewMenu />
        </div>

        <div className="flex items-center gap-2.5 text-sm">
          <span className="font-medium text-foreground">{name}</span>
          <span className="text-[11px] tabular-nums text-subtle">{canvas.width}×{canvas.height} · {canvas.fps}fps</span>
          <StatusDot status={status} hasPath={!!projectPath} />
        </div>

        <Button variant="secondary" size="sm" onClick={() => setShowExport(true)}>
          <Download size={13} /> Export
        </Button>
      </header>

      {/* main row */}
      <div className="flex min-h-0 flex-1">
        {open.chat && <SidePanel id="chat" side="left" title="Assistant"><AgentChat /></SidePanel>}
        {open.media && <SidePanel id="media" side="left" title="Media"><MediaLibrary /></SidePanel>}
        <div className="min-w-0 flex-1">
          <PreviewCanvas />
        </div>
        {open.inspector && <SidePanel id="inspector" side="right" title="Inspector"><Properties /></SidePanel>}
      </div>

      {/* timeline */}
      <div className="h-[252px] flex-none border-t border-border">
        <Timeline />
      </div>

      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  );
}

/** Small dropdown used by the Project and View menus. */
function Menu({ trigger, children }: { trigger: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
        {trigger}
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-50 min-w-48 overflow-hidden rounded-md border border-border bg-popover py-1 text-[12px] shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function ProjectMenu({ onNew }: { onNew: () => void }) {
  return (
    <Menu trigger={<>Project <ChevronDown size={12} /></>}>
      {(close) => (
        <>
          <MenuItem icon={FilePlus2} label="New Project…" onClick={() => { close(); onNew(); }} />
          <MenuItem icon={FolderOpen} label="Open Project…" disabled={!inElectron} onClick={() => { close(); void openProject(); }} />
          <div className="my-1 h-px bg-border-soft" />
          <MenuItem icon={Save} label="Save" shortcut="⌘S" onClick={() => { close(); void saveProject(); }} />
          <MenuItem icon={XCircle} label="Close Project" onClick={() => { close(); void closeProject(); }} />
        </>
      )}
    </Menu>
  );
}

const PANEL_LABELS: { id: PanelId; label: string }[] = [
  { id: "chat", label: "Assistant" },
  { id: "media", label: "Media" },
  { id: "inspector", label: "Inspector" },
];

function ViewMenu() {
  const open = usePanels((s) => s.open);
  const toggle = usePanels((s) => s.toggle);
  return (
    <Menu trigger={<><PanelLeft size={13} /> View <ChevronDown size={12} /></>}>
      {() => (
        <>
          <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">Panels</div>
          {PANEL_LABELS.map(({ id, label }) => (
            <button key={id} onClick={() => toggle(id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-accent">
              <span className="grid size-3.5 place-items-center">{open[id] && <Check size={13} className="text-primary" />}</span>
              <span className="flex-1">{label}</span>
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}

function MenuItem({ icon: Icon, label, shortcut, onClick, disabled }: { icon: typeof Save; label: string; shortcut?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground", disabled ? "cursor-not-allowed opacity-40" : "hover:bg-accent")}>
      <Icon size={13} className="text-subtle" />
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[10px] text-subtle">{shortcut}</span>}
    </button>
  );
}

function StatusDot({ status, hasPath }: { status: string; hasPath: boolean }) {
  if (!hasPath) return <span className="text-[11px] text-subtle">scratch</span>;
  const map: Record<string, { text: string; cls: string }> = {
    saved: { text: "Saved", cls: "text-subtle" },
    saving: { text: "Saving…", cls: "text-muted-foreground" },
    dirty: { text: "Unsaved", cls: "text-beat" },
    error: { text: "Save failed", cls: "text-destructive" },
  };
  const s = map[status] ?? map.saved;
  return (
    <span className={cn("flex items-center gap-1 text-[11px]", s.cls)}>
      <span className={cn("size-1.5 rounded-full", status === "dirty" ? "bg-beat" : status === "error" ? "bg-destructive" : "bg-audio")} />
      {s.text}
    </span>
  );
}
