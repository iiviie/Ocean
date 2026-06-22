# Ocean Roadmap — Editing, Properties & Perception

> The single sequenced plan. Pulls together [`TOOLING_PLAN.md`](./TOOLING_PLAN.md) (capability gaps), [`PROPERTY_MODEL.md`](./PROPERTY_MODEL.md) (the fundamentals an agent manipulates), and [`PERCEPTION_LAYER.md`](./PERCEPTION_LAYER.md) (media → text). Check items off here; flip the matching status in the source doc.

Legend: `[x]` done · `[~]` in progress · `[ ]` todo · ◆ needs a decision (see §Decisions).

There are two parallel workstreams. **A — Manipulation** (what the agent can change) and **B — Perception** (what the agent can understand). They share the command-bus + lockstep-MCP discipline and can progress independently; an agent that can both *see* and *act* is the goal where they meet.

---

## A. Manipulation workstream

### A0 — Parity foundations ✅ (done this pass)
- [x] `set_track` command + tool (name/enabled/locked/opacity/volume) — `commands.ts`, `tools.ts`, `server.ts`
- [x] `set_canvas` tool over the existing command (width/height/fps/backgroundColor)
- [x] `set_text` forwards `lineHeight` (was dropped)
- [x] Design docs: property model, perception layer, tooling plan

### A1 — Finish basic property coverage (high ROI, mostly small)
- [x] **Audio-aware `set_fade`** — extracted `fadeGain()` (`src/model/fades.ts`); applied to opacity (visual), audio-clip volume (`audio.ts`), and a video clip's own sound (`PreviewVideo`). One tool fades any clip kind. Envelope math verified.
- [x] **`set_color`** — brightness/contrast/saturation/hue + named filter presets (grayscale/sepia/invert/vintage). `Clip.color` → CSS `filter` on the media element in `PreviewCanvas`. Filter-string math verified. *(temp/tint/exposure/LUT still ➕)*
- [ ] **`set_pan`** — stereo pan via Web Audio `StereoPannerNode` in `audio.ts` (`el.volume` path is mono today). *(§2.5)*
- [x] **Extended typography** on `set_text` — `fontWeight`, `italic`, `letterSpacing`, `backgroundColor` (plate), `strokeColor`/`strokeWidth`. Rendered in `PreviewCanvas`. *(configurable text shadow + vertical-align still ➕)*
- [x] **`set_style`** — appearance/compositing: `blendMode` (CSS `mix-blend-mode`), `cornerRadius`, `border`, `shadow`. Applied to the media element in `PreviewCanvas`. *(§2.3)*
- [ ] **UI controls** for `set_track` (lane header: mute/hide/lock) and `set_canvas` (Format panel becomes editable) — `Timeline.tsx`, `Inspector.tsx`. *(humans get the same powers as the agent)*

### A2 — Animation
- [ ] **Keyframes** — `add_keyframe` / `remove_keyframe` / `clear_keyframes` commands + tools, AND interpolation in `PreviewCanvas` (the array is dead today — both authoring and playback are missing). Decide easing/interp model first. ◆ *(`PROPERTY_MODEL.md §2.7`)*
- [ ] **Transitions** — built-in in/out (fade/slide/wipe) + clip-overlap crossfade. ◆

### A3 — Convenience & robustness
- [x] **Multi-client MCP bridge** — singleton broker (`mcp/bridge.ts`) owns the port; UI + all adapters are clients; N agents/clients drive one UI concurrently (was: only one at a time, port-bind race). Auto-spawned, self-healing, durable. Verified.
- [x] `get_frame(assetId, atSec)` — source-asset frame → existing `{image:"data:..."}` MCP image block. *(composited-timeline frame at a playhead time — rendering all clips at t — is still TODO; needs canvas capture)*
- [ ] `duplicate_clip`, `set_range` tool, optional ephemerals (`set_playing`, `select_asset`, `set_zoom`)
- [ ] **MCP catalog auto-publish** — UI emits its live tool registry on WS connect; `mcp/server.ts` stops hand-mirroring schemas. Kills the lockstep-drift risk. *(do before the surface grows much more)* ◆

### A4 — Export (separate, largest)
- [ ] ◆ **Render/encode pipeline** — ffmpeg in Electron main; `export_video({fromSec?,toSec?,path?,preset?})` with async job + progress (beats the 10s MCP timeout). No encode path exists anywhere today; this is what makes Ocean actually *produce* a video. *(`TOOLING_PLAN.md` P0-export)*

---

## B. Perception workstream  *(`PERCEPTION_LAYER.md`)*

### B0 — Plumbing ✅ (done this pass)
- [x] `fileIdentity` (head+tail+size sha256, 128-bit) computed in the Electron probe path → `addAsset`
- [x] `set_asset_analysis` command + applier (handles onto `MediaAsset.analysis`)
- [x] Out-of-band cache `userData/analysis/<hash>/<kind>.json` + read/write helpers (chose Electron `userData` over `~/.ocean`)
- [x] `analyze_media` + `get_analysis_status` async job tools (start + poll; in both catalogs). Cache-first (re-analysis is a no-op).

### B1 — MVP perception (highest ROI, light deps)
- [x] **Shots** via ffmpeg `select=gt(scene,0.4)`+`showinfo` → `get_shots` (windowed, capped 60). Verified on ffmpeg 8.1.1. *(motion bucket + representative frames deferred — timing only for now)*
- [x] **Transcript** (segment layer) via faster-whisper (`whisper-ctranslate2`) → openai-whisper fallback → `get_transcript`. **Verified end-to-end**: espeak speech → whisper base → exact transcript parsed (`language:en`, segment timings). Backend-availability check reports `unavailable` when none installed.
- [x] **Silence** via ffmpeg `silencedetect` (-30dB, ≥0.5s) → `get_silence`. Verified on ffmpeg 8.1.1. *(speech/music classification + `get_media_summary` still to do)*
- [ ] Spatial faces (MediaPipe in renderer Worker) → protect/safe/suggest-caption rects → `get_shot_layout`
- [x] `get_frame` escape hatch (shared with A3) — source-asset frame grab via ffmpeg → image block. Verified.

### B2 — Richer perception
- [ ] Shot captions (local VLM, opt-in) → fills `get_shots.caption` ◆
- [ ] Beats/tempo/energy/sections (librosa + pyloudnorm, pinned Python sidecar) → `get_audio`; commit beats to `Project.markers[]`
- [ ] Object detection + tracking (permissive RT-DETR/YOLOX + ByteTrack-in-JS)
- [ ] Word-level transcript (WhisperX, gated to flagged segments)

### B3 — Refinements (prove need first)
- [ ] Scene clustering, active-speaker, diarization (multi-speaker only), optical-flow camera motion, cross-shot identity merge

---

## Suggested execution order

1. **A1 basic property coverage** + **B0 perception plumbing** — both unblock large surfaces, low risk, no GPU. Run in parallel (different files).
2. **B1 MVP perception** — the agent gains *understanding* (shots/transcript/faces).
3. **A3 auto-publish catalog** — before the tool surface grows further.
4. **A2 animation** + **B2 richer perception** — depth.
5. **A4 export** — last, its own design + async-job infra.

**Definition of "basic editor done":** A0 + A1 + A3(get_frame) + A4(export). After that an agent can import, arrange, style, animate lightly, *see* a frame, and *produce* a file.

---

## Decisions needed (◆ blockers for the marked items)

1. **Keyframe/interp model** — which props animatable (start: the existing `KeyframeProp` set), easing set, and per-clip vs per-property tracks. Blocks A2.
2. **Export** — target container/codec defaults & presets; sync-with-progress vs fire-and-poll job model; where ffmpeg binary ships. Blocks A4.
3. **VLM bundling** — ship weights / download-on-first-run / remote-only for shot captions. Blocks B2 captions.
4. **Catalog auto-publish format** — adopt now (small) vs after A1/A2 land. Affects A3 timing.
5. **Color/style scope** — minimal (brightness/contrast/saturation) vs full grade (hue/temp/exposure/LUT). Sets A1 `set_color` size.
