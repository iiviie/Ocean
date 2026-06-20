# Ocean

An AI-native, cross-platform video editor where **every editing capability is
exposed as an MCP tool**. A human can edit in the UI, but the primary "power user"
is an AI agent (Claude Code / Claude Desktop / Cursor / Codex) that reads project
state and edits programmatically.

See [`docs/PRD.md`](docs/PRD.md) for the full product spec.

## Architecture in one line

One **document model** is the single source of truth. Both the UI and the agent
are clients of one **command bus** — so every edit the AI makes is reflected in the
UI automatically (PRD §6.2).

```
   UI (React) ─┐
               ├─► dispatch(command) ─► document store ─► UI re-renders
  Agent/MCP  ──┘                            │
                                    (compact diff returned)
```

## Stack

- **UI:** React + TypeScript (Vite), in a Tauri webview.
- **Core:** Rust (Tauri) — will own the document model, FFmpeg media engine, audio
  analysis, export, and the MCP server.
- **Cross-platform:** macOS, Windows, Linux.

## Run

### Web (fastest iteration — runs the editor in a browser)

```bash
pnpm install
pnpm approve-builds esbuild   # one-time: allow esbuild's postinstall
pnpm dev                      # http://localhost:5173
```

### Desktop (Tauri)

Requires Rust + platform WebView deps (Linux: `webkit2gtk-4.1`).

```bash
pnpm tauri:dev      # dev window with hot reload
pnpm tauri:build    # production bundles
```

## Try the agent bridge

The agent bridge (`window.ocean`) is the in-process stand-in for the future MCP
server — it uses the **same command bus** the UI uses. Open devtools and run:

```js
ocean.get_project()                 // compact project facts
ocean.get_timeline({ fromSec: 0, toSec: 6 })   // windowed timeline
ocean.get_canvas_layout(1.0)        // spatial awareness: object boxes + overlaps
ocean.dispatch({ type: "set_text", clipId: "c3", patch: { content: "HELLO" } })
```

Watch the change land in the preview/timeline instantly, and in the **Agent** panel's
command log. The in-app Agent panel has starter buttons and a console doing the same.

## Layout of the code

```
src/
  model/         document model = single source of truth
    types.ts       Project / Track / Clip / MediaAsset / Transform
    commands.ts    the typed command bus (gesture-style mutations) + compact diffs
    store.ts       reactive zustand store; the one dispatch() path
    selectors.ts   derived views incl. spatial/temporal awareness
    time.ts        integer-tick timebase (frame-accurate, token-compact)
  agent/
    bridge.ts      window.ocean — read tools + dispatch; the MCP stand-in
  ui/
    Editor.tsx     four-panel layout
    panels/        MediaLibrary, PreviewCanvas, Timeline, Inspector, AgentChat
src-tauri/         Rust core (Tauri shell today; document/MCP/export core later)
docs/PRD.md        product requirements
```

## Status

Milestone **M0–M1 (early)**: scaffold, document model + command bus, reactive
four-panel UI, manual editing of clips/text/transform/audio levels, in-process
agent bridge proving AI→UI visibility. Next: real media import/decode (FFmpeg),
WebGL compositor, export, and the Rust MCP server. See PRD §12 for milestones.
