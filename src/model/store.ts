// The reactive store. Holds the document (Project) + ephemeral EditorState and
// exposes a single `dispatch(command)` mutation path. The UI subscribes to this
// store, so ANY dispatch — from a button, a drag, or an MCP tool call forwarded
// by the Rust core — re-renders the UI automatically. This is the mechanism
// behind "every change the AI makes is visible in the UI" (PRD §6.2).
import { create } from "zustand";
import { produce } from "immer";
import type { EditorState, Project } from "./types";
import type { Command, CommandSource, Diff } from "./commands";
import { applyCommand } from "./commands";
import { seedCounters } from "./ids";

export interface LogEntry {
  seq: number;
  source: CommandSource;
  command: Command;
  diff: Diff;
  error?: string;
  at: number;
}

interface OceanStore {
  project: Project;
  editor: EditorState;
  /** Recent command log — drives the agent feedback panel + an audit trail. */
  log: LogEntry[];
  /** The single mutation path. Returns a compact diff string (PRD §7). */
  dispatch: (cmd: Command, source?: CommandSource) => Diff;
  /** High-frequency playhead update for playback/scrub — bypasses the log so it
   *  doesn't flood the command history at 60fps. */
  tickPlayhead: (ticks: number) => void;
  loadProject: (project: Project) => void;
}

let seq = 0;

// High-frequency / ephemeral commands that should NOT pollute the command log
// (they fire continuously during drags & playback and would saturate the UI).
const TRANSIENT = new Set<Command["type"]>(["set_playhead", "set_zoom", "set_working"]);

export const useStore = create<OceanStore>((set) => ({
  project: createEmptyProject(),
  editor: createEditorState(),
  log: [],

  dispatch: (cmd, source = "ui") => {
    let diff: Diff = "";
    let error: string | undefined;
    set((state) =>
      produce(state, (draft) => {
        try {
          diff = applyCommand({ project: draft.project, editor: draft.editor }, cmd);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        // Skip transient high-frequency commands unless they errored.
        if (error || !TRANSIENT.has(cmd.type)) {
          draft.log.push({ seq: ++seq, source, command: cmd, diff, error, at: Date.now() });
          if (draft.log.length > 200) draft.log.splice(0, draft.log.length - 200);
        }
      }),
    );
    if (error) {
      // Throw so callers (and the MCP layer) get actionable errors (PRD §11).
      throw new Error(error);
    }
    return diff;
  },

  tickPlayhead: (ticks) =>
    set((state) =>
      produce(state, (draft) => {
        draft.editor.playheadTicks = Math.max(0, ticks);
      }),
    ),

  loadProject: (project) => {
    const ids = [
      ...project.mediaLibrary.map((a) => a.id),
      ...project.tracks.map((t) => t.id),
      ...project.tracks.flatMap((t) => t.clips.map((c) => c.id)),
      ...project.markers.map((m) => m.id),
    ];
    seedCounters(ids);
    set({ project, editor: createEditorState(), log: [] });
  },
}));

export function createEmptyProject(): Project {
  const now = Date.now();
  return {
    id: "p1",
    name: "Untitled",
    createdAt: now,
    modifiedAt: now,
    canvas: { width: 1920, height: 1080, fps: 30, backgroundColor: "#000000" },
    sampleRate: 48000,
    mediaLibrary: [],
    tracks: [],
    markers: [],
  };
}

export function createEditorState(): EditorState {
  return {
    playheadTicks: 0,
    playing: false,
    selectedClipIds: [],
    selectedAssetId: undefined,
    rangeSelection: undefined,
    zoom: 40, // px per second
    workingClipIds: [],
  };
}
