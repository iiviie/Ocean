import { useState } from "react";
import { FilePlus2, FolderOpen, Clock, Waves } from "lucide-react";
import { useAppState } from "@/model/appState";
import { openProject, openProjectPath, deriveProjectName } from "@/model/projectFile";
import { inElectron } from "@/engine/render";
import { NewProjectDialog } from "./NewProjectDialog";
import { cn } from "@/ui/lib/cn";

export function Welcome() {
  const recent = useAppState((s) => s.recent);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setError(null);
    const ok = await openProject();
    if (!ok && inElectron) setError("Couldn't open that folder — no project.json inside.");
  };
  const openRecent = async (path: string) => {
    setError(null);
    const ok = await openProjectPath(path);
    if (!ok) setError("That project is missing or moved — removed from recents.");
  };

  return (
    <div className="grid h-full place-items-center bg-background text-foreground">
      <div className="flex w-[560px] flex-col gap-7">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <Waves size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Ocean</h1>
            <p className="text-[13px] text-subtle">AI-native video editor</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ActionCard icon={FilePlus2} title="New Project" subtitle="Pick a canvas size and start fresh" onClick={() => setShowNew(true)} />
          <ActionCard icon={FolderOpen} title="Open Project" subtitle={inElectron ? "Open a project folder" : "Desktop app only"} disabled={!inElectron} onClick={() => void open()} />
        </div>

        {error && <p className="text-[12px] text-destructive">{error}</p>}

        {recent.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle">
              <Clock size={12} /> Recent
            </span>
            <div className="flex flex-col overflow-hidden rounded-lg border border-border">
              {recent.map((path) => (
                <button
                  key={path}
                  onClick={() => void openRecent(path)}
                  className="flex items-center justify-between gap-3 border-b border-border-soft px-3 py-2 text-left last:border-b-0 hover:bg-accent"
                >
                  <span className="truncate text-[13px] text-foreground">{deriveProjectName(path)}</span>
                  <span className="truncate text-[11px] text-subtle">{path}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}

function ActionCard({
  icon: Icon, title, subtitle, onClick, disabled,
}: {
  icon: typeof FilePlus2;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition",
        disabled ? "cursor-not-allowed opacity-40" : "hover:border-primary/60 hover:bg-accent",
      )}
    >
      <Icon size={20} className="text-primary" />
      <span className="text-[14px] font-medium text-foreground">{title}</span>
      <span className="text-[12px] text-subtle">{subtitle}</span>
    </button>
  );
}
