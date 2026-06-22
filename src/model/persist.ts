// localStorage fallback for the browser / unsaved "scratch" projects. When a
// real project folder is open the document is autosaved to disk instead (see
// projectFile.ts); this just keeps browser-dev edits from being wiped on reload.
//
// Note: in browser dev, imported media uses `blob:` URLs that don't survive a
// reload, so the timeline structure persists but those assets won't reload. In
// the desktop app media is referenced by file path, so it persists fully.
import type { Project } from "./types";

const KEY = "ocean.project.v1";

/** Restore the persisted scratch project, or null if none/invalid. */
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

/** Persist a scratch project to localStorage. */
export function saveLocal(project: Project): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
  } catch {
    /* quota exceeded or serialization issue — drop the save silently */
  }
}
