# Ocean — Product Requirements Document

**A cross-platform, AI-native video editor where every editing capability is exposed as an MCP tool.**

- **Status:** Draft v1
- **Owner:** divyansh@crosmos.dev
- **Last updated:** 2026-06-18
- **Working name:** Ocean

---

## 1. Summary

Ocean is a desktop video editor whose entire editing surface — timeline, layers,
text, audio, export — is driven by a typed, token-efficient **MCP (Model Context
Protocol) tool layer**. A human can edit manually in the UI, but the primary
"power user" is an AI agent (Claude Code, Claude Desktop, Cursor, Codex, or any
MCP client) that reads the project state and performs edits programmatically.

The thesis: most people are bad at video editing because the *mechanical* work
(cutting on beats, aligning text, syncing clips to a transcript, balancing audio)
is tedious and skill-gated. If an agent has **spatial awareness** (canvas size,
object bounds, text scale), **temporal awareness** (clip timings, beats,
transcript timestamps), **media awareness** (what's in a video/image/audio), and
**self-inspection** (it can look at what it made), then a non-editor can describe
intent in plain language and get a competent edit back.

A hard constraint throughout: **minimize token consumption**. The agent should be
able to understand and manipulate a complex timeline without dumping megabytes of
JSON or screenshots into context.

---

## 2. Goals & Non-Goals

### 2.1 Goals (v1 — full vision)

1. A usable manual video editor UI (timeline, preview canvas, media library,
   inspector) inspired by [palmier.io](https://www.palmier.io/).
2. Core editing: import media, clip/trim video, multi-track layering, transform
   (position/scale/rotation/opacity), text + custom fonts, add/remove/clip audio,
   and export to standard formats.
3. **Every** editing capability exposed via MCP tools with stable, typed schemas.
4. AI awareness primitives:
   - **Spatial:** canvas dimensions, per-object bounding boxes, text scale, safe areas.
   - **Temporal:** clip in/out points, track layout, playhead, project duration.
   - **Audio:** beat/onset detection (for music) and transcription with word/segment timestamps (for speech).
   - **Visual:** on-demand frame screenshots, timeline thumbnails, storyboard overviews.
5. **Token efficiency** as a first-class design constraint (see §7).
6. Cross-platform: macOS, Windows, Linux.
7. One-click MCP install into Claude Code / Claude Desktop / Cursor / Codex.

### 2.2 Non-Goals (v1)

- Real-time multi-user collaboration.
- Cloud rendering / render farm (export is local).
- Generative media (text-to-video, text-to-image, text-to-music). *Hooks left open
  for v2 — see §13.* Ocean v1 edits media you bring; it does not synthesize it.
- Advanced color grading (LUTs, scopes), motion tracking, or 3D.
- Mobile (iOS/Android) clients.

### 2.3 Explicit anti-goals

- No telemetry that ships project media off-device without consent.
- No locking the editor's "truth" inside the UI layer — the document model is the
  single source of truth and is equally reachable from UI and MCP.

---

## 3. Users & Use Cases

| Persona | Description | Primary interface |
|---|---|---|
| **Non-editor creator** | Has clips + music, wants a polished short. Can't/won't learn an NLE. | Chat → AI → MCP |
| **Prosumer / editor** | Wants AI to do grunt work (rough cut, captions, beat-syncing) then finishes by hand. | UI + AI |
| **Agent developer** | Builds automations on top of Ocean's MCP. | MCP only (headless) |

### 3.1 Anchor use cases

1. *"Cut this 10-minute clip down to a 30s highlight on the beat of this song."*
   → beat detection + clip selection + ripple edits + transitions.
2. *"Add captions from the speech and put a title card for the first 3 seconds."*
   → transcription + text layers + spatial placement within safe area.
3. *"Make a montage: one image per beat for the chorus, then back to video."*
   → beat map + image track + timing.
4. *"The text is overlapping the speaker's face — move it to the lower third."*
   → spatial inspection (object bbox vs. face/subject) + transform.
5. *"Export this as 1080p MP4 for Instagram."* → export pipeline.

---

## 4. Prior Art & Lessons Learned

We studied the public commit history of `palmier-io/palmier-pro` (a macOS/SwiftUI
AI video editor) to avoid re-discovering known problems. Ocean differs
architecturally (we are **cross-platform Tauri + Web**, they are macOS/Swift), but
the *hard-won lessons* transfer. These are baked into the spec below.

| Lesson observed in prior art | How Ocean mitigates from day one |
|---|---|
| Float tool output bloats tokens | Cap all numeric tool output to 2 decimals; emit ticks/ms ints where possible (§7). |
| Long timelines blow up context | `get_timeline` is **windowed** (time range + track filter) by default, never "dump everything" (§7, §8). |
| Transcripts are huge | Transcripts are **paged with a cursor**, cached on disk keyed by file identity, and segmented (§8.4). |
| Compositing color/alpha bugs (straight vs. premultiplied alpha; ProRes 4444 zeroing alpha) | Define a single canonical compositing color space + alpha mode in the render contract (§6.4); test with alpha fixtures. |
| Transform coupling (scale tied to position) caused drag/resize bugs under rotation | Store transforms as **center-anchored** (centerX, centerY, scale, rotation) and decouple scale from position from the start (§6.3). |
| Undo caused crashes | Command/transaction model with a single mutation path and serializable inverse ops (§6.5). |
| Export crashed on empty/missing tracks & media | Export pre-flight validation; surface missing media in panel/timeline/preview (§6.6). |
| "Tool reference drift" — prompt mentioned tools that changed | Tool schemas are the single source; agent system prompt is **generated** from the live tool registry (§8.1). |
| Clip tools felt unnatural to the agent | Model agent edits on a **human-gesture vocabulary** (trim, split, move, ripple) rather than raw struct mutation (§8.3). |
| First-frame-empty / black-frame-at-end render glitches | Define explicit frame sampling & boundary semantics in the render contract (§6.4). |
| Captioning needed segment-based phrasing & per-source ranges | Captions operate on segments with language + font params, on trimmed source ranges only (§8.4). |
| MCP install friction (bundle not shipped, crashed) | Ship a tested `.mcpb`/installer; one-click install flow is a v1 acceptance gate (§9). |

> These are guardrails, not features to copy. Where prior art is closed-source we
> only infer intent from commit messages; we implement independently.

---

## 5. UX & UI

### 5.1 Reference

Visual/interaction inspiration: [palmier.io](https://www.palmier.io/). Clone the
*layout language* (dark, panelled, timeline-centric), not pixel assets.

### 5.2 Layout

```
┌───────────────────────────────────────────────────────────────┐
│  Title bar (project name, export, update badge)                 │
├──────────────┬───────────────────────────────┬─────────────────┤
│  Media        │   Preview canvas               │  Inspector       │
│  library      │   (WebGL compositor)           │  (selected       │
│  (import,     │   - transform handles          │   clip/text      │
│   folders,    │   - safe-area overlay          │   props)         │
│   thumbnails) │   - playhead-accurate frame    │                  │
│               │                                │  Agent chat      │
│               │                                │  (MCP-driven)    │
├──────────────┴───────────────────────────────┴─────────────────┤
│  Timeline: multi-track, zoom/pan, waveforms, beat markers,       │
│  snapping, range selection, clip mentions (@clip)                │
└───────────────────────────────────────────────────────────────┘
```

### 5.3 Key UI behaviors (from prior-art lessons)

- Timeline **zoom & pan** with keyboard shortcuts; zoom slider is **log-mapped**;
  can zoom out to fit very long timelines.
- **Snapping** with feedback (visual + optional haptic on supported platforms).
- **Range selection** on the timeline that can be referenced by the agent.
- **Clip mentions** in chat: `@<short-name>-<track>-<timecode>` so the human and
  agent share a vocabulary for "which clip."
- **Generating/working overlays**: when the agent is mid-edit, affected clips show
  a shimmer/working state rather than appearing broken or offline.
- **Missing media** is explicitly surfaced in panel, timeline, and preview (never
  a silent black frame).
- Opacity fade-in/out for video and text clips; gap selection + ripple delete.

### 5.4 Agent chat panel

- Renders agent text, tool calls, and any images the agent captured (inline).
- **Starter prompts** for the anchor use cases (§3.1).
- Range/clip mentions flow from timeline selection into the prompt.
- Shows token usage per turn (transparency for the efficiency goal).

---

## 6. Architecture

### 6.1 Stack (decided)

```
┌──────────────────────────────────────────────────────────────┐
│ Tauri shell (Rust core)                                         │
│  ┌───────────────────────────┐   ┌──────────────────────────┐ │
│  │ Webview UI                 │   │ Rust core                 │ │
│  │  React + TypeScript        │   │  - Document model (truth) │ │
│  │  WebGL/WebGPU compositor   │◄─►│  - Command bus            │ │
│  │  (PixiJS or custom)        │IPC│  - FFmpeg bindings        │ │
│  │  Timeline + inspector      │   │  - Media probe/decode     │ │
│  └───────────────────────────┘   │  - Audio analysis         │ │
│                                   │  - Export pipeline        │ │
│                                   │  - MCP server             │ │
│                                   └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- **UI:** React + TypeScript in the Tauri webview. Canvas compositing via
  WebGL/WebGPU (PixiJS as a starting point; evaluate custom renderer if perf
  demands). Timeline rendered on canvas for long-project performance.
- **Core:** Rust. Owns the document model, command bus, media I/O, audio analysis,
  export, and the MCP server. UI calls core via Tauri commands; core never depends
  on UI.
- **Media engine:** FFmpeg (linked as a native sidecar / Rust bindings such as
  `ffmpeg-next`), used for probe, decode, frame extraction, and export. WebCodecs
  in the webview for fast preview decode where available.
- **Why Tauri over Electron:** small binaries, lower memory, Rust core gives us a
  fast, testable, UI-independent document/render layer that the MCP server can call
  directly — the agent path does **not** go through the UI.

### 6.2 Core principle: one document, two consumers

The **document model** is the single source of truth. Both the UI and the MCP
server are *clients* of the same command bus. There is no editing capability that
exists only in the UI. This is the architectural backbone of the whole product.

```
        UI (webview) ─┐
                       ├─► Command Bus ─► Document Model ─► Render/Export
   MCP server (agent) ─┘                      │
                                      (emits change events → UI re-renders)
```

### 6.3 Document model (data model)

```
Project
  id, name, createdAt, modifiedAt
  canvas: { width, height, fps, aspectRatio, backgroundColor }
  sampleRate (audio), duration (derived)
  mediaLibrary: MediaAsset[]
  tracks: Track[]          // ordered; index 0 = bottom layer
  markers: Marker[]        // incl. beat markers, chapter markers

MediaAsset
  id, kind: video|image|audio|lottie
  fileIdentity     // hash + size + mtime — used as cache key (see §8.4)
  uri, duration, naturalWidth, naturalHeight
  hasAudio, codecInfo, colorInfo (primaries/transfer/range)
  analysis: { beatsRef?, transcriptRef?, storyboardRef? }  // lazy, cached

Track
  id, kind: video|audio|text   // image lives on a video track (lesson: "image track is just video track")
  index, enabled, locked, opacity, volume
  clips: Clip[]

Clip
  id, assetId?, kind
  // timeline placement
  timelineStart, timelineEnd            // in ticks (int), not floats
  // source range (for trims)
  sourceIn, sourceOut
  speed                                 // retime; speed-changed audio splits to its own track
  // spatial transform (CENTER-ANCHORED, scale decoupled from position)
  transform: { centerX, centerY, scale, rotation, flipH, flipV }
  opacity, opacityFadeIn, opacityFadeOut
  // text-specific
  text?: { content, fontName, fontSize, color, align, bbox, lineHeight, ... }
  keyframes: Keyframe[]
```

**Units & invariants (token + correctness discipline):**

- All times are **integer ticks** (e.g. project timebase = fps × N) internally;
  tools expose seconds rounded to ≤2 decimals or `mm:ss.cs` timecode.
- Transforms are **normalized** (0–1 of canvas) so the agent reasons about layout
  independent of pixel resolution; pixel values available on request.
- Clips never overlap on a single track; layering is expressed by track index.

### 6.4 Render / compositing contract

A written contract both the preview compositor and the export pipeline must honor
identically (so "what the agent sees" == "what exports"):

- **Color:** canonical working space defined (e.g. sRGB / Rec.709); decode tags
  respected; export re-tags correctly. ProRes/alpha codecs handled explicitly so
  alpha is never zeroed.
- **Alpha:** straight vs. premultiplied is explicit per asset; compositor
  premultiplies straight-alpha sources before blending.
- **Frame sampling:** explicit semantics for first/last frame of a clip (no empty
  first frame, no black trailing frame). Boundary = `[timelineStart, timelineEnd)`.
- **Z-order:** track index, then clip order; deterministic.
- Preview and export share the same compositor description (a render graph), so a
  frame the agent screenshots is the frame it gets on export.

### 6.5 Command / mutation model

- Every state change is a **Command** (typed, serializable) applied through the
  command bus. Commands carry their **inverse** for undo/redo → no ad-hoc undo
  stack that can desync and crash.
- Both UI gestures and MCP tool calls compile down to the *same* commands.
- Commands are atomic and validated against invariants (§6.3) before commit.
- Change events stream to the UI for re-render and to any subscribed MCP client.

### 6.6 Persistence & export

- **Project file:** `.ocean` — a self-contained bundle (manifest + relative media
  links, optionally embedded) so projects are portable. (Prior art's `.palmier`
  bundle is the model.) Direct-to-disk fileWrapper-style saves; snapshots prepared
  off the main thread.
- **Export formats (v1):** MP4 (H.264/H.265), MOV (incl. ProRes), WebM; audio
  WAV/AAC/MP3. Frame-accurate. Presets for common targets (1080p/4K, 9:16/1:1/16:9).
- **Interchange export (v2-ready):** Final Cut XML (XMEML) for round-tripping into
  pro NLEs, mirroring prior art's approach.
- **Export pre-flight:** validate tracks/media, surface missing assets, never crash
  on empty tracks; surface system error + code chain on failure.

---

## 7. Token-Efficiency Strategy (first-class requirement)

This is a differentiator and an explicit user requirement. Principles:

1. **Structured first, pixels on demand.** The agent reads a compact scene model by
   default; it requests rendered frames/screenshots only when it actually needs to
   *see* something. Both paths are first-class (hybrid), and tool descriptions steer
   toward the cheap path. *(Decision: hybrid — AI chooses per step.)*

2. **Windowing everywhere.** No tool returns "the whole project" by default.
   `get_timeline(window)`, transcript paging, frame ranges. The agent asks for the
   slice it needs.

3. **Compact encodings.**
   - Floats capped to ≤2 decimals; prefer integer ticks/ms.
   - Stable short IDs for clips/tracks/assets (`v1`, `c3`, `a7`).
   - Omit defaults from output (don't emit `opacity:1`, `rotation:0`).
   - Summaries before details (counts, ranges, then drill-down).

4. **Cache + reference, don't re-send.** Heavy artifacts (transcripts, beat maps,
   storyboards, frame captures) are computed once, cached on disk keyed by
   **file identity**, and referenced by handle. The agent fetches by handle/window.

5. **Storyboard overview.** `inspect_media` can return a small storyboard (N
   thumbnails across the clip) + segment summary instead of full-res frames.

6. **Diff-based change reporting.** After a mutation, tools return a minimal diff
   ("moved c3 to 4.20s; trimmed sourceIn 1.00→1.50"), not the whole new state.

7. **Image budget discipline.** Screenshots returned at the smallest resolution
   that answers the question; downscaled thumbnails for "where is everything,"
   full-res only for "is this pixel right."

**Success metric:** a representative 30-second beat-synced edit (anchor use case
§3.1.1) completes in **< 60k tokens** end-to-end, including beat detection,
several inspections, and a verification screenshot.

---

## 8. MCP Tool Surface

The MCP server runs in the Rust core and exposes tools grouped by capability. The
agent's system prompt is **generated from the live tool registry** to prevent
reference drift. Every tool: typed input/output schema, idempotency where possible,
compact output (§7), and a `dryRun` option for mutating tools.

### 8.1 Design rules

- Tools are **gestures, not struct setters** (move/trim/split/ripple), matching how
  a human edits — easier for the agent to reason about, harder to corrupt state.
- Mutating tools are atomic commands (§6.5) and return a **diff** + new derived
  values the agent will likely need next.
- Read tools are **windowed/paged** and **summarized-first**.
- Numeric outputs follow §7 encoding rules.

### 8.2 Read / awareness tools

| Tool | Purpose | Key params | Output (compact) |
|---|---|---|---|
| `get_project` | Project-level facts | — | canvas {w,h,fps,aspect}, duration, track count, asset count |
| `get_timeline` | **Windowed** timeline view | `timeRange`, `tracks?`, `detail?` | tracks→clips within window: id, start, end, kind, assetId, summary |
| `inspect_timeline` | Higher-level analysis | `timeRange?` | gaps, overlaps, density, suggested cut points |
| `inspect_clip` | One clip in detail | `clipId` | full transform (px+normalized), source range, text props, bbox |
| `inspect_media` | Understand an asset | `assetId`, `window?`, `mode: storyboard\|frames\|meta` | metadata + storyboard thumbs + (paged) segment info |
| `get_canvas_layout` | **Spatial awareness** | `time` | per-visible-object bbox, scale, z-order, safe-area, overlaps |
| `capture_frame` | **Visual self-inspection** | `time`, `resolution?`, `region?` | one rendered frame (smallest resolution that answers) |
| `capture_timeline` | Screenshot of timeline | `timeRange?` | thumbnail of timeline region |
| `get_selection` | What the human selected | — | selected clip ids / range |

### 8.3 Edit / gesture tools (mutating)

| Tool | Gesture |
|---|---|
| `import_media` / `batch_import_folder` | Add asset(s) to library |
| `add_clip` | Place asset on a track at a time |
| `trim_clip` | Adjust sourceIn/sourceOut (ripple optional) |
| `split_clip` | Cut at a time (a.k.a. razor) |
| `move_clip` | Move on timeline / between tracks |
| `delete_clip` / `ripple_delete` | Remove, optionally close gap |
| `set_transform` | center/scale/rotation/flip (normalized) |
| `set_opacity` / `set_fade` | Opacity + fade in/out |
| `add_text` / `set_text` | Text content, font, size, color, align, position |
| `add_track` / `remove_tracks` | Track management |
| `set_speed` | Retime (audio auto-splits as needed) |
| `add_transition` | Between adjacent clips |
| `set_volume` / `mute` | Audio levels |
| `add_keyframe` / `move_keyframe` | Animate any animatable prop |

All mutating tools support `dryRun` (returns the diff without applying).

### 8.4 Audio & media intelligence tools

| Tool | Purpose | Notes |
|---|---|---|
| `detect_beats` | **Beat/onset/tempo** for music | Returns BPM, downbeats, beat times (ticks); cached by file identity; placeable as timeline markers. Powers "cut on the beat." |
| `transcribe_audio` | **Speech → text + timestamps** | Word/segment-level timestamps; language detect; **paged with cursor**; cached on disk; only over **trimmed source ranges**. |
| `add_captions` | Generate caption text layers from a transcript | Segment-based phrasing; language + fontName params; positions within safe area. |
| `analyze_audio_levels` | Loudness / silence / peaks | For auto-ducking, trimming dead air. |
| `suggest_cuts` | Combine beats + transcript + scene changes | Returns candidate cut points with rationale. |

### 8.5 Export tools

| Tool | Purpose |
|---|---|
| `export_video` | Render to file with preset/format/range; returns progress handle + output path |
| `export_project_bundle` | Write a self-contained `.ocean` bundle |
| `export_xmeml` | Final Cut XML interchange (v2-ready) |

### 8.6 Example agent flow (anchor use case §3.1.1)

```
detect_beats(asset=song)                  → BPM 120, 60 beat times      [cached]
inspect_media(asset=clip, mode=storyboard)→ 8 thumbs + segment summary  [1 small image]
inspect_timeline()                        → empty, suggests structure
add_clip(...) ×N aligned to beat times    → diffs only
get_canvas_layout(time=2.0)               → confirm framing             [no image]
capture_frame(time=2.0, resolution=small) → verify once                 [1 small image]
export_video(preset="ig_reel_1080p")      → path
```

---

## 9. MCP Distribution & Client Integration

- Ship a tested **MCP bundle** (`.mcpb`-style) and a **one-click install** flow for:
  Claude Code, Claude Desktop, Cursor, Codex. (Prior art shipped exactly this and
  hit a crash when the bundle wasn't packaged — so packaging is a **v1 acceptance
  gate**, with an integration test that installs and lists tools.)
- **Transport:** local stdio MCP server spawned by the client, talking to a running
  Ocean instance over local IPC; plus an option to run Ocean **headless** (no
  window) for pure-agent automation.
- **Auth/keys:** BYOK supported; API keys stored in the OS keychain/secret store,
  never in plaintext config. Optional hosted agent proxy for users without keys
  (v2).
- **Discovery:** the agent calls a `describe_capabilities` meta-tool that returns
  the generated tool catalog + the document-model glossary, so the agent can
  bootstrap without a hand-maintained prompt.

---

## 10. Cross-Platform Requirements

| Concern | Requirement |
|---|---|
| OS targets | macOS 12+, Windows 10+, Linux (Ubuntu 22.04+ / common distros) |
| FFmpeg | Bundled per-platform; licensing reviewed (LGPL build) |
| GPU | WebGL2 minimum; WebGPU where available; CPU fallback for export |
| Fonts | System font enumeration + user font import; deterministic across OS for export |
| File paths | Project bundles use relative links; resolver handles moved/missing media |
| Auto-update | Cross-platform updater (Tauri updater); update badge in title bar |
| Performance | Smooth timeline at 60fps UI with multi-track 1080p; long-project (>30 min) timeline stays responsive via windowed rendering |

---

## 11. Non-Functional Requirements

- **Reliability:** no crash on undo, empty tracks, missing media, or unsupported
  drops (graceful toast + surfaced state).
- **Determinism:** same project → same export, byte-stable where codecs allow.
- **Testing:** Rust unit + property tests on timeline math, transform/keyframe
  invariants, compositing (with alpha fixtures), and an **adversarial pass** on edge
  inputs (prior art explicitly did this and found bugs). MCP tool-handler tests.
  Project round-trip (save→load→save) tests. Export shape tests.
- **Observability:** structured logging with actionable error messages (e.g.
  "timeline decode failure" includes the offending clip/asset). Opt-in crash
  reporting.
- **Privacy:** media stays local by default; transcription/beat analysis run
  locally where feasible, or via a clearly-disclosed service the user opts into.
- **Accessibility:** keyboard-navigable timeline; readable contrast in dark theme.

---

## 12. Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Skeleton** | Tauri app, document model, command bus, empty timeline UI | Create/save/load `.ocean`; add a track; round-trip test passes |
| **M1 — Manual editor** | Import, timeline clip/trim/split/move, multi-track, transform, text+fonts, audio add/clip, preview compositor | Hand-edit a 2-track video+audio clip and play it back accurately |
| **M2 — Export** | Render pipeline matching preview contract; presets; pre-flight validation | Frame-accurate 1080p MP4 export of an M1 project; no crash on edge cases |
| **M3 — MCP core** | MCP server, read/awareness tools, gesture edit tools, generated system prompt, one-click install | Agent builds the M1 project from a prompt via MCP; install test passes |
| **M4 — Media intelligence** | Beat detection, transcription (paged+cached), captions, suggest_cuts, canvas layout, frame capture | Anchor use cases §3.1.1–3.1.4 succeed end-to-end |
| **M5 — Token & polish** | Windowing, diff outputs, storyboard, image budget; UI polish vs. palmier reference | Anchor edit < 60k tokens (§7 metric); UX pass |

---

## 13. Open Questions & v2 Hooks

- **Local vs. cloud audio AI:** which transcription/beat models run locally
  (Whisper-class on-device?) vs. via a service? Affects privacy + token/cost story.
- **Compositor:** PixiJS to start vs. custom WebGPU renderer — decide at M1 based on
  multi-track 4K perf.
- **Generative media (v2):** text-to-image/video/music tools (`generate_*`), an AI
  "swap media" flow, and a generation panel. Document model already tags
  asset provenance to slot this in.
- **Hosted agent proxy (v2):** for users without their own API keys.
- **Collaboration / cloud projects (post-v2).**
- **Mobile preview/companion (post-v2).**

---

## 14. Appendix — Naming

Tools, the document model glossary, and the `.ocean` bundle format should be
versioned together; the MCP `describe_capabilities` output is the contract surface
agents depend on. Breaking changes to tool schemas require a version bump and a
migration note (avoids the "tool reference drift" failure mode).
