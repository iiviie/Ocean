// Timeline → ffmpeg export. Builds a single filtergraph that composites the
// project's video tracks (bottom→top) over a background canvas and mixes the
// audio tracks, then encodes to H.264/AAC mp4 at the requested resolution/fps.
//
// Supported per clip: trim (sourceIn/out), speed, scale+fit, position
// (centerX/Y), flip, rotation, opacity + fades, colour (brightness/contrast/
// saturation/hue) and the named filter presets, plus text clips via drawtext.
// Not mapped (preview-only): blend modes, corner radius, border, shadow,
// keyframes, lottie — these are ignored by the encoder.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

const TB = 600; // document tick rate

// ---- structural view of the document (kept loose; main can't import src types) ----
interface Transform { centerX: number; centerY: number; scale: number; rotation: number; flipH: boolean; flipV: boolean }
interface ColorAdjust { brightness?: number; contrast?: number; saturation?: number; hue?: number; filter?: string }
interface TextProps {
  content: string; fontSize: number; color: string; align: string;
  backgroundColor?: string; strokeColor?: string; strokeWidth?: number; fontWeight?: number;
}
interface Clip {
  id: string; kind: string; assetId?: string;
  timelineStart: number; timelineEnd: number; sourceIn: number; sourceOut: number; speed: number;
  transform: Transform; color?: ColorAdjust; opacity: number; opacityFadeIn: number; opacityFadeOut: number;
  volume: number; text?: TextProps;
}
interface Track { id: string; kind: string; enabled: boolean; clips: Clip[]; volume: number }
interface Asset { id: string; kind: string; uri: string; naturalWidth: number; naturalHeight: number }
interface Canvas { width: number; height: number; fps: number; backgroundColor: string }
export interface ProjectDoc { canvas: Canvas; mediaLibrary: Asset[]; tracks: Track[] }

export interface ExportOpts { width: number; height: number; fps: number; outPath: string }

const r2 = (n: number) => Math.round(n * 100) / 100;
const even = (n: number) => { const v = Math.max(2, Math.round(n)); return v % 2 ? v + 1 : v; };
const sec = (ticks: number) => ticks / TB;

function resolvePath(uri: string): string {
  if (uri.startsWith("file://")) return uri.slice("file://".length);
  return uri; // absolute path (how the desktop import stores it)
}

/** ffmpeg drawtext needs these characters escaped. */
function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’") // curly apostrophe — sidesteps quoting hell
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

/** Compose atempo factors (each must stay within [0.5, 2]) for an arbitrary speed. */
function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2) { out.push("atempo=2.0"); s /= 2; }
  while (s < 0.5) { out.push("atempo=0.5"); s *= 2; }
  if (Math.abs(s - 1) > 0.001) out.push(`atempo=${r2(s)}`);
  return out;
}

/** Colour-adjust filter snippet for a clip, or null if neutral. */
function colorFilters(c?: ColorAdjust): string[] {
  if (!c) return [];
  const f: string[] = [];
  const eq: string[] = [];
  if (c.brightness) eq.push(`brightness=${r2(c.brightness)}`);
  if (c.contrast != null && c.contrast !== 0) eq.push(`contrast=${r2(1 + c.contrast)}`);
  if (c.saturation != null && c.saturation !== 1) eq.push(`saturation=${r2(c.saturation)}`);
  if (eq.length) f.push(`eq=${eq.join(":")}`);
  if (c.hue) f.push(`hue=h=${r2(c.hue)}`);
  switch (c.filter) {
    case "grayscale": f.push("hue=s=0"); break;
    case "sepia": f.push("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"); break;
    case "invert": f.push("negate"); break;
    case "vintage": f.push("curves=vintage"); break;
  }
  return f;
}

export interface BuiltCommand { args: string[]; durationSec: number }

/** Build the ffmpeg argument list for the export. `fontFile` (if found) is used
 *  for text clips. Returns the args and the total timeline duration. */
export function buildExportArgs(project: ProjectDoc, opts: ExportOpts, fontFile?: string): BuiltCommand {
  const cw = project.canvas.width;
  const ch = project.canvas.height;
  const fps = opts.fps;
  const assetOf = (id?: string) => project.mediaLibrary.find((a) => a.id === id);

  // total duration = furthest clip end
  let endTicks = 0;
  for (const tr of project.tracks) for (const c of tr.clips) endTicks = Math.max(endTicks, c.timelineEnd);
  const durationSec = sec(endTicks);
  if (durationSec <= 0) throw new Error("nothing to export — the timeline is empty");

  const inputs: string[] = [];
  const filters: string[] = [];

  // background canvas (lavfi) — input 0
  inputs.push("-f", "lavfi", "-t", String(r2(durationSec)), "-i",
    `color=c=${project.canvas.backgroundColor || "#000000"}:s=${cw}x${ch}:r=${fps}`);
  let inputIdx = 1;

  // ---- video / image layers, bottom track → top ----
  let acc = "[0:v]";
  const visualTracks = project.tracks.filter((t) => t.kind === "video" && t.enabled);
  for (const tr of visualTracks) {
    for (const clip of tr.clips) {
      const startS = sec(clip.timelineStart);
      const endS = sec(clip.timelineEnd);
      const tlDur = endS - startS;
      if (tlDur <= 0) continue;

      if (clip.text) {
        acc = drawTextLayer(filters, acc, clip, clip.text, cw, ch, fontFile);
        continue;
      }

      const asset = assetOf(clip.assetId);
      if (!asset) continue;
      const path = resolvePath(asset.uri);
      const isImage = asset.kind === "image";
      const srcLen = sec(clip.sourceOut - clip.sourceIn);

      if (isImage) {
        inputs.push("-loop", "1", "-t", String(r2(tlDur)), "-i", path);
      } else {
        inputs.push("-ss", String(r2(sec(clip.sourceIn))), "-t", String(r2(srcLen)), "-i", path);
      }
      const idx = inputIdx++;

      // fitted draw size in canvas space, then × the clip's scale
      const nw = asset.naturalWidth || cw;
      const nh = asset.naturalHeight || ch;
      const fit = Math.min(cw / nw, ch / nh);
      const drawW = even(nw * fit * (clip.transform.scale || 1));
      const drawH = even(nh * fit * (clip.transform.scale || 1));
      const x = Math.round(clip.transform.centerX * cw - drawW / 2);
      const y = Math.round(clip.transform.centerY * ch - drawH / 2);

      const chain: string[] = [`fps=${fps}`, `scale=${drawW}:${drawH}`];
      if (!isImage && clip.speed && clip.speed !== 1) chain.push(`setpts=PTS/${r2(clip.speed)}`);
      if (clip.transform.flipH) chain.push("hflip");
      if (clip.transform.flipV) chain.push("vflip");
      if (clip.transform.rotation) chain.push(`rotate=${r2((clip.transform.rotation * Math.PI) / 180)}:c=none`);
      chain.push(...colorFilters(clip.color));
      chain.push("format=yuva420p");
      if (clip.opacity < 1) chain.push(`colorchannelmixer=aa=${r2(clip.opacity)}`);
      const fi = sec(clip.opacityFadeIn);
      const fo = sec(clip.opacityFadeOut);
      if (fi > 0) chain.push(`fade=t=in:st=0:d=${r2(fi)}:alpha=1`);
      if (fo > 0) chain.push(`fade=t=out:st=${r2(tlDur - fo)}:d=${r2(fo)}:alpha=1`);
      // shift the clip's local time onto the timeline
      chain.push(`setpts=PTS+${r2(startS)}/TB`);

      const lbl = `v${idx}`;
      filters.push(`[${idx}:v]${chain.join(",")}[${lbl}]`);

      const out = `bg${idx}`;
      filters.push(`${acc}[${lbl}]overlay=${x}:${y}:enable='between(t,${r2(startS)},${r2(endS)})':eof_action=pass[${out}]`);
      acc = `[${out}]`;
    }
  }

  // final scale to the requested output size
  filters.push(`${acc}scale=${even(opts.width)}:${even(opts.height)},format=yuv420p[vout]`);

  // ---- audio: every clip on an enabled audio track ----
  const aLabels: string[] = [];
  const audioTracks = project.tracks.filter((t) => t.kind === "audio" && t.enabled);
  for (const tr of audioTracks) {
    for (const clip of tr.clips) {
      const asset = assetOf(clip.assetId);
      if (!asset) continue;
      const srcLen = sec(clip.sourceOut - clip.sourceIn);
      if (srcLen <= 0) continue;
      inputs.push("-ss", String(r2(sec(clip.sourceIn))), "-t", String(r2(srcLen)), "-i", resolvePath(asset.uri));
      const idx = inputIdx++;
      const startMs = Math.round(sec(clip.timelineStart) * 1000);
      const tlDur = sec(clip.timelineEnd - clip.timelineStart);
      const vol = clip.volume * (tr.volume ?? 1);
      const chain: string[] = ["asetpts=PTS-STARTPTS"];
      if (clip.speed && clip.speed !== 1) chain.push(...atempoChain(clip.speed));
      if (vol !== 1) chain.push(`volume=${r2(vol)}`);
      const fi = sec(clip.opacityFadeIn);
      const fo = sec(clip.opacityFadeOut);
      if (fi > 0) chain.push(`afade=t=in:st=0:d=${r2(fi)}`);
      if (fo > 0) chain.push(`afade=t=out:st=${r2(tlDur - fo)}:d=${r2(fo)}`);
      chain.push("aresample=48000");
      if (startMs > 0) chain.push(`adelay=${startMs}|${startMs}`);
      const lbl = `a${idx}`;
      filters.push(`[${idx}:a]${chain.join(",")}[${lbl}]`);
      aLabels.push(`[${lbl}]`);
    }
  }

  let hasAudio = false;
  if (aLabels.length === 1) {
    filters.push(`${aLabels[0]}apad,atrim=0:${r2(durationSec)}[aout]`);
    hasAudio = true;
  } else if (aLabels.length > 1) {
    filters.push(`${aLabels.join("")}amix=inputs=${aLabels.length}:normalize=0:dropout_transition=0,atrim=0:${r2(durationSec)}[aout]`);
    hasAudio = true;
  }

  const args = [
    "-hide_banner", "-y",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[vout]",
  ];
  if (hasAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  args.push(
    "-r", String(fps),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20",
    "-t", String(r2(durationSec)),
    opts.outPath,
  );
  return { args, durationSec };
}

function drawTextLayer(filters: string[], acc: string, clip: Clip, text: TextProps, cw: number, ch: number, fontFile?: string): string {
  const startS = sec(clip.timelineStart);
  const endS = sec(clip.timelineEnd);
  const tlDur = endS - startS;
  const cx = Math.round(clip.transform.centerX * cw);
  const cy = Math.round(clip.transform.centerY * ch);
  const size = Math.round(text.fontSize || 64);

  // x anchored around centerX per alignment; y centered on centerY.
  const xExpr = text.align === "left" ? `${cx}` : text.align === "right" ? `${cx}-text_w` : `${cx}-text_w/2`;
  const yExpr = `${cy}-text_h/2`;

  const parts: string[] = [
    `text='${escapeDrawtext(text.content || "")}'`,
    `fontsize=${size}`,
    `fontcolor=${text.color || "#ffffff"}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
  ];
  if (fontFile) parts.push(`fontfile=${fontFile}`);
  if (text.backgroundColor) parts.push("box=1", `boxcolor=${text.backgroundColor}`, "boxborderw=12");
  if (text.strokeColor && (text.strokeWidth ?? 0) > 0) parts.push(`bordercolor=${text.strokeColor}`, `borderw=${Math.round(text.strokeWidth!)}`);

  // timeline window + opacity fades via an alpha expression
  const fi = sec(clip.opacityFadeIn);
  const fo = sec(clip.opacityFadeOut);
  const base = clip.opacity < 1 ? r2(clip.opacity) : 1;
  let alpha = `${base}`;
  if (fi > 0 || fo > 0) {
    const inExpr = fi > 0 ? `if(lt(t,${r2(startS + fi)}),(t-${r2(startS)})/${r2(fi)},1)` : "1";
    const outExpr = fo > 0 ? `if(gt(t,${r2(endS - fo)}),(${r2(endS)}-t)/${r2(fo)},1)` : "1";
    alpha = `${base}*min(${inExpr}\\,${outExpr})`;
  }
  parts.push(`alpha='${alpha}'`);
  parts.push(`enable='between(t,${r2(startS)},${r2(endS)})'`);

  const out = `txt${clip.id}`;
  filters.push(`${acc}drawtext=${parts.join(":")}[${out}]`);
  void tlDur;
  return `[${out}]`;
}

const FONT_CANDIDATES = [
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/Library/Fonts/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
];

export async function findFont(): Promise<string | undefined> {
  for (const p of FONT_CANDIDATES) {
    try {
      await access(p, constants.R_OK);
      return p;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export interface RunHandle { progress: number; timeSec: number }

/** Run the export, reporting progress via `onProgress`. Resolves to the output
 *  path on success, rejects with ffmpeg's tail on failure. */
export function runExport(
  args: string[],
  durationSec: number,
  onProgress: (p: { progress: number; timeSec: number }) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
    let tail = "";
    const timeRe = /time=(\d+):(\d+):(\d+\.?\d*)/g;
    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      let m: RegExpExecArray | null;
      timeRe.lastIndex = 0;
      let last: RegExpExecArray | null = null;
      while ((m = timeRe.exec(s))) last = m;
      if (last) {
        const t = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
        onProgress({ progress: durationSec > 0 ? Math.min(1, t / durationSec) : -1, timeSec: r2(t) });
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${tail}`));
    });
  });
}
