// Dockable-panel layout state: which side panels are open and how wide they are.
// Persisted to localStorage so the workspace survives reloads. The agent chat is
// off by default (it's optional — the editor stands on its own); media + the
// inspector are on. Each panel can be closed from its header and reopened from
// the View menu.
import { create } from "zustand";

export type PanelId = "chat" | "media" | "inspector";

interface PanelState {
  open: Record<PanelId, boolean>;
  width: Record<PanelId, number>;
  toggle: (id: PanelId) => void;
  setOpen: (id: PanelId, open: boolean) => void;
  setWidth: (id: PanelId, width: number) => void;
}

export const PANEL_LIMITS: Record<PanelId, { min: number; max: number }> = {
  chat: { min: 260, max: 460 },
  media: { min: 180, max: 420 },
  inspector: { min: 240, max: 480 },
};

const DEFAULTS: Pick<PanelState, "open" | "width"> = {
  open: { chat: false, media: true, inspector: true },
  width: { chat: 320, media: 232, inspector: 288 },
};

const KEY = "ocean.panels.v1";

function load(): Pick<PanelState, "open" | "width"> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw);
    return {
      open: { ...DEFAULTS.open, ...(p.open ?? {}) },
      width: { ...DEFAULTS.width, ...(p.width ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(s: Pick<PanelState, "open" | "width">) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ open: s.open, width: s.width }));
  } catch {
    /* ignore */
  }
}

const clampW = (id: PanelId, w: number) => Math.max(PANEL_LIMITS[id].min, Math.min(PANEL_LIMITS[id].max, w));

export const usePanels = create<PanelState>((set, get) => ({
  ...load(),
  toggle: (id) => {
    const open = { ...get().open, [id]: !get().open[id] };
    set({ open });
    persist({ open, width: get().width });
  },
  setOpen: (id, v) => {
    const open = { ...get().open, [id]: v };
    set({ open });
    persist({ open, width: get().width });
  },
  setWidth: (id, w) => {
    const width = { ...get().width, [id]: clampW(id, w) };
    set({ width });
    persist({ open: get().open, width });
  },
}));
