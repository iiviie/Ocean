# Tooling Gap Plan — Editing & MCP Coverage

Status: planning. Goal is to enumerate everything missing for *basic* editing +
*full MCP parity* so we can implement it in one coordinated pass rather than
piecemeal.

Audited 2026-06-22 against: `src/model/commands.ts` (command bus),
`src/agent/tools.ts` (UI tool registry), `mcp/server.ts` (MCP catalog),
`src/agent/bridge.ts` (read selectors), `src/engine/render.ts`.

---

## Current state (what already works)

- **MCP parity is good.** The 24 tools in `mcp/server.ts` and `src/agent/tools.ts`
  match one-for-one and all route through the command bus, so every agent edit
  re-renders the UI. Only risk is manual drift between the two hand-kept lists.
- **Add-media-to-timeline works over MCP:** `import_media` → `list_media` →
  `add_track` → `add_clip`. Caveats: `import_media` is desktop/Electron-only
  (throws in browser, `tools.ts:148`); `add_clip` needs an existing `trackId`.
- **Basic editing coverage is complete:** import, tracks, clips,
  move/trim/split/delete, transform, text, opacity/fade, volume, speed, markers,
  playhead, selection.

---

## Gaps to implement

Each item notes: what's missing, where it lives today, and the proposed shape.
Priority: P0 = needed for "make a video" / "all settings via MCP", P1 = important,
P2 = nice-to-have.

### P0 — Export / render to file
- **Missing entirely.** No encode/ffmpeg/mux path anywhere in the repo. The app
  (and the agent) cannot produce a finished video file.
- Scope: needs a real encode pipeline (likely ffmpeg in the Electron main
  process). Biggest piece of work here — plan separately but track it.
- Proposed surface once pipeline exists:
  - command: none (it's an action, not a doc mutation) — or a job model.
  - tool: `export_video({ fromSec?, toSec?, path?, preset? }) -> { path, durationSec }`
  - Consider async/job semantics + progress, since encode is slow (MCP bridge
    currently has a 10s timeout in `server.ts:68` — will need a longer/streamed
    path or a poll tool `get_export_status`).

### P0 — `set_canvas` exposed to the agent
- Command exists (`commands.ts:51,309`) and UI can change resolution/fps, but
  there is **no tool**, so the agent can't set resolution / fps / aspect ratio.
  Directly violates "all settings doable through MCP".
- Proposed tool: `set_canvas({ width?, height?, fps? }) -> { diff }` in both
  `tools.ts` and `mcp/server.ts`.

### P0 — Track properties (mute / hide / lock / track volume+opacity)
- Tracks carry `enabled`, `locked`, `volume`, `opacity` (`commands.ts:107-115`)
  but there is **no command at all** to mutate them — impossible from UI *or*
  agent.
- Proposed command: `{ type: "set_track"; trackId; patch: Partial<Pick<Track,
  "name"|"enabled"|"locked"|"volume"|"opacity">> }` in `commands.ts` applier.
- Proposed tool: `set_track({ trackId, name?, enabled?, locked?, volume?,
  opacity? })` in `tools.ts` + `mcp/server.ts`.
- Also wire the UI controls (Timeline track headers) to the new command.

### P1 — `get_frame` (visual feedback for the agent)
- The MCP server **already** converts a returned `image` data-URL into an image
  block (`server.ts:122-139`), but no tool ever returns one — the agent edits
  blind.
- Proposed tool: `get_frame({ atSec }) -> { image: "data:image/png;base64,..." }`
  by rendering the compositor to an offscreen canvas at the given time. Half the
  plumbing already exists; needs the renderer-side frame capture.

### P1 — Keyframes / animation
- Clips have a `keyframes: []` field (`commands.ts:153,221`) but nothing ever
  populates it; no transitions beyond per-clip opacity fades.
- Proposed commands: `add_keyframe` / `remove_keyframe` / `clear_keyframes`
  over a clip property (e.g. transform, opacity). Define the keyframe interp
  model first (which props are animatable, easing).
- Proposed tools mirror the commands. Also a transition primitive (crossfade)
  is worth scoping here.

### P2 — Ephemeral / convenience tools
- Commands without tools: `set_playing` (play/pause), `select_asset`,
  `set_range`, `set_zoom`, `set_working` (`commands.ts:53-59`).
- Most are UI-only conveniences. `set_range` is the one an agent might
  genuinely want (range-based ops). Expose at least `set_range`; the rest
  optional.

### P2 — Other editing primitives
- `duplicate_clip` (copy a clip), grouping, and undo/redo exposed as a tool
  (there's a command log in `bridge.ts:83` `recent` but no redo path surfaced).

---

## Cross-cutting: prevent MCP drift
Per the note in `server.ts:78`: have the UI publish the tool catalog on connect
(generated from the live `tools` registry) so `mcp/server.ts` never hand-mirrors
schemas again. Worth doing as part of this pass since we're adding several tools.

---

## Suggested implementation order
1. `set_track` command + tool + UI wiring (self-contained, unblocks mute/lock).
2. `set_canvas` tool (command already exists — tiny).
3. `get_frame` tool (renderer capture; MCP side already handles the image).
4. `set_range` (+ optional ephemerals).
5. Catalog auto-publish to kill drift (do before/with the big batch).
6. Keyframes/animation + transitions (needs a model design first).
7. Export pipeline (largest; separate workstream, async/job semantics).
