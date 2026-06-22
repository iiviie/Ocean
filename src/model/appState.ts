// App-level / session state that is NOT part of the saved document: which
// project folder is currently open, save status, the welcome-vs-editor view,
// and the recent-projects list. Kept in its own store so updating it doesn't
// wake the document subscribers (autosave, undo, etc.).
import { create } from "zustand";

export type SaveStatus = "saved" | "saving" | "dirty" | "error";
export type AppView = "welcome" | "editor";

const RECENT_KEY = "ocean.recentProjects";
const LAST_KEY = "ocean.lastProjectPath";

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface AppStore {
  /** Absolute path of the open project folder, or null for an unsaved scratch project. */
  projectPath: string | null;
  view: AppView;
  status: SaveStatus;
  recent: string[];
  setView: (view: AppView) => void;
  setStatus: (status: SaveStatus) => void;
  /** Record the open project: set its path, remember it as last/recent, switch to the editor. */
  openedAt: (path: string | null) => void;
}

export const useAppState = create<AppStore>((set, get) => ({
  projectPath: null,
  view: "welcome",
  status: "saved",
  recent: readRecent(),

  setView: (view) => set({ view }),
  setStatus: (status) => set({ status }),

  openedAt: (path) => {
    if (path) {
      const recent = [path, ...get().recent.filter((p) => p !== path)].slice(0, 8);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
        localStorage.setItem(LAST_KEY, path);
      } catch {
        /* ignore quota */
      }
      set({ projectPath: path, recent, view: "editor", status: "saved" });
    } else {
      try {
        localStorage.removeItem(LAST_KEY);
      } catch {
        /* ignore */
      }
      set({ projectPath: null, status: "saved" });
    }
  },
}));

export function lastProjectPath(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/** Drop a path from the recent list (e.g. when it fails to open). */
export function forgetProject(path: string): void {
  const s = useAppState.getState();
  const recent = s.recent.filter((p) => p !== path);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    if (lastProjectPath() === path) localStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
  useAppState.setState({ recent });
}
