// Lightweight document persistence so edits survive a reload / Vite HMR.
//
// Without this, main.tsx re-seeds the sample project on every module load and
// wipes the user's (and the agent's) work. We autosave the Project to
// localStorage on change and restore it on startup.
//
// Note: in browser dev, imported media uses `blob:` URLs that don't survive a
// reload, so the timeline structure persists but those assets won't reload. In
// the desktop app media is referenced by file path, so it persists fully.
import { useStore } from "./store";
import type { Project } from "./types";

const KEY = "ocean.project.v1";

/** Restore the persisted project, or null if none/invalid. */
export function loadPersisted(): Project | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Project;
    // minimal shape check — guard against stale/incompatible blobs
    if (!p || !Array.isArray(p.tracks) || !p.canvas) return null;
    return p;
  } catch {
    return null;
  }
}

function save(project: Project): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
  } catch {
    /* quota exceeded or serialization issue — drop the save silently */
  }
}

/** Subscribe to document changes and autosave (debounced). Call after the
 *  initial loadProject so the startup load isn't itself re-persisted. */
export function installPersistence(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  useStore.subscribe((state, prev) => {
    if (state.project === prev.project) return; // ignore ephemeral editor-state changes
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => save(state.project), 400);
  });
}
