import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Modal } from "@/ui/components/Modal";
import { Button } from "@/ui/components/Button";
import { useStore } from "@/model/store";
import { projectDurationTicks } from "@/model/selectors";
import { ticksToSeconds, round2 } from "@/model/time";
import { inElectron, exportPick, exportVideo, onExportProgress } from "@/engine/render";
import { cn } from "@/ui/lib/cn";

type Phase = "config" | "running" | "done" | "error";

const even = (n: number) => { const v = Math.max(2, Math.round(n)); return v % 2 ? v + 1 : v; };

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const canvas = project.canvas;

  // Resolution presets scale the canvas (aspect preserved, even dims).
  const resOptions = useMemo(() => {
    const mk = (label: string, f: number) => ({ label, width: even(canvas.width * f), height: even(canvas.height * f) });
    return [mk("Full", 1), mk("75%", 0.75), mk("50%", 0.5)];
  }, [canvas.width, canvas.height]);
  const fpsOptions = useMemo(() => Array.from(new Set([canvas.fps, 24, 30, 60])).sort((a, b) => a - b), [canvas.fps]);

  const [resIdx, setResIdx] = useState(0);
  const [fps, setFps] = useState(canvas.fps);
  const [phase, setPhase] = useState<Phase>("config");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [outPath, setOutPath] = useState("");
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => () => unsub.current?.(), []);

  const res = resOptions[resIdx];
  const durSec = round2(ticksToSeconds(projectDurationTicks(project)));
  const canExport = inElectron && durSec > 0;

  const run = async () => {
    const name = project.name || "export";
    const picked = await exportPick(name);
    if (!picked) return; // cancelled
    setOutPath(picked);
    setPhase("running");
    setProgress(0);
    unsub.current = onExportProgress((p) => setProgress(p.progress < 0 ? progress : p.progress));
    const result = await exportVideo({ project: project as unknown, width: res.width, height: res.height, fps, outPath: picked });
    unsub.current?.();
    unsub.current = null;
    if (result.ok) {
      setPhase("done");
    } else {
      setMessage(result.error ?? "Export failed");
      setPhase("error");
    }
  };

  return (
    <Modal
      title="Export Video"
      onClose={onClose}
      width={440}
      dismissable={phase !== "running"}
      footer={
        phase === "config" ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!canExport} onClick={() => void run()}>Export</Button>
          </>
        ) : phase === "running" ? (
          <span className="text-[12px] text-muted-foreground">Encoding… {Math.round(progress * 100)}%</span>
        ) : (
          <Button size="sm" onClick={onClose}>Done</Button>
        )
      }
    >
      {phase === "config" || phase === "running" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Resolution</span>
            <div className="grid grid-cols-3 gap-2">
              {resOptions.map((o, i) => (
                <button
                  key={o.label}
                  disabled={phase === "running"}
                  onClick={() => setResIdx(i)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-md border px-2 py-2 transition disabled:opacity-50",
                    resIdx === i ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                  )}
                >
                  <span className="text-[12px] font-medium text-foreground">{o.label}</span>
                  <span className="text-[10px] tabular-nums text-subtle">{o.width}×{o.height}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Frame rate</span>
            <select
              value={fps}
              disabled={phase === "running"}
              onChange={(e) => setFps(Number(e.target.value))}
              className="h-8 w-28 rounded-md border border-border bg-background px-2 text-[13px] tabular-nums text-foreground outline-none focus:border-primary disabled:opacity-50"
            >
              {fpsOptions.map((f) => <option key={f} value={f}>{f} fps</option>)}
            </select>
          </label>

          <p className="text-[11px] text-subtle">
            {res.width}×{res.height} · {fps}fps · {durSec}s · H.264 mp4
          </p>

          {!inElectron && <p className="text-[12px] text-destructive">Export requires the desktop app.</p>}
          {inElectron && durSec <= 0 && <p className="text-[12px] text-destructive">Timeline is empty — nothing to export.</p>}

          {phase === "running" && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>
      ) : phase === "done" ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 size={28} className="text-primary" />
          <p className="text-[13px] text-foreground">Export complete</p>
          <p className="max-w-full truncate text-[11px] text-subtle" title={outPath}>{outPath}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <AlertTriangle size={28} className="text-destructive" />
          <p className="text-[13px] text-foreground">Export failed</p>
          <pre className="max-h-32 w-full overflow-auto whitespace-pre-wrap rounded-md bg-secondary p-2 text-left text-[10px] text-muted-foreground">{message}</pre>
        </div>
      )}
    </Modal>
  );
}
