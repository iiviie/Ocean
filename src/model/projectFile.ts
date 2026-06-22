// Project lifecycle: new / open / save / close, plus startup restore and
// autosave. A project on disk is a folder containing project.json (the full
// document). Assets are referenced by absolute path, so the folder only carries
// the document itself. In the browser (no desktop bridge) projects live in
// memory and fall back to localStorage.
import { useStore, createEmptyProject } from "./store";
import { useAppState, lastProjectPath, forgetProject } from "./appState";
import { loadPersisted, saveLocal } from "./persist";
import { createSampleProject } from "./sample";
import { inElectron, projectPickNew, projectOpen, projectRead, projectSave } from "@/engine/render";
import type { Project } from "./types";

export interface NewProjectOptions {
  name: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor?: string;
}

export function deriveProjectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "Untitled";
}

function buildProject(opts: NewProjectOptions): Project {
  const p = createEmptyProject();
  p.name = opts.name || "Untitled";
  p.canvas = {
    width: Math.round(opts.width),
    height: Math.round(opts.height),
    fps: opts.fps,
    backgroundColor: opts.backgroundColor ?? "#000000",
  };
  return p;
}

function validProject(p: unknown): p is Project {
  return !!p && Array.isArray((p as Project).tracks) && !!(p as Project).canvas;
}

/** Write the current document to its folder (no-op for a scratch project). */
async function writeCurrent(): Promise<void> {
  const app = useAppState.getState();
  if (!app.projectPath || !inElectron) return;
  app.setStatus("saving");
  try {
    await projectSave(app.projectPath, JSON.stringify(useStore.getState().project));
    useAppState.getState().setStatus("saved");
  } catch {
    useAppState.getState().setStatus("error");
  }
}

function loadJsonAt(dir: string, json: string): boolean {
  try {
    const p = JSON.parse(json);
    if (!validProject(p)) throw new Error("invalid project");
    useStore.getState().loadProject(p);
    useAppState.getState().openedAt(dir);
    return true;
  } catch {
    forgetProject(dir);
    return false;
  }
}

/** Create a project. In the desktop app this prompts for a folder and writes
 *  project.json there; in the browser it lives in memory. Returns false if the
 *  user cancelled the folder picker. */
export async function newProject(opts: NewProjectOptions): Promise<boolean> {
  const project = buildProject(opts);
  if (inElectron) {
    const dir = await projectPickNew(opts.name || "Untitled");
    if (!dir) return false;
    useStore.getState().loadProject(project);
    await projectSave(dir, JSON.stringify(project));
    useAppState.getState().openedAt(dir);
  } else {
    useStore.getState().loadProject(project);
    useAppState.getState().setView("editor");
  }
  return true;
}

/** Prompt for a project folder and open it. Returns false on cancel/failure. */
export async function openProject(): Promise<boolean> {
  if (!inElectron) return false;
  const res = await projectOpen();
  if (!res) return false;
  return loadJsonAt(res.path, res.json);
}

/** Open a known folder path (used for recents and startup restore). */
export async function openProjectPath(dir: string): Promise<boolean> {
  if (!inElectron) return false;
  const json = await projectRead(dir);
  if (json == null) {
    forgetProject(dir);
    return false;
  }
  return loadJsonAt(dir, json);
}

/** Force an immediate save (e.g. ⌘S). */
export async function saveProject(): Promise<void> {
  await writeCurrent();
}

/** Save, then return to the welcome screen with a fresh empty document. */
export async function closeProject(): Promise<void> {
  await writeCurrent();
  useStore.getState().loadProject(createEmptyProject());
  useAppState.getState().openedAt(null);
  useAppState.getState().setView("welcome");
}

/** Reopen the last project on startup. Returns true if it loaded. */
export async function restoreLastProject(): Promise<boolean> {
  if (!inElectron) return false;
  const last = lastProjectPath();
  return last ? openProjectPath(last) : false;
}

/** Wire startup: restore last project, else welcome (desktop) / scratch (browser). */
export async function bootstrap(): Promise<void> {
  const restored = await restoreLastProject();
  if (restored) return;
  if (inElectron) {
    useAppState.getState().setView("welcome");
  } else {
    useStore.getState().loadProject(loadPersisted() ?? createSampleProject());
    useAppState.getState().setView("editor");
  }
}

/** Autosave on document change: to the project folder when one is open,
 *  otherwise to localStorage (browser scratch). Debounced. */
export function installAutosave(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  useStore.subscribe((state, prev) => {
    if (state.project === prev.project) return; // ignore ephemeral editor changes
    const app = useAppState.getState();
    if (app.projectPath && inElectron && app.status === "saved") app.setStatus("dirty");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (useAppState.getState().projectPath && inElectron) void writeCurrent();
      else saveLocal(state.project);
    }, 500);
  });
}
