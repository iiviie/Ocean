# Perception Layer — Extracting Understanding into Compact Text

> Status: design proposal. Companion to [`TOOLING_PLAN.md`](./TOOLING_PLAN.md). Grounded in the live data model (`src/model/types.ts`), the command bus (`src/model/commands.ts` + `src/model/store.ts`), the agent bridge (`src/agent/bridge.ts`), the MCP catalog (`mcp/server.ts`), and the tick model (`src/model/time.ts`).

## 0. The one principle

**The agent reasons over TEXT, not pixels.** Everything Ocean perceives about source media — what it's about, where the cuts are, where the beat drops, where the faces sit on the canvas — must serialize into compact, timeline-aligned text that an LLM reads and re-reads cheaply. Frames are an expensive, opt-in escape hatch used only at genuinely ambiguous decision points, never as the default scan surface.

This is not a stylistic preference. It is forced by economics and by evidence:

- **Token cost.** A single un-resized frame costs up to 1568 vision tokens (4784 on Opus-class models). A 50-shot video dumped at one frame per shot is ~10–11k tokens *before the agent does anything*. The same 50 shots as a serialized line list is ~1.5–2k tokens and is re-readable across the whole session. Dumping frames does not scale to a 1-hour podcast.
- **Empirical.** Vamos (arXiv 2311.13627) found text-based video representations achieve competitive performance on video reasoning while visual-embedding fusion gives "marginal or no" improvement in the LLM era. video-use's editing skill is explicit: "reason over text, not pixels… not a scan tool."
- **Architecture fit.** Ocean already lives this ethos: `get_timeline` is windowed, `get_canvas_layout` emits sparse `overlaps[]`, floats are `round2`'d, `recent()` is paged. The perception layer extends the *same* discipline downward into media-detail.

The corollary: vision (rendering a frame for the model to look at) remains available via the existing `{image: "data:..."}` → image-block plumbing in `mcp/server.ts`, but it is the last resort, not the substrate.

---

## 1. Where perception lives in the data model

### 1.1 The asset is the home of perception

Perception facts (transcript, shots, beats, energy, spatial tracks) are **intrinsic to the source file** — independent of where, how often, or at what speed a clip places that file on the timeline. They therefore attach to `MediaAsset`, never to `Clip` and (almost) never to `Project`.

The model already provisioned this exact slot and it is currently **dead code** — `MediaAsset.analysis` (`types.ts:37–42`) is never written or read anywhere in the codebase, and `addAsset` (`src/agent/tools.ts`) drops `analysis`/`fileIdentity`/`colorInfo` on import. The perception layer wakes it up.

```ts
// types.ts — extend the existing analysis slot. These are REFERENCE HANDLES, not payloads.
analysis?: {
  // each handle is a cache key into the out-of-band store (see §1.3).
  // null/absent = not yet computed; "pending:<jobId>" = in flight; a hash string = ready.
  shotsRef?: string;        // shot segmentation + per-shot captions + spatial summary
  transcriptRef?: string;   // speech transcript (segment + word layers)        [exists]
  beatsRef?: string;        // beat grid + tempo + energy + sections + silence    [exists]
  audioClassRef?: string;   // speech/music/sfx/silence segmentation
  spatialRef?: string;      // per-shot per-entity tracked boxes + protect zones
  storyboardRef?: string;   // representative keyframe thumbnails (paths)        [exists]
  // bookkeeping
  schemaVersion?: number;   // bump to invalidate caches on format changes
  analyzedAt?: number;      // epoch ms
};
```

**Why handles, not inline payloads.** Per PRD §7.4 ("cache + reference, don't re-send") and §8.4 (paging), the document model stays small and serializable. The heavy artifacts (full transcript, beat arrays, per-frame box tracks) live **out of band, keyed by `fileIdentity`**, and are fetched windowed/paged by the read tools. Inlining a 1-hour transcript into the Zustand document would bloat every save, every undo snapshot, and every `get_project`.

### 1.2 `fileIdentity` is the cache key — and it must be populated

The cache must key on **content**, not on the ephemeral asset id (`a3`), so analysis survives re-import, save/load, and asset-id churn. `FileIdentity{hash,size,mtime}` (`types.ts:12`) exists for this but is a "placeholder until Rust core wires real hashing" and is never populated.

**Required plumbing change (MVP blocker):** extend the Electron probe path (`electron/main.ts` `probe()` → `render.ts` `ProbeInfo` → `addAsset`) to compute `fileIdentity` at import:

- `size`/`mtime` from `fs.stat` — free.
- `hash` = SHA-256 of the first 1 MiB + last 1 MiB + `size` (a cheap "partial hash"). Full-file hashing a 4 GB video at import is too slow; a head+tail+size partial is collision-safe enough for a local cache key and is sub-100 ms.

Until Rust lands real hashing, this partial hash is the interim key. The cache directory is therefore `~/.ocean/cache/<hash>/{shots,transcript,beats,...}.json`.

### 1.3 The out-of-band cache

```
~/.ocean/cache/
  <fileIdentity.hash>/
    meta.json            # { schemaVersion, analyzedAt, duration, fps, hasAudio }
    shots.json           # shot list + captions + per-shot spatial summary
    transcript.json      # { segments:[...], words:[...] }  (two layers, §3.2)
    beats.json           # tempo, beats, downbeats, energy bins, sections, silence
    audioclass.json      # speech/music/sfx/silence spans
    spatial.json         # per-shot entities, keyframed boxes (dense numeric cache)
    storyboard/0001.jpg  # representative frames, <=512px
```

The `analysis.*Ref` string stored on the asset is simply the `fileIdentity.hash` (or `hash#shots` etc.) — enough for a tool to locate the file. This is the **lightweight identifier / progressive-disclosure** pattern Anthropic's context-engineering guidance endorses: the overview tool hands out ids; detail tools resolve them on demand.

### 1.4 What the Clip and Project hold (and what they don't)

- **Clip:** holds nothing perceptual. The transcript words / beats / shots that fall inside a clip's `[sourceIn, sourceOut)` at its `speed` are a **derived-on-demand projection**, computed by a selector when a tool asks, never persisted. This also automatically handles the linked audio clip created on video import (`commands.ts`) — both halves share one `assetId`, hence one analysis.
- **Project:** holds perception only when it has been *placed on the timeline as an authored decision*. The clear case is **beat markers**: `detect_beats` produces beat times that the agent may commit to `Project.markers[]` (`Marker.kind "beat"|"downbeat"`) via the existing `add_marker` command. That is project-scoped because a marker is a positioned timeline object, distinct from the cached beat *analysis* on the asset. Section boundaries can likewise be committed as `kind:"chapter"` markers.

### 1.5 New command: writing analysis handles

There is **no command today** to write `MediaAsset.analysis` — the `Command` union in `commands.ts` has nothing for it, and direct mutation would bypass Immer/re-render and violate PRD §6.5. Add one typed command:

```ts
// commands.ts — Command union
| { type: "set_asset_analysis"; assetId: string; patch: Partial<NonNullable<MediaAsset["analysis"]>> }
```

`applyCommand` merges `patch` into `asset.analysis` inside `produce()`. This is dispatched (with `source:"agent"` or `"system"`) when an analysis job completes. Beat markers continue to use the existing `add_marker` path.

---

## 2. The extraction pipeline

### 2.1 Topology: Electron main spawns a pinned Python sidecar; renderer does light CV

```
import_media  ──▶  probe (ffprobe, fast, sync) ──▶ asset w/ fileIdentity
      │
      └─▶ enqueue analysis JOB (async, see §2.4)
              │
   ┌──────────┼─────────────────────────────────────────────┐
   ▼          ▼                                               ▼
 ffmpeg     Python perception sidecar                   renderer Worker
 (shots,    (librosa beats/energy/sections,             (MediaPipe face,
  frames,    faster-whisper transcript,                  ONNX detect+track,
  scdet      pyloudnorm LUFS, silence,                   onnxruntime-web)
  mafd)      inaSpeechSegmenter speech/music)            [spatial — §6]
   │          │                                               │
   └──────────┴──────────────▶  ~/.ocean/cache/<hash>/  ◀─────┘
                                       │
                          set_asset_analysis(handles)  (command bus)
```

**Native analysis is Electron-only.** ffmpeg/ffprobe are reachable only when `inElectron` (`render.ts:27`). Every perception tool that touches ffmpeg/Python must guard on `inElectron` and throw a clear error in browser dev (mirror the `import_media` pattern in `tools.ts`). Spatial detection (§6) is the exception — it runs in a renderer Worker via `onnxruntime-web`/MediaPipe and works in both environments.

**Why a pinned Python sidecar.** The verified audio stack (librosa) has a hard `numba` dependency that constrains `numpy<2.1` and lags new CPython — this is *not* a casual `pip install`. Ship a **version-pinned, isolated interpreter** (e.g. a frozen venv or PyInstaller bundle) bundled with the Electron app, invoked as a subprocess that reads a job spec on stdin and writes JSON to the cache. This isolates the legacy numpy pin from everything else and keeps the analysis off the UI thread.

### 2.2 Tool/library choices per dimension (the verified best-bets)

| Dimension | MVP tool | Where | Upgrade path (later) |
|---|---|---|---|
| **Shot boundaries** | `ffmpeg -vf scdet=threshold=10,metadata=print` — parse `lavfi.scd.time` from metadata output (NOT raw stderr). Zero extra deps; ffmpeg-static is already bundled. | Electron main | PySceneDetect `ContentDetector`/`AdaptiveDetector` when scdet over/under-segments; TransNetV2 (ONNX) only if dissolves/fast cuts prove to matter. |
| **Motion label** | Bucket `lavfi.scd.mafd` (already computed by scdet) into `static\|slow\|fast`. ~1–2 tokens/shot, essentially free. | Electron main | OpenCV optical-flow pan/tilt/zoom (research-grade, slowest CV step — defer). |
| **Representative frames** | `ffmpeg -ss <mid_ts> -i in -frames:v 1 -vf scale=512:-1` — 1 frame/static shot, 3/high-motion. `scale=512` is the single biggest token lever (209 tok vs up to 4784). | Electron main | — |
| **Per-shot caption** | Local Qwen2.5-VL-7B via Ollama, multi-image prompt, hard "≤15 words, no preamble". Free, on-device. | Local VLM (opt-in) | Remote Claude vision as higher-quality opt-in. |
| **Transcript (ASR)** | **faster-whisper** (CTranslate2, int8 on CPU), `word_timestamps=True`. 4× faster than vanilla Whisper, segment+word output. | Python sidecar | WhisperX wav2vec2 forced alignment for ~50 ms word timing, **gated to edit-flagged segments only**; pin a known-good version (post-3.3.3 alignment regressions confirmed; numbers/symbols mistimed). |
| **Speech VAD / silence** | **Silero VAD** (~2 MB, MIT, sub-ms/chunk). Speech regions → silence = complement. | Python sidecar | — |
| **Speech vs music vs sfx** | **inaSpeechSegmenter** `smn` engine → `(label,start,end)`. Parallel track, *not* embedded in transcript. | Python sidecar | CLAP zero-shot for custom sfx vocab (applause/laughter), windowed+merged. |
| **Beats / tempo** | **librosa** `beat_track(units='time')` + `plp`. | Python sidecar | madmom downbeats/meter — only in an *isolated* py3.8/numpy1.19 sidecar (effectively unmaintained); avoid in main env. |
| **Energy / loudness** | librosa `feature.rms` (relative sparkline) + **pyloudnorm** integrated LUFS + per-section short-term LUFS. | Python sidecar | — |
| **Onsets** | librosa `onset_detect` / `onset_strength`. | Python sidecar | aubio only as a batch-speed optimization (source-only sdist, needs C compiler — not worth it for MVP). |
| **Structural sections** | librosa-native boundary detection (`segment` foote/recurrence) + heuristic naming (position + relative energy → intro/verse/chorus) with an explicit `confidence`. | Python sidecar | MSAF boundaries — but it's ~3 yrs stale (py2.7–3.6); prefer reimplementing the small boundary step on librosa. |
| **Speaker diarization** | **Skip** for single-speaker (cheap speaker-change heuristic). | Python sidecar | pyannote 3.1 (HF-gated, GPU-preferred) only when `n_speakers>1`. |

**Licensing guardrails (load-bearing for a shippable product):**
- **Do NOT ship Ultralytics YOLO** (AGPL-3.0 — forces open-sourcing the whole app or an Enterprise license, explicitly including on-device commercial use). Use a **permissive** detector: RT-DETR or YOLOX (Apache-2.0) for §6.
- **Do NOT ship CrisperWhisper as default** (CC BY-NC 4.0, NonCommercial). It is the *correct* engine for filler-word editing, but only as a clearly-licensed opt-in or replaced by a lightweight filler classifier over Silero regions. Note plain Whisper/faster-whisper **normalizes away "um/uh" by design** — do not promise filler editing on a plain-Whisper transcript.
- **essentia** has no Windows wheel — keep optional/Linux-mac only; librosa spectral features cover the same brightness/texture need cross-platform.

### 2.3 Branch on content before analyzing

A beat grid on a dialogue track is garbage. Before emitting, run the cheap speech-vs-music check (inaSpeechSegmenter `smn` or a Silero-coverage heuristic):

- **Speech-dominant** → emit transcript + silence spans + LUFS + coarse energy. Skip beats/tempo/sections.
- **Music-dominant** → emit beats/tempo/energy/sections + silence + LUFS. Transcript optional (lyrics low value).
- **Mixed** → both, with section labels noting bed vs voice.

### 2.4 Job semantics — the 10 s MCP timeout forces async

`invokeUI` in `mcp/server.ts` rejects after **10 s**. Beat detection, transcription, and frame extraction all exceed this on real media. Perception tools therefore **must not block** on analysis. The model:

1. `analyze_media(assetId, kinds?)` → enqueues a job, returns `{ jobId, status:"pending" }` **immediately** (well under 10 s).
2. `get_analysis_status(assetId)` → `{ shots:"ready", transcript:"pending", beats:"ready", spatial:"none" }`. Cheap poll.
3. Detail read tools (`get_shots`, `get_transcript`, …) return `{status:"pending", jobId}` if not ready, or the windowed payload if ready.

On completion the sidecar/main dispatches `set_asset_analysis` so handles land on the asset and the UI re-renders (showing an "analyzed" badge). Analysis is **cache-first**: if `~/.ocean/cache/<hash>/shots.json` exists and `schemaVersion` matches, the job is a no-op and status is `ready` instantly. Import auto-enqueues a cheap default set (shots + silence + speech/music class); transcript/beats/spatial are enqueued on first request or by user action, to keep import snappy.

### 2.5 Sync vs async summary

| Step | When | Sync? | Cost |
|---|---|---|---|
| ffprobe metadata + fileIdentity | import | sync | <100 ms |
| scdet shots + mafd | import (auto) | async job | seconds |
| speech/music class + silence | import (auto) | async job | seconds |
| transcript | on request | async job | ~realtime/×4 (faster-whisper int8) |
| beats/energy/sections | on request (music) | async job | seconds–minutes |
| spatial (face/object tracks) | on request | async job (renderer Worker, 5–10 fps sampled) | seconds–minutes |
| representative frame caption | with shots | async, opt-in VLM | seconds |
| single frame for the model | tool call | sync, <10 s | ms |

---

## 3. Text serialization schemas (the actual text the LLM sees)

Design rules across all schemas:
- **Header-once columnar** (TOON/TSV-style `name[count]{cols}:` then bare rows) **only for long uniform arrays** (shots, cues, beats, energy bins, boxes). Verified ~30–60% token cut vs JSON on uniform arrays; for very flat rows plain TSV may beat TOON — benchmark per tool. Small fixed-shape objects stay plain JSON.
- **Seconds, `round2`** in all agent-facing output; integer ticks (`secondsToTicks`) live only in the engine/commands. Frame-accurate handles are retrievable by id, not shown.
- **Stable ids** (`shot 0`, `seg 12`, `ent f0`) that survive reordering, so the agent can reference and the engine can resolve.
- **Sparse events, never per-frame/per-sample dumps.**

### 3.1 Shots — `get_shots`

What it answers: *what is the video about, how many shots, how long each, how they relate.*

```
video a3 "interview-final.mp4" — 00:00–02:14 (134.2s), 24fps, 18 shots, motion mostly static
shots[18]{idx,start,end,dur,motion,scale,caption}:
0  0.00  4.20  4.20  static  WS  "wide office, two people seated at desk by window"
1  4.20  9.85  5.65  static  MS  "host on left, mid-shot, gesturing"
2  9.85 10.40  0.55  fast    --  "quick cutaway, hands on keyboard"
3 10.40 21.10 10.70  slow    CU  "guest close-up, speaking to camera"
4 21.10 24.00  2.90  static  MS  "two-shot, both subjects facing each other"
...
scenes[3]{id,shots,label}:        # optional v2 clustering
A  0,1,4   "office two-shot setup"
B  3,7,9   "guest CU coverage"
C  2,12    "b-roll cutaways"
```

- `motion` from mafd bucket; `scale` (WS/MS/CU/ECS) derived for free from largest face/person bbox area fraction (§6), `--` when unknown.
- `caption` is one VLM line per shot (≤15 words). This is the *what-is-it-about* signal.
- `scenes[]` is the v2 CLIP-clustering layer — omitted in MVP.
- **Token budget:** ~30–45 tokens/shot → an 18-shot clip ≈ 700 tokens; a 50-shot clip ≈ 1.8k. Re-readable all session.

### 3.2 Transcript — `get_transcript` (two layers)

What it answers: *what is being said, when, by whom.*

**Default = segment layer** (sentence/turn granularity). Word layer fetched lazily only for edit-flagged segments (word-level multiplies tokens ~5–10×).

```
transcript a3 — 12 segments, 1 speaker, lang en, 96% speech coverage
segments[12]{id,spk,start,end,text}:
0  S0  1.20   5.80  "So the core idea behind Ocean is that the agent edits through text."
1  S0  6.10  11.45  "We never make the model stare at raw pixels to figure out what to cut."
2  S0 11.45 11.90  "[pause]"
3  S0 11.90 18.20  "Every shot, every beat, every face — it's all serialized into lines."
...
```

Word layer (only when the agent calls `get_transcript(assetId, segId, granularity:"word")`):

```
seg 3 words[14]{w,start,end}:
"Every" 11.90 12.08 | "shot," 12.08 12.41 | "every" 12.55 12.78 | ...
```

- `spk` is `S0/S1/…`; single-speaker clips just show `S0`.
- Filler tokens appear only if a verbatim engine (CrisperWhisper opt-in) was used — flag in `meta`.
- **Caveat surfaced to the agent:** word timings on numbers/currency/symbols are unreliable (confirmed WhisperX bug). The engine snaps cuts to the nearest *audio* word boundary, not the displayed float.
- **Token budget:** ~25–40 tokens/segment; a 30-min talk ≈ 200 segments ≈ 7k tokens at segment granularity. Word layer is opt-in per segment.

### 3.3 Beats / tempo / energy / sections / silence — `get_audio`

What it answers: *tempo, where beats and downbeats fall, energy highs/lows, structure, silence.*

```
audio a7 "track.wav" — 142.0s, 44.1k, MUSIC, tempo 124 BPM (4/4), LUFS -9.3 integrated
sections[4]{id,start,end,label,conf,lufs}:
0  0.00  16.00  intro   0.78  -14.1
1 16.00  48.00  build   0.71  -11.2
2 48.00  96.00  drop    0.88   -8.0
3 96.00 142.0   outro   0.69  -12.5
downbeats: 0.00 1.94 3.88 5.81 ... (every 1.94s, omitted past 8)
beats: 0.00 0.48 0.97 1.45 1.94 ... (offset by downbeat phase; full grid via get_audio mode=beats)
energy[1s bins, 0-9 normalized to peak]:
  111122334 455566778 999888777 666555444  ...
  ^0s        ^9s        ^18s       ^27s
events[2]{t,kind}:           # heuristic, derived from energy deltas
  48.00  drop
  96.00  breakdown
silence[1]{start,end}: 141.2 142.0
```

- The **energy sparkline** is the compact "highs and lows": 1 s bins, ordinal 0–9 normalized to peak. A multi-minute track is a few hundred chars.
- `beats`/`downbeats` are inherently sparse (1–4/s); truncate with a "full grid via mode=beats" pointer rather than dumping thousands.
- `sections` carry a `conf` field — section names are heuristic and must be presented as such, never as ground truth.
- For a **speech** asset this tool emits only `silence`, per-segment LUFS, and coarse energy (no beats/tempo/sections — see §2.3).
- **Token budget:** ~300–600 tokens for a full 3-min track. ~1 token/sec is the design target (validate against a real tokenizer before quoting).

### 3.4 Spatial layout over time — `get_shot_layout`

What it answers: *where is each subject/object on the canvas over time, so I can place captions/overlays without covering faces.*

This is the sparse, per-shot, per-entity **text summary** derived from the dense numeric track cache (§6). The LLM **never** sees per-frame boxes.

```
spatial a3 shots 1-4 (canvas 1920x1080, normalized 0-1, round2)
shot 1  4.20-9.85  entities[1]{id,kind,enter,exit,box@start,box@end}:
  f0  face  4.20  9.85  cx0.32 cy0.40 w0.14 h0.22   cx0.30 cy0.41 w0.14 h0.22
  protect: cx0.31 cy0.40 w0.20 h0.30          # union of faces, padded 1.4x
  safe: bottom-band cy0.82 h0.30 | top-band cy0.10 h0.16
  suggest caption: cx0.50 cy0.86 w0.80 h0.18  # largest safe rect clear of protect
shot 3 10.40-21.10  entities[1]{...}:
  f0  face 10.40 21.10  cx0.50 cy0.38 w0.30 h0.46   cx0.51 cy0.37 w0.30 h0.46
  protect: cx0.50 cy0.38 w0.40 h0.58
  safe: bottom-band cy0.85 h0.24
  suggest caption: cx0.50 cy0.88 w0.86 h0.14
```

- Boxes are **keyframed at shot boundaries** (start/end, plus a midpoint only if motion is high) — not per frame. Within a shot the box moves slowly, so 2–3 samples reconstruct the path.
- `protect` = padded union of face boxes (the don't-cover zone). `safe` = inverse bands. `suggest caption` = the largest safe rect clear of protect — the concrete output that lets the agent place a lower-third without covering a face.
- Entity ids (`f0`) are **shot-local** in MVP (ByteTrack ids reset across cuts). Cross-shot identity merging is a v2+ nicety.
- **Token budget:** ~40–70 tokens/shot. A 4-shot window ≈ 250 tokens.

---

## 4. New MCP / agent read tools (layered)

Same philosophy as `get_timeline`/`get_canvas_layout`: **cheap overview by default, detail-on-demand per time range, windowed and capped.**

### Layer 0 — overview (cheap, always safe)

| Tool | Returns | ~tokens |
|---|---|---|
| `get_media_summary(assetId)` | one-line per dimension: `shots:18 (134s) · speech 96% 1spk · MUSIC? no · spatial: 1 face track` + which `analysis.*Ref` are ready. | ~80 |
| `get_analysis_status(assetId)` | `{shots:"ready", transcript:"pending", beats:"none", spatial:"ready"}` | ~40 |

### Layer 1 — windowed lists (the workhorses)

All take an optional `fromSec`/`toSec` (default = small span around playhead), hard row caps, and append `{truncated:true, total:N, hint:"narrow range or page"}` when clipped.

| Tool | Args | Caps |
|---|---|---|
| `get_shots(assetId, fromSec?, toSec?)` | §3.1 | ≤60 shots |
| `get_transcript(assetId, fromSec?, toSec?, granularity?)` | §3.2; `granularity` default `segment` | ≤100 cues |
| `get_audio(assetId, fromSec?, toSec?, mode?)` | §3.3; `mode` ∈ `summary\|beats\|energy` | energy ≤200 bins, beats ≤200 |
| `get_shot_layout(assetId, fromSec?, toSec?)` | §3.4 | ≤30 shots |

### Layer 2 — detail-on-demand / vision escape hatch

| Tool | Args | Notes |
|---|---|---|
| `get_transcript(... granularity:"word", segId)` | per-word array for one flagged segment | lazy, §3.2 |
| `get_frame(assetId, atSec, maxPx?)` | renders one ≤512px frame → `{image:"data:..."}` | uses existing image-block plumbing (`server.ts`); **last resort** at ambiguous decision points only. Already on the `TOOLING_PLAN.md` P1 list — perception extends it to source assets. |
| `get_storyboard(assetId, fromSec?, toSec?)` | filmstrip of representative shot frames | one image block; capped count |

### Job-control tools

| Tool | Args |
|---|---|
| `analyze_media(assetId, kinds?)` | enqueue; returns `{jobId, status}` immediately |

**Drift discipline (PRD cross-cutting / `TOOLING_PLAN.md` §"prevent MCP drift"):** every new tool must be added to **both** `src/agent/tools.ts` (live registry the UI executes) **and** the `TOOLS` array in `mcp/server.ts`, kept in lockstep, until the UI publishes its catalog on connect. The in-process selectors land in `src/agent/bridge.ts` alongside `get_timeline`/`get_canvas_layout`.

---

## 5. Phased implementation plan

### Phase 0 — plumbing (MVP blocker, no perception yet)
1. Populate `fileIdentity` (partial hash) in the probe path; thread through `addAsset` (§1.2). *Without this there is no cache key.*
2. Add `set_asset_analysis` command + `applyCommand` handler (§1.5).
3. Stand up the out-of-band cache dir + read/write helpers keyed by hash (§1.3).
4. Add `analyze_media` + `get_analysis_status` job tools (async, beats the 10 s timeout) (§2.4). Register in both catalogs.

### Phase 1 — MVP perception (highest ROI, zero/light deps)
5. **Shots** via `scdet` + mafd motion bucket + representative-frame extraction; `get_shots` (no captions yet → `caption:"--"`). Pure ffmpeg, already bundled.
6. **Silence + speech/music class** via Silero VAD + inaSpeechSegmenter; feeds §2.3 branching and `get_media_summary`.
7. **Transcript (segment layer)** via faster-whisper int8; `get_transcript`. Single highest-leverage representation for dialogue.
8. **Spatial faces** via MediaPipe FaceDetector in a renderer Worker → protect/safe/suggest-caption rects; `get_shot_layout`. Lowest-risk path to "don't cover faces."
9. `get_frame` for source assets (escape hatch).

### Phase 2 — richer perception
10. **Shot captions** via local Qwen2.5-VL (opt-in) → fills `get_shots.caption`, answers "what is it about."
11. **Beats/tempo/energy/sections/silence** via librosa + pyloudnorm; `get_audio`; commit beats to `Project.markers[]` via `add_marker`.
12. **Object detection + tracking** (permissive RT-DETR/YOLOX ONNX + ByteTrack-in-JS) extending §6 beyond faces; shot-scale from bbox area.
13. Word-level transcript (WhisperX forced alignment, version-pinned, gated to flagged segments).

### Phase 3 — refinements (defer, prove the need first)
14. CLIP scene clustering → `scenes[]` in `get_shots`.
15. Active-speaker detection (TalkNet sidecar, with `speaker:offscreen` fallback) to label which face is talking.
16. pyannote diarization for multi-speaker only.
17. Optical-flow camera-motion classes; CLAP custom-vocab sfx tagging; cross-shot identity merge.
18. Remote Claude-vision captioning opt-in.

**MVP line:** Phases 0–1. Everything an agent needs to answer "what's it about / how many shots / what's said / where are the faces" with zero GPU and (mostly) only bundled ffmpeg + a pinned Python sidecar.

---

## 6. Spatial detection internals (the two-layer split)

The single most important spatial insight: **dense numeric cache for the renderer, sparse text summary for the LLM.**

- **Dense layer (on disk, never to the LLM):** MOTChallenge-style rows `frame,id,kind,x,y,w,h,conf` at sampled 5–10 fps, in `spatial.json`. A 10 s clip at 8 fps × 3 entities ≈ 720 rows. This drives auto-reframe/crop-follow/collision in the engine.
- **Sparse layer (to the LLM):** the per-shot, per-entity, keyframed-box summary of §3.4 — one block per shot.

**Pipeline (renderer Worker, `onnxruntime-web`):**
1. Decode sampled frames (5–10 fps — this is offline analysis, not live 30 fps preview; avoids the WebGPU-vs-WASM perf trap).
2. **MediaPipe FaceDetector** → normalized `[0,1]` bboxes (maps 1:1 onto Ocean's `centerX/centerY` normalized convention). This is the MVP backbone of "don't cover faces."
3. (Phase 2) **RT-DETR/YOLOX** (Apache-2.0) for COCO objects; **ByteTrack** association reimplemented in JS (the tracker logic doesn't export to ONNX — only the detector does) for persistent shot-local ids.
4. (Phase 3) **U²-Net (u2netp, 4.7 MB)** saliency fallback for b-roll/products/landscapes with no face or COCO class — reduced to one salient bbox per shot.
5. Smooth box paths (EMA), reduce to keyframes at shot boundaries, compute protect/safe/suggest-caption rects, write both layers.

Coordinates are normalized `[0,1]`, `round2`'d, exactly like `get_canvas_layout` — so spatial perception speaks the same language the agent already uses for placing clips.

---

## 7. Rejected approaches (and why)

| Rejected | Why |
|---|---|
| **Dump every frame / per-frame VLM captioning to the model** | Up to 1568–4784 tokens/frame; blows budget; doesn't scale to long media. Caption per *shot* with 1–3 ≤512px frames instead. This is the failure mode the whole layer exists to avoid. |
| **Per-frame box / per-sample audio serialization to the LLM** | A 10 s clip is hundreds of box rows; raw PCM is millions of samples. Use keyframed boxes + ordinal energy bins. Dense data stays in the on-disk cache only. |
| **Inline perception payloads in the document model** | Bloats every save/undo/`get_project`; violates PRD §7.4. Store handles on `MediaAsset.analysis`, payloads out-of-band keyed by `fileIdentity`. |
| **Store perception on the Clip** | Duplicates across the linked audio/video pair and across repeated placements; perception is intrinsic to the *source*. Derive clip slices on demand via a selector. |
| **TOON as the universal wire format** | Loses to plain JSON on small/nested objects and to TSV/CSV on flat tables. Use columnar *only* for long uniform arrays; keep `get_project`/detail objects as JSON. |
| **RAPTOR for "multi-resolution summaries"** | Research retrieval needing recursive embedding+clustering+LLM-summarization. Ocean's project→track→clip→shot→frame tree is already structural; the Layer 0/1/2 drill-down needs no clustering. Analogy only. |
| **Ultralytics YOLO** | AGPL-3.0 forces full source disclosure or an Enterprise license for a distributed commercial app. Use RT-DETR/YOLOX (Apache-2.0). |
| **CrisperWhisper as default ASR** | CC BY-NC 4.0 (NonCommercial) — cannot ship without a paid license. Opt-in only, clearly licensed. |
| **Filler-word editing on plain Whisper** | Whisper normalizes away "um/uh" by design — nothing to cut. Needs a verbatim engine or a separate classifier. |
| **TransNetV2 / madmom / essentia / BeatNet as MVP defaults** | TransNetV2: TF2.1 origin + GPU-leaning bundle + community-only ONNX. madmom: effectively unmaintained, frozen py3.8/numpy1.19. essentia: no Windows wheel. BeatNet: requires madmom + PyTorch for a real-time feature offline editing doesn't need. All opt-in upgrades, not baselines. |
| **Native temporal video input to local VLMs for motion fidelity** | Ollama/llama.cpp temporal sampling is still maturing; feed N stills and don't over-promise action understanding from the local path. |
| **ffmpeg-command generation (ELLMPEG-style) as the edit channel** | ~22% command error rate even with self-reflection; discards Ocean's inspectable command-bus state. Transcode/export side path at most. |
| **OTIO / CMX3600 as the LLM's working format** | Deliberately verbose / 999-event-capped. Export adapters only, never in-context. |
| **Mandatory pyannote diarization on every import** | GPU-preferred, HF-gated, degrades on overlap. Single-speaker dominates editor workloads — skip via a heuristic, invoke only when `n_speakers>1`. |
| **Synchronous (lazy-at-tool-call) heavy analysis** | ffmpeg/whisper synchronously inside a tool blows the 10 s MCP timeout and is non-deterministic. Async job + cache-by-`fileIdentity` is required. |

---

## 8. Rough token budgets (summary)

| Surface | Budget |
|---|---|
| `get_media_summary` | ~80 tok |
| `get_shots`, 18 shots | ~700 tok |
| `get_shots`, 50 shots | ~1.8k tok |
| `get_transcript` segment, 30-min talk | ~7k tok (windowed → far less in practice) |
| `get_transcript` word, one segment | ~150–400 tok |
| `get_audio` summary, 3-min track | ~300–600 tok |
| `get_shot_layout`, 4-shot window | ~250 tok |
| `get_frame` (≤512px) | ~209 vision tok |
| `get_frame` (un-resized — *avoid*) | up to 1568 / 4784 tok |

Target per PRD §7: an anchor edit stays **< 60k tokens**. Windowing + caps + columnar-on-long-arrays keep every detail tool well within that even on hour-long media — and crucially, the *text* representations are re-readable across the whole session, where frames are not.

---

## 9. Open questions to resolve in implementation

- **Hash strategy** until Rust core lands: confirm head+tail+size partial hash has acceptable collision risk for the local cache, or gate behind a full hash for files < some size.
- **Boundary reconciliation**: Silero speech edges vs wav2vec2 word edges vs inaSpeechSegmenter class edges vs scdet shot edges won't align. Define a canonical snapping order (shots authoritative for visual cuts; word boundaries authoritative for dialogue cuts).
- **Cache persistence across save/load**: handles are plain strings keyed by `fileIdentity`, so they survive — but verify once `.ocean` save/load actually lands (`store.loadProject` exists, no file format wired yet).
- **VLM bundling**: ship Qwen2.5-VL weights, download-on-first-run, or remote-only? Multi-GB download is unresolved.
- **Validate the ~1 token/sec audio figure** against a real tokenizer before quoting it anywhere user-facing.
