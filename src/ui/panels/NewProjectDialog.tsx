import { useState } from "react";
import { Modal } from "@/ui/components/Modal";
import { Button } from "@/ui/components/Button";
import { newProject } from "@/model/projectFile";
import { cn } from "@/ui/lib/cn";

interface Preset {
  label: string;
  ratio: string;
  width: number;
  height: number;
}

// Common social/broadcast canvases. "Custom" lets the user type any size.
const PRESETS: Preset[] = [
  { label: "Landscape", ratio: "16:9", width: 1920, height: 1080 },
  { label: "Portrait", ratio: "9:16", width: 1080, height: 1920 },
  { label: "Square", ratio: "1:1", width: 1080, height: 1080 },
  { label: "Vertical", ratio: "4:5", width: 1080, height: 1350 },
];

const FPS_OPTIONS = [24, 25, 30, 50, 60];

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("Untitled");
  const [presetIdx, setPresetIdx] = useState(1); // default Portrait 9:16 (matches the current sample)
  const [custom, setCustom] = useState(false);
  const [w, setW] = useState(1080);
  const [h, setH] = useState(1920);
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false);

  const width = custom ? w : PRESETS[presetIdx].width;
  const height = custom ? h : PRESETS[presetIdx].height;
  const valid = name.trim().length > 0 && width >= 16 && height >= 16 && width <= 7680 && height <= 7680;

  const create = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await newProject({ name: name.trim(), width, height, fps });
    setBusy(false);
    if (ok) onClose();
    // if cancelled (folder picker dismissed) keep the dialog open
  };

  return (
    <Modal
      title="New Project"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!valid || busy} onClick={() => void create()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-primary"
          />
        </Field>

        <Field label="Canvas">
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                onClick={() => { setPresetIdx(i); setCustom(false); }}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-md border px-2 py-2.5 transition",
                  !custom && presetIdx === i ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                )}
              >
                <AspectIcon w={p.width} h={p.height} active={!custom && presetIdx === i} />
                <span className="text-[11px] font-medium text-foreground">{p.label}</span>
                <span className="text-[10px] text-subtle">{p.ratio}</span>
              </button>
            ))}
          </div>
        </Field>

        <div className="flex items-end gap-2">
          <Field label="Width">
            <input
              type="number"
              value={width}
              onChange={(e) => { setCustom(true); setW(Number(e.target.value) || 0); }}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[13px] tabular-nums text-foreground outline-none focus:border-primary"
            />
          </Field>
          <span className="pb-2 text-subtle">×</span>
          <Field label="Height">
            <input
              type="number"
              value={height}
              onChange={(e) => { setCustom(true); setH(Number(e.target.value) || 0); }}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[13px] tabular-nums text-foreground outline-none focus:border-primary"
            />
          </Field>
          <Field label="FPS">
            <select
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-background px-2 text-[13px] tabular-nums text-foreground outline-none focus:border-primary"
            >
              {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
        </div>

        <p className="text-[11px] text-subtle">
          {width}×{height} · {fps}fps{custom ? " · custom" : ""}
        </p>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** A little box drawn to the preset's aspect ratio. */
function AspectIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const max = 22;
  const bw = w >= h ? max : Math.round((w / h) * max);
  const bh = h >= w ? max : Math.round((h / w) * max);
  return (
    <span className="grid h-6 place-items-center">
      <span
        className={cn("rounded-[2px] border", active ? "border-primary bg-primary/30" : "border-muted-foreground/50")}
        style={{ width: bw, height: bh }}
      />
    </span>
  );
}
