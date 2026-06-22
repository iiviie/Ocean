# Property Model — The Fundamentals an Agent Can Manipulate

> Status: design + living spec. Companion to [`TOOLING_PLAN.md`](./TOOLING_PLAN.md) and [`PERCEPTION_LAYER.md`](./PERCEPTION_LAYER.md). Grounded in `src/model/types.ts`, `src/model/commands.ts`, `src/agent/tools.ts`.

## Why this exists

An agent edits well only when it has a **coherent mental model of what each object _is_ and what can be done to it** — grouped, not scattered across 20 unrelated tool names. This doc defines, per object type, the **property groups** ("fundamentals") and their canonical names, units, and ranges.

Two audiences read it:
- **The agent** — so "what can I change on a text clip?" has one grouped answer (Temporal · Transform · Appearance · Typography · Animation) instead of a flat tool list.
- **The implementation** — it's the spec for the command bus, the `set_*` tools, and the perception/property read tools. Every property here maps to exactly one canonical command.

Legend: ✅ exists & wired · ⚠️ exists in the model but not exposed (or not consumed by the renderer — "dead") · ➕ proposed / not yet in the model.

---

## 1. Object types in Ocean

Ocean deliberately has **few** object types. A clip's *kind* follows its track (`TrackKind = "video" | "audio"`); a text clip is just a video-track clip with `text` set and no `assetId` (`types.ts`).

| Object | What it is | Backed by |
|---|---|---|
| **Video clip** | A trimmed window of a video asset, placed on a video track. Visual + (linked) audio. | `Clip` + `MediaAsset(kind:video)` |
| **Image clip** | A still placed for a duration. Visual only. | `Clip` + `MediaAsset(kind:image)` |
| **Text clip** | Synthetic title/caption. Visual only, no asset. | `Clip.text: TextProps` |
| **Audio clip** | A trimmed window of an audio asset (or the linked audio split off a video). | `Clip` on an audio track |
| **Track / layer** | A horizontal lane stacking clips (index 0 = bottom). | `Track` |
| **Canvas / project** | The composition: resolution, frame rate, background. | `Project.canvas` |
| *(Lottie clip)* | *Vector animation — kind exists in `MediaKind`, not yet a first-class clip.* | *future* |

---

## 2. Property groups (the buckets)

These are the reusable groups. Section 3 maps which groups each object type has.

### 2.1 Temporal — *when & how long*
Times are **seconds** at the agent boundary, **integer ticks** internally (`TIMEBASE=600`, `time.ts`).

| Property | Does | Range / unit | Status | Command |
|---|---|---|---|---|
| `timelineStart` | When the clip begins on the timeline | seconds ≥ 0 | ✅ | `move_clip` |
| `duration` | Clip length on the timeline (`timelineEnd − timelineStart`) | seconds > 0 | ✅ | derived (set via `add_clip`, `trim_clip`, `set_speed`) |
| `sourceIn` / `sourceOut` | Trim window into the source media | seconds | ✅ | `trim_clip` |
| `speed` | Retime factor (2 = 2× faster) | > 0 (clamped ≥ 0.1) | ✅ | `set_speed` |
| `reverse` | Play the source backwards | bool | ➕ | `set_speed{reverse}` (proposed) |

### 2.2 Transform — *where, how big, orientation*
Center-anchored, resolution-independent. See `Transform` (`types.ts:49`).

| Property | Does | Range / unit | Status | Command |
|---|---|---|---|---|
| `centerX` / `centerY` | Position of the clip's center on the canvas | normalized 0..1 (0.5 = center) | ✅ | `set_transform` |
| `scale` | Uniform scale (1 = natural fit) | > 0 (UI 0.1..4) | ✅ | `set_transform` |
| `rotation` | Rotation, clockwise | degrees −180..180 | ✅ | `set_transform` |
| `flipH` / `flipV` | Mirror horizontally / vertically | bool | ✅ rendered (`PreviewCanvas`); settable; no UI control | `set_transform` |
| `fit` | How media fills its box (cover/contain/fill/none) | enum | ➕ | `set_transform{fit}` (proposed) |
| `crop` | Inset crop (top/right/bottom/left) | normalized 0..1 each | ➕ | `set_transform{crop}` (proposed) |
| `anchor` | Override the transform anchor point | normalized 0..1 | ➕ | proposed |

### 2.3 Appearance / Compositing — *how it blends*
| Property | Does | Range / unit | Status | Command |
|---|---|---|---|---|
| `opacity` | Clip transparency | 0..1 | ✅ | `set_opacity` |
| `opacityFadeIn` / `opacityFadeOut` | Visual fade durations | seconds | ✅ | `set_fade` |
| `blendMode` | Compositing mode (normal/screen/multiply/add/overlay…) | enum | ➕ | `set_blend` (proposed) |
| `cornerRadius` | Rounded corners | normalized / px | ➕ | proposed |
| `border` | Stroke (width + color) | px + hex | ➕ | proposed |
| `shadow` | Drop shadow (offset/blur/color) | px + hex | ➕ | proposed |

### 2.4 Color correction — *the look* (video / image)
Core grade + named looks ship via the **`set_color`** command + tool (✅), applied as a CSS `filter` on the media element. Advanced grading is still ➕.

| Property | Does | Range / unit | Status |
|---|---|---|---|
| `brightness` | Lift overall luminance | −1..1 (0 = none) | ✅ `set_color` |
| `contrast` | Tonal spread | −1..1 | ✅ `set_color` |
| `saturation` | Color intensity | 0..2 (1 = none) | ✅ `set_color` |
| `hue` | Hue rotation | degrees −180..180 | ✅ `set_color` |
| `filter` | Named one-shot look | none/grayscale/sepia/invert/vintage | ✅ `set_color` |
| `temperature` / `tint` | White balance warm/cool, green/magenta | −1..1 | ➕ |
| `exposure` / `gamma` | Stops / midtone curve | stops / 0.1..3 | ➕ |
| `lut` | 3D LUT reference | asset/file ref | ➕ (advanced) |

### 2.5 Audio — *sound* (video w/ audio, audio clips)
| Property | Does | Range / unit | Status | Command |
|---|---|---|---|---|
| `volume` | Clip gain | 0..1 (≈ −∞..0 dB) | ✅ | `set_volume` |
| `mute` | Silence without losing the level | bool | ⚠️ (do via `volume:0` today) | `set_volume` |
| fade in/out | **Volume** fades | seconds | ✅ `set_fade` is channel-aware (volume for audio, opacity for visual) | `set_fade` |
| `pan` | Stereo placement | −1 (L) .. 1 (R) | ➕ | `set_pan` (proposed) |

> **Fade is one envelope, two channels.** `set_fade` stores a duration in `opacityFadeIn/Out`; the renderer applies it as opacity on visual clips and as volume on audio clips (and a video clip's own sound) via the shared `fadeGain()` helper (`src/model/fades.ts`). So "fade out the music" and "fade in the title" are the same tool.

### 2.6 Typography — *text styling* (text clips only)
See `TextProps` (`types.ts:69`).

| Property | Does | Range / unit | Status | Command |
|---|---|---|---|---|
| `content` | The string | text | ✅ | `set_text` |
| `fontName` | Font family | string | ✅ | `set_text` |
| `fontSize` | Size in canvas px | px (UI 12..300) | ✅ | `set_text` |
| `color` | Fill color | hex / rgba | ✅ | `set_text` |
| `align` | Horizontal alignment | left/center/right | ✅ | `set_text` |
| `lineHeight` | Leading multiplier | × (e.g. 1.2) | ✅ rendered; settable via `set_text`; no UI control | `set_text` |
| `fontWeight` | Weight | 100..900 | ✅ | `set_text` |
| `italic` | Italic style | bool | ✅ | `set_text` |
| `letterSpacing` | Tracking | px (canvas) | ✅ | `set_text` |
| `backgroundColor` | Text box fill (lower-third plate) | hex / rgba | ✅ | `set_text` |
| `strokeColor` / `strokeWidth` | Outline (color + width) | hex + px | ✅ | `set_text` |
| `shadow` | Text shadow | px + hex | ⚠️ hardcoded (not yet configurable) | `set_text` |
| `verticalAlign` / `maxWidth` | Box vertical align / wrap width | enum / normalized | ➕ | `set_text` |

### 2.7 Animation — *change over time* (cross-cutting)
Any numeric Transform/Appearance property can be keyframed. `Keyframe`/`KeyframeProp` exist (`types.ts:87-100`) for `centerX|centerY|scale|rotation|opacity`, but there is **no command to author keyframes** and the renderer never reads the array (verified — no interpolation logic exists anywhere) — so the group is ⚠️ **dead** today. Authoring keyframes *and* wiring interpolation into `PreviewCanvas` are both required to light this up.

| Concept | Does | Status | Command |
|---|---|---|---|
| Keyframe | (prop, atTicks, value, easing) on a clip | ⚠️ model only | `add_keyframe` / `remove_keyframe` / `clear_keyframes` (➕) |
| Transition in/out | Built-in fade/slide/wipe at clip edges | ➕ | `set_transition` (➕); crossfade ties to `add_clip` overlap |

### 2.8 Track-level — *lane controls*
See `Track` (`types.ts:127`). All mutated via the **`set_track`** command + tool (✅ shipped).

| Property | Does | Range / unit | Status |
|---|---|---|---|
| `name` | Lane label | string | ✅ settable via `set_track` |
| `enabled` | Show/hear the lane (hide video / mute audio) | bool | ✅ rendered (`audio.ts`, `selectors.ts`) + settable |
| `locked` | Prevent edits | bool | ✅ settable; ⚠️ **not yet enforced** in UI/edits |
| `opacity` | Track-level opacity (video lanes) | 0..1 | ✅ settable; ⚠️ **not yet consumed** by renderer |
| `volume` | Track-level gain (audio lanes) | 0..1 | ✅ rendered (`audio.ts`: `clip.volume × track.volume`) + settable |

### 2.9 Canvas / project-level — *the composition*
See `Canvas` (`types.ts:145`). All mutated via the **`set_canvas`** command + tool (✅ shipped).

| Property | Does | Range / unit | Status |
|---|---|---|---|
| `width` / `height` | Output resolution | px | ✅ rendered (stage sizing) + settable |
| `fps` | Frame rate | fps (24/25/30/60) | ✅ settable; ⚠️ display-only in preview (browser drives playback); export will consume it |
| `backgroundColor` | Canvas backdrop | hex | ✅ rendered (`PreviewCanvas`) + settable |
| `duration` | Total length | derived from clips | ✅ read-only |

---

## 3. Object type → property-group matrix

The grouped answer to "what can I change on this thing?"

| Group | Video | Image | Text | Audio | Track | Canvas |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Temporal (2.1) | ● | ◐¹ | ◐¹ | ● | — | — |
| Transform (2.2) | ● | ● | ● | — | — | — |
| Appearance (2.3) | ● | ● | ● | — | — | — |
| Color correction (2.4) | ● | ● | — | — | — | — |
| Audio (2.5) | ●² | — | — | ● | ◐³ | — |
| Typography (2.6) | — | — | ● | — | — | — |
| Animation (2.7) | ● | ● | ● | ◐⁴ | — | — |
| Track-level (2.8) | — | — | — | — | ● | — |
| Canvas-level (2.9) | — | — | — | — | — | ● |

¹ Stills/text have `duration` but no source trim; `speed` is N/A.
² Video audio lives on the auto-split **linked audio clip**; set volume/fades there.
³ Tracks expose lane-level `volume`/`enabled(mute)`, not per-clip audio shaping.
⁴ Audio can keyframe `volume` (➕) for envelopes; no spatial keyframes.

---

## 4. Conventions (the agent must rely on these)

- **Position / scale / opacity / volume** → normalized **0..1**. Position is center-anchored; 0.5,0.5 is dead center. This keeps layout resolution-independent (`PRD §7`).
- **Rotation / hue** → **degrees**, −180..180.
- **Time** → **seconds** (rounded to ≤2 dp) at every agent-facing boundary; integer ticks internally only.
- **Color** → **hex** (`#rrggbb`) or rgba string.
- **Speed** → multiplier (2 = 2×). **Volume** → linear 0..1 (not dB) for now.
- **Enums** (align, blendMode, easing, transition) → lowercase string literals matching the type union.
- **Patches are partial**: every `set_*` command takes only the fields being changed; omitted fields are untouched.

---

## 5. Property → command/tool map (canonical)

One property group ↔ one command keeps the surface learnable. ✅ implemented, ➕ planned.

| Group | Command(s) | Agent/MCP tool | Status |
|---|---|---|---|
| Temporal | `move_clip`, `trim_clip`, `set_speed`, `split_clip`, `delete_clip` | same names | ✅ |
| Transform | `set_transform` | `set_transform` | ✅ (crop/anchor ➕) |
| Appearance | `set_opacity`, `set_fade` | same | ✅ (blend/radius/border/shadow ➕ → `set_style`) |
| Color | `set_color` | `set_color` | ✅ core grade + filter presets (temp/exposure/LUT ➕) |
| Audio | `set_volume`, `set_fade{audio}`, `set_pan` | same | ✅ volume; fades/pan ➕ |
| Typography | `set_text` | `set_text` | ✅ core + weight/italic/letterSpacing/bg-plate/stroke (shadow, vAlign ➕) |
| Animation | `add_keyframe` / `remove_keyframe` / `clear_keyframes` | same | ➕ |
| Track-level | `set_track` | `set_track` | ✅ |
| Canvas-level | `set_canvas` | `set_canvas` | ✅ |

This table is the contract: when a property moves from ➕ to ✅, it gets a command in `commands.ts`, a tool in **both** `src/agent/tools.ts` and `mcp/server.ts` (kept in lockstep — see `TOOLING_PLAN.md` drift note), and a row here flips status.

---

## Appendix — Industry cross-reference & design altitude

Validated against declarative-JSON editors (Creatomate, Shotstack, Remotion, FFmpeg) and GUI editors (Premiere, After Effects, Final Cut, Resolve, CapCut, Canva). Takeaways that shape Ocean's choices:

**Aim at the consumer-tier altitude (CapCut / Canva), not the pro grade.** For an LLM agent, a small set of normalized, well-named scalars plus **named enums** maps to natural-language intent far better than dozens of pro sliders. Creatomate's flat snake_case schema (no track object — `z_index` + `track` integers on each element; animation objects with `time`/`duration`/`type`) is the cleanest structural template to mirror.

**Named enums are essential, not advanced — and Ocean currently has none:**
- **Filter presets** (one-shot looks: greyscale/muted/boost/negative…) — higher conversational value than raw brightness/contrast/saturation → fold into `set_color{filter}`.
- **Transitions** with separate `in`/`out` slots + duration (fade/slide/wipe/zoom) → `set_transition`.
- **Motion presets** (Ken Burns: zoomIn/Out, slide*) for stills → part of Animation.

**Unit conventions — our choices (§4) are confirmed correct:** normalized `0..1` for opacity/volume, **degrees** for rotation (FFmpeg's radians is the outlier — convert at the boundary), **seconds** at the agent edge, hex color. Integration watch-outs: Resolve uses scalar `1.0`=100% scale; Shotstack puts alpha as *leading* hex; Remotion is frame-based.

**Gaps this surfaced:** `fit` (cover/contain/fill/none — added to §2.2); named filter/transition/motion enums (queued as the highest-value *conversational* additions — see ROADMAP A1/A2). The full per-editor property tables live in the research output; this doc is the Ocean-specific distillation.
